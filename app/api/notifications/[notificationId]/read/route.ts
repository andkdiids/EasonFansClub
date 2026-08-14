import { NextResponse } from 'next/server'
import { markUnifiedNotificationReadWithState } from '@/lib/notifications'
import { emitRealtime } from '@/lib/realtime'
import { requireUser } from '@/lib/security'

const privateHeaders = { 'Cache-Control': 'private, no-store, max-age=0', Vary: 'Cookie' }

export async function POST(request: Request, { params }: { params: Promise<{ notificationId: string }> }) {
  const guard = await requireUser()
  if (!guard.user) return guard.response

  const { notificationId } = await params
  const body = await request.json().catch(() => null)
  const source = body?.source === 'system' ? 'system' : 'personal'
  const result = await markUnifiedNotificationReadWithState(guard.user.id, source, notificationId)

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
