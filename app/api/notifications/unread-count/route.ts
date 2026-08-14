import { NextResponse } from 'next/server'
import { getUnreadNotificationCount } from '@/lib/notifications'
import { requireUser } from '@/lib/security'

export const dynamic = 'force-dynamic'
export const revalidate = 0

const privateHeaders = { 'Cache-Control': 'private, no-store, max-age=0', Vary: 'Cookie' }

export async function GET() {
  const guard = await requireUser()
  if (!guard.user) return guard.response

  try {
    const count = await getUnreadNotificationCount(guard.user.id)
    return NextResponse.json({ count }, { headers: privateHeaders })
  } catch (error) {
    console.error('[notifications.unread-count.failed]', {
      userId: guard.user.id,
      error: error instanceof Error ? error.name : 'unknown',
    })
    return NextResponse.json({ ok: false, code: 'UNREAD_SUMMARY_UNAVAILABLE', message: '未读统计暂时不可用，请稍后重试' }, {
      status: 503,
      headers: privateHeaders,
    })
  }
}
