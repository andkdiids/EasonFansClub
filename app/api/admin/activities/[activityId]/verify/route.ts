import { NextResponse } from 'next/server'
import { ActivityRedemptionError, getActivityRedemptionLookup } from '@/lib/activity-redemption'
import { enforceApiRateLimit, rejectInvalidRequestOrigin, requireAdmin } from '@/lib/security'

export const dynamic = 'force-dynamic'

const privateHeaders = { 'Cache-Control': 'private, no-store, max-age=0', Vary: 'Cookie' }

export async function POST(request: Request, { params }: { params: Promise<{ activityId: string }> }) {
  const invalidOrigin = rejectInvalidRequestOrigin(request)
  if (invalidOrigin) return invalidOrigin
  const guard = await requireAdmin('activity_manage')
  if (!guard.user) return guard.response
  const limited = await enforceApiRateLimit(request, guard.user.id, {
    endpoint: '/api/admin/activities/verify',
    ip: { limit: 60, windowSeconds: 60 },
    user: { limit: 60, windowSeconds: 60 },
  }, '扫码核销操作过于频繁，请稍后再试')
  if (limited) return limited
  const { activityId } = await params
  const body = await request.json().catch(() => null) as { token?: unknown } | null
  const token = typeof body?.token === 'string' ? body.token.trim() : ''
  try {
    const result = await getActivityRedemptionLookup(activityId, token)
    return NextResponse.json({ ok: true, scanOnly: true, ...result }, { headers: privateHeaders })
  } catch (error) {
    if (error instanceof ActivityRedemptionError) return NextResponse.json({ ok: false, code: error.code, message: error.message }, { status: error.status, headers: privateHeaders })
    console.error('[admin.activities.qr-verify]', error instanceof Error ? error.message : error)
    return NextResponse.json({ ok: false, code: 'REDEMPTION_LOOKUP_FAILED', message: '扫码查询失败，请稍后重试' }, { status: 500, headers: privateHeaders })
  }
}
