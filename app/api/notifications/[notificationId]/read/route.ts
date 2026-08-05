import { NextResponse } from 'next/server'
import { markUnifiedNotificationReadWithState } from '@/lib/notifications'
import { requireUser } from '@/lib/security'

export async function POST(request: Request, { params }: { params: Promise<{ notificationId: string }> }) {
  const guard = await requireUser()
  if (!guard.user) return guard.response

  const { notificationId } = await params
  const body = await request.json().catch(() => null)
  const source = body?.source === 'system' ? 'system' : 'personal'
  const result = await markUnifiedNotificationReadWithState(guard.user.id, source, notificationId)

  if (!result.ok) {
    return NextResponse.json({ message: '通知不存在或无权访问' }, { status: 404 })
  }
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
  })
}
