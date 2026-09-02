import { revalidatePath } from 'next/cache'
import { NextResponse } from 'next/server'
import { ActivityRegistrationError, cancelAllActivityRegistrations } from '@/lib/activity-registration'
import { invalidateHomeDataCache } from '@/lib/home-data'
import { enforceApiRateLimit, rejectInvalidRequestOrigin, requireAdmin } from '@/lib/security'

export const dynamic = 'force-dynamic'

const activityIdPattern = /^[A-Za-z0-9_-]{8,128}$/
const privateHeaders = { 'Cache-Control': 'private, no-store, max-age=0', Vary: 'Cookie' }

export async function POST(request: Request, { params }: { params: Promise<{ activityId: string }> }) {
  const invalidOrigin = rejectInvalidRequestOrigin(request)
  if (invalidOrigin) return invalidOrigin
  const guard = await requireAdmin('activity_manage')
  if (!guard.user) return guard.response
  const limited = await enforceApiRateLimit(request, guard.user.id, {
    endpoint: '/api/admin/activities/registrations-cancel-all',
    ip: { limit: 20, windowSeconds: 60 },
    user: { limit: 10, windowSeconds: 60 },
  }, '批量取消报名操作过于频繁，请稍后再试')
  if (limited) return limited

  const { activityId } = await params
  if (!activityIdPattern.test(activityId)) return NextResponse.json({ ok: false, message: '活动不存在' }, { status: 404, headers: privateHeaders })
  const body = await request.json().catch(() => null) as { confirm?: unknown } | null
  if (body?.confirm !== true) return NextResponse.json({ ok: false, code: 'CONFIRMATION_REQUIRED', message: '请确认取消所有报名' }, { status: 400, headers: privateHeaders })

  try {
    const result = await cancelAllActivityRegistrations({ activityId, source: 'ADMIN', actorId: guard.user.id, writeAudit: true })
    invalidateHomeDataCache()
    revalidatePath('/activities')
    revalidatePath(`/activities/${activityId}`)
    revalidatePath('/')
    return NextResponse.json({ ok: true, success: true, ...result }, { headers: privateHeaders })
  } catch (error) {
    if (error instanceof ActivityRegistrationError) return NextResponse.json({ ok: false, code: error.code, message: error.message }, { status: error.status, headers: privateHeaders })
    console.error('[admin.activities.registrations.cancel-all]', error instanceof Error ? error.message : error)
    return NextResponse.json({ ok: false, code: 'CANCEL_REGISTRATIONS_FAILED', message: '批量取消报名失败，请稍后重试' }, { status: 500, headers: privateHeaders })
  }
}
