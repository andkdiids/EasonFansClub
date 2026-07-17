import { NextResponse } from 'next/server'
import { getUnreadNotificationCount, listUnifiedNotifications, markAllUnifiedNotificationsRead, markUnifiedNotificationRead } from '@/lib/notifications'
import { requireUser } from '@/lib/security'
import { prisma } from '@/lib/prisma'

const NOTIFICATION_ID_BATCH_LIMIT = 100
const NOTIFICATION_PAGE_SIZE = 50

type NotificationReadInput = { id: string; source?: string }

export async function GET(request: Request) {
  const guard = await requireUser()
  if (!guard.user) return guard.response

  const { searchParams } = new URL(request.url)
  const unreadOnly = searchParams.get('unread') === '1'
  const limit = Math.min(Math.max(Number(searchParams.get('limit') || NOTIFICATION_PAGE_SIZE), 1), NOTIFICATION_PAGE_SIZE)
  const notifications = await listUnifiedNotifications(guard.user.id, { unreadOnly, limit })
  const unreadCount = await getUnreadNotificationCount(guard.user.id)

  return NextResponse.json({
    notifications,
    unreadCount,
    page: 1,
    limit,
    hasMore: notifications.length >= limit,
  })
}

export async function PATCH(request: Request) {
  const guard = await requireUser()
  if (!guard.user) return guard.response

  const body = await request.json().catch(() => null)
  const ids: NotificationReadInput[] = Array.isArray(body?.ids)
    ? body.ids.filter((item: unknown): item is NotificationReadInput => {
        return typeof item === 'object' && item !== null && typeof (item as { id?: unknown }).id === 'string'
      }).slice(0, NOTIFICATION_ID_BATCH_LIMIT)
    : []

  if (!ids.length) {
    await markAllUnifiedNotificationsRead(guard.user.id)
    return NextResponse.json({ ok: true })
  }

  await Promise.all(ids.map((item) => markUnifiedNotificationRead(guard.user.id, item.source || 'personal', item.id)))
  return NextResponse.json({ ok: true })
}

export async function DELETE(request: Request) {
  const guard = await requireUser()
  if (!guard.user) return guard.response
  const body = await request.json().catch(() => null)
  const ids = Array.isArray(body?.ids)
    ? body.ids.filter((id: unknown): id is string => typeof id === 'string').slice(0, NOTIFICATION_ID_BATCH_LIMIT)
    : []
  const result = await prisma.notification.deleteMany({
    where: { recipientId: guard.user.id, ...(ids.length ? { id: { in: ids } } : {}) },
  })
  return NextResponse.json({ ok: true, deleted: result.count })
}
