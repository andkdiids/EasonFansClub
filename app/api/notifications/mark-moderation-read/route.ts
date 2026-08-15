import { NextResponse } from 'next/server'
import { markModerationNotificationsRead } from '@/lib/notifications'
import { emitRealtime } from '@/lib/realtime'
import { logNotificationError } from '@/lib/notification-errors'
import { requireUser } from '@/lib/security'

export async function POST() {
  const guard = await requireUser()
  if (!guard.user) return guard.response

  try {
    const result = await markModerationNotificationsRead(guard.user.id)
    if (result.count > 0) emitRealtime(guard.user.id, 'notification')
    return NextResponse.json(result)
  } catch (error) {
    logNotificationError('mark-moderation-read', { userId: guard.user.id }, error)
    return NextResponse.json({ ok: false, code: 'NOTIFICATIONS_ACTION_UNAVAILABLE', message: '通知暂时无法更新，请稍后重试' }, { status: 503 })
  }
}
