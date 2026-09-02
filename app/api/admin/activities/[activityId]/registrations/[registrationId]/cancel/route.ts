import { revalidatePath } from 'next/cache'
import { NextResponse } from 'next/server'
import { ActivityRegistrationError, cancelActivityRegistration } from '@/lib/activity-registration'
import { invalidateHomeDataCache } from '@/lib/home-data'
import { enforceApiRateLimit, rejectInvalidRequestOrigin, requireAdmin } from '@/lib/security'

export const dynamic = 'force-dynamic'

const idPattern = /^[A-Za-z0-9_-]{8,191}$/
const privateHeaders = { 'Cache-Control': 'private, no-store, max-age=0', Vary: 'Cookie' }

export async function POST(request: Request, { params }: { params: Promise<{ activityId: string; registrationId: string }> }) {
  const invalidOrigin = rejectInvalidRequestOrigin(request)
  if (invalidOrigin) return invalidOrigin
  const guard = await requireAdmin('activity_manage')
  if (!guard.user) return guard.response
  const limited = await enforceApiRateLimit(request, guard.user.id, {
    endpoint: '/api/admin/activities/registration-cancel',
    ip: { limit: 60, windowSeconds: 60 },
    user: { limit: 60, windowSeconds: 60 },
  }, '取消报名操作过于频繁，请稍后再试')
  if (limited) return limited

  const { activityId, registrationId } = await params
  if (!idPattern.test(activityId) || !idPattern.test(registrationId)) return NextResponse.json({ ok: false, message: '报名记录不存在' }, { status: 404, headers: privateHeaders })

  try {
    const result = await cancelActivityRegistration({ activityId, registrationId, actorId: guard.user.id, source: 'ADMIN' })
    invalidateHomeDataCache()
    revalidatePath('/activities')
    revalidatePath(`/activities/${activityId}`)
    revalidatePath('/')
    return NextResponse.json({
      ok: true,
      success: true,
      registrationId: result.registrationId,
      cancelled: result.cancelled,
      alreadyCancelled: result.alreadyCancelled,
      refundedAmount: result.refundedAmount,
      refundDuplicate: result.refundDuplicate,
      registrationCount: result.registrationCount,
    }, { headers: privateHeaders })
  } catch (error) {
    if (error instanceof ActivityRegistrationError) return NextResponse.json({ ok: false, code: error.code, message: error.message }, { status: error.status, headers: privateHeaders })
    console.error('[admin.activities.registration.cancel]', error instanceof Error ? error.message : error)
    return NextResponse.json({ ok: false, code: 'CANCEL_REGISTRATION_FAILED', message: '取消报名失败，请稍后重试' }, { status: 500, headers: privateHeaders })
  }
}
