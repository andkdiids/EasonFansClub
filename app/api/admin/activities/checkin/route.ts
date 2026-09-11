import { NextResponse } from 'next/server'
import { ActivityRedemptionError, getActivityRedemptionLookupByToken } from '@/lib/activity-redemption'
import { activityVerificationTokenFromInput } from '@/lib/activity-registration'
import { enforceApiRateLimit, rejectInvalidRequestOrigin, requireAdmin } from '@/lib/security'

export const dynamic = 'force-dynamic'

const privateHeaders = { 'Cache-Control': 'private, no-store, max-age=0', Vary: 'Cookie' }

export async function POST(request: Request) {
  const invalidOrigin = rejectInvalidRequestOrigin(request)
  if (invalidOrigin) return invalidOrigin
  const guard = await requireAdmin('activity_manage')
  if (!guard.user) return guard.response
  const limited = await enforceApiRateLimit(request, guard.user.id, {
    endpoint: '/api/admin/activities/checkin',
    ip: { limit: 60, windowSeconds: 60 },
    user: { limit: 60, windowSeconds: 60 },
  }, '核销查询过于频繁，请稍后再试')
  if (limited) return limited

  const body = await request.json().catch(() => null) as { token?: unknown } | null
  const rawToken = typeof body?.token === 'string' ? body.token.trim() : ''
  const token = activityVerificationTokenFromInput(rawToken)
  if (!token) return NextResponse.json({ ok: false, code: 'INVALID_TOKEN', message: '二维码无效或已失效' }, { status: 400, headers: privateHeaders })

  try {
    const result = await getActivityRedemptionLookupByToken(token)
    return NextResponse.json({ ok: true, scanOnly: true, token, ...result }, { headers: privateHeaders })
  } catch (error) {
    if (error instanceof ActivityRedemptionError) {
      const message = error.code === 'REGISTRATION_NOT_FOUND' ? '未找到报名记录' : error.code === 'INVALID_TOKEN' ? '二维码无效或已失效' : error.message
      return NextResponse.json({ ok: false, code: error.code, message }, { status: error.status, headers: privateHeaders })
    }
    console.error('[admin.activities.checkin.lookup]', error instanceof Error ? error.message : error)
    return NextResponse.json({ ok: false, code: 'REDEMPTION_LOOKUP_FAILED', message: '查询失败，请稍后重试' }, { status: 500, headers: privateHeaders })
  }
}
