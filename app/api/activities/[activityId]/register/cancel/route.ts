import { revalidatePath } from 'next/cache'
import { NextResponse } from 'next/server'
import { requireUser, enforceApiRateLimit, rejectInvalidRequestOrigin } from '@/lib/security'
import { invalidateHomeDataCache } from '@/lib/home-data'
import { ActivityRegistrationError, cancelActivityRegistration } from '@/lib/activity-registration'

export const dynamic = 'force-dynamic'

const activityIdPattern = /^[A-Za-z0-9_-]{8,128}$/
const privateHeaders = { 'Cache-Control': 'private, no-store, max-age=0', Vary: 'Cookie' }

export async function POST(request: Request, { params }: { params: Promise<{ activityId: string }> }) {
  const invalidOrigin = rejectInvalidRequestOrigin(request)
  if (invalidOrigin) return invalidOrigin
  const guard = await requireUser()
  if (!guard.user) return guard.response
  const limited = await enforceApiRateLimit(request, guard.user.id, {
    endpoint: '/api/activities/register/cancel',
    ip: { limit: 30, windowSeconds: 60 },
    user: { limit: 15, windowSeconds: 60 },
  }, '取消报名操作过于频繁，请稍后再试')
  if (limited) return limited

  const { activityId } = await params
  if (!activityIdPattern.test(activityId)) return NextResponse.json({ ok: false, message: '活动不存在' }, { status: 404, headers: privateHeaders })

  try {
    const result = await cancelActivityRegistration({ activityId, userId: guard.user.id, source: 'USER' })
    invalidateHomeDataCache()
    revalidatePath('/activities')
    revalidatePath(`/activities/${activityId}`)
    revalidatePath('/')
    return NextResponse.json({
      ok: true,
      alreadyCancelled: result.alreadyCancelled,
      cancelled: result.cancelled,
      registrationId: result.registrationId,
      refundedAmount: result.refundedAmount,
      isRegistered: false,
      registrationStatus: 'CANCELLED',
      registrationCount: result.registrationCount,
    }, { headers: privateHeaders })
  } catch (error) {
    if (error instanceof ActivityRegistrationError) return NextResponse.json({ ok: false, code: error.code, message: error.message }, { status: error.status, headers: privateHeaders })
    console.error('[activities.register.cancel]', error instanceof Error ? error.message : error)
    return NextResponse.json({ ok: false, code: 'CANCEL_REGISTRATION_FAILED', message: '取消报名失败，请稍后重试' }, { status: 500, headers: privateHeaders })
  }
}
