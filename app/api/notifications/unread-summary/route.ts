import { NextResponse } from 'next/server'
import { getUnreadSummary } from '@/lib/notifications'
import { logNotificationError } from '@/lib/notification-errors'
import { requireUser } from '@/lib/security'

export const dynamic = 'force-dynamic'
export const revalidate = 0

const privateHeaders = { 'Cache-Control': 'private, no-store, max-age=0', Vary: 'Cookie' }

export async function GET() {
  const guard = await requireUser()
  if (!guard.user) return guard.response
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
