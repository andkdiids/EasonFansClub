import { NextResponse } from 'next/server'
import { ActivityVerificationError, verifyActivityRegistration } from '@/lib/activity-registration'
import { enforceApiRateLimit, rejectInvalidRequestOrigin, requireAdmin } from '@/lib/security'

export const dynamic = 'force-dynamic'

const privateHeaders = { 'Cache-Control': 'private, no-store, max-age=0', Vary: 'Cookie' }

export async function POST(request: Request, { params }: { params: Promise<{ activityId: string; registrationId: string }> }) {
  const invalidOrigin = rejectInvalidRequestOrigin(request)
  if (invalidOrigin) return invalidOrigin
  const guard = await requireAdmin('activity_manage')
  if (!guard.user) return guard.response
  const limited = await enforceApiRateLimit(request, guard.user.id, {
    endpoint: '/api/admin/activities/registration-verify',
    ip: { limit: 60, windowSeconds: 60 },
    user: { limit: 60, windowSeconds: 60 },
  }, '核销操作过于频繁，请稍后再试')
  if (limited) return limited
  const { activityId, registrationId } = await params
  try {
    const result = await verifyActivityRegistration({ activityId, registrationId, adminId: guard.user.id, method: 'MANUAL' })
    return NextResponse.json({ ok: true, ...result }, { headers: privateHeaders })
  } catch (error) {
    if (error instanceof ActivityVerificationError) return NextResponse.json({ ok: false, code: error.code, message: error.message }, { status: error.status, headers: privateHeaders })
    console.error('[admin.activities.registration.verify]', error instanceof Error ? error.message : error)
    return NextResponse.json({ ok: false, code: 'VERIFICATION_FAILED', message: '核销失败，请稍后重试' }, { status: 500, headers: privateHeaders })
  }
}
