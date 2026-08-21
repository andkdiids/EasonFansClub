import { NextResponse } from 'next/server'
import { getUnreadSummary } from '@/lib/notifications'
import { logNotificationError } from '@/lib/notification-errors'
import { enforceApiRateLimit, requireUser } from '@/lib/security'

export const dynamic = 'force-dynamic'
export const revalidate = 0

const privateHeaders = { 'Cache-Control': 'private, no-store, max-age=0', Vary: 'Cookie' }

export async function GET(request: Request) {
  const guard = await requireUser()
  if (!guard.user) return guard.response
  const limited = await enforceApiRateLimit(request, guard.user.id, {
    endpoint: '/api/notifications/unread-summary',
    ip: { limit: 240, windowSeconds: 60 },
    user: { limit: 120, windowSeconds: 60 },
  })
  if (limited) return limited
  try {
    return NextResponse.json(await getUnreadSummary(guard.user.id), { headers: privateHeaders })
  } catch (error) {
    logNotificationError('unread-summary', { userId: guard.user.id }, error)
    return NextResponse.json({ ok: false, code: 'UNREAD_SUMMARY_UNAVAILABLE', message: '未读统计暂时不可用，请稍后重试' }, {
      status: 503,
      headers: privateHeaders,
    })
  }
}
