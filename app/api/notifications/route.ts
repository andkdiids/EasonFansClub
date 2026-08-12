import { NextResponse } from 'next/server'
import { getUnreadNotificationCount, listUnifiedNotificationsPage, markAllUnifiedNotificationsRead, markUnifiedNotificationRead, parseNotificationCategory } from '@/lib/notifications'
import { requireUser } from '@/lib/security'
import { prisma } from '@/lib/prisma'
import { emitRealtime } from '@/lib/realtime'

const NOTIFICATION_ID_BATCH_LIMIT = 100
const NOTIFICATION_PAGE_SIZE = 20
const MAX_NOTIFICATION_PAGE_SIZE = 50
const privateHeaders = { 'Cache-Control': 'private, no-store, max-age=0', Vary: 'Cookie' }

export const dynamic = 'force-dynamic'

type NotificationReadInput = { id: string; source?: string }

export async function GET(request: Request) {
  const guard = await requireUser()
  if (!guard.user) return guard.response

  const { searchParams } = new URL(request.url)
  const unreadOnly = searchParams.get('unread') === '1'
  const pageSize = Math.min(Math.max(Number(searchParams.get('pageSize') || NOTIFICATION_PAGE_SIZE), 1), MAX_NOTIFICATION_PAGE_SIZE)
  const requestedPage = Math.max(1, Number.parseInt(searchParams.get('page') || '1', 10) || 1)
  const category = parseNotificationCategory(searchParams.get('category'))
  const result = await listUnifiedNotificationsPage(guard.user.id, { unreadOnly, page: requestedPage, pageSize, category })
  const unreadCount = await getUnreadNotificationCount(guard.user.id)

  return NextResponse.json({
    notifications: result.items,
    items: result.items,
    unreadCount,
    page: result.page,
    pageSize: result.pageSize,
    limit: result.pageSize,
    total: result.total,
    totalPages: result.totalPages,
    hasMore: result.page < result.totalPages,
  }, { headers: privateHeaders })
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
    emitRealtime(guard.user.id, 'notification')
    return NextResponse.json({ ok: true })
  }

  await Promise.all(ids.map((item) => markUnifiedNotificationRead(guard.user.id, item.source || 'personal', item.id)))
  emitRealtime(guard.user.id, 'notification')
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
  emitRealtime(guard.user.id, 'notification')
  return NextResponse.json({ ok: true, deleted: result.count })
}
