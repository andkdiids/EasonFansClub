import { NextResponse } from 'next/server'
import { markAllUnifiedNotificationsRead } from '@/lib/notifications'
import { emitRealtime } from '@/lib/realtime'
import { logNotificationError } from '@/lib/notification-errors'
import { requireUser } from '@/lib/security'

export const dynamic = 'force-dynamic'
export const revalidate = 0

const privateHeaders = { 'Cache-Control': 'private, no-store, max-age=0', Vary: 'Cookie' }

export async function POST() {
  const guard = await requireUser()
  if (!guard.user) return guard.response

  try {
    await markAllUnifiedNotificationsRead(guard.user.id)
    emitRealtime(guard.user.id, 'notification')
    return NextResponse.json({ ok: true }, { headers: privateHeaders })
  } catch (error) {
    logNotificationError('read-all', { userId: guard.user.id }, error)
    return NextResponse.json({ ok: false, code: 'NOTIFICATIONS_ACTION_UNAVAILABLE', message: '通知暂时无法更新，请稍后重试' }, {
      status: 503,
      headers: privateHeaders,
    })
  }
}
