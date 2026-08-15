import { NextResponse } from 'next/server'
import { markUnifiedNotificationReadWithState } from '@/lib/notifications'
import { emitRealtime } from '@/lib/realtime'
import { logNotificationError } from '@/lib/notification-errors'
import { requireUser } from '@/lib/security'

const privateHeaders = { 'Cache-Control': 'private, no-store, max-age=0', Vary: 'Cookie' }

export async function POST(request: Request, { params }: { params: Promise<{ notificationId: string }> }) {
  const guard = await requireUser()
  if (!guard.user) return guard.response

  const { notificationId } = await params
  const body = await request.json().catch(() => null)
  const source = body?.source === 'system' ? 'system' : 'personal'
  let result
  try {
    result = await markUnifiedNotificationReadWithState(guard.user.id, source, notificationId)
  } catch (error) {
    logNotificationError('mark-read', { userId: guard.user.id, notificationId, source }, error)
    return NextResponse.json({ ok: false, code: 'NOTIFICATIONS_ACTION_UNAVAILABLE', message: '通知暂时无法更新，请稍后重试' }, {
      status: 503,
      headers: privateHeaders,
    })
  }

  console.info('[notifications.mark-read]', {
    notificationId,
    userId: guard.user.id,
    source,
    ok: result.ok,
  })

  if (!result.ok) {
    return NextResponse.json({ message: '通知不存在或无权访问' }, { status: 404, headers: privateHeaders })
  }
  emitRealtime(guard.user.id, 'notification')
  const readAt = result.readAt?.toISOString() || null
  return NextResponse.json({
    ok: true,
    readAt,
    notification: {
      id: notificationId,
      source,
      isRead: true,
      readAt,
    },
  }, { headers: privateHeaders })
}
