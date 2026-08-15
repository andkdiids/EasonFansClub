import { NextResponse } from 'next/server'
import { listPopupSystemNotifications } from '@/lib/notifications'
import { logNotificationError } from '@/lib/notification-errors'
import { requireUser } from '@/lib/security'

export async function GET() {
  const guard = await requireUser()
  if (!guard.user) return guard.response

  try {
    const notifications = await listPopupSystemNotifications(guard.user.id, 5)
    return NextResponse.json({ notifications })
  } catch (error) {
    logNotificationError('popup', { userId: guard.user.id }, error)
    return NextResponse.json({ notifications: [] })
  }
}
