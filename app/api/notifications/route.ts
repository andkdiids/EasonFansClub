import { NextResponse } from 'next/server'
import { listUnifiedNotificationsPage, markAllUnifiedNotificationsRead, markUnifiedNotificationRead, parseNotificationCategory } from '@/lib/notifications'
import { requireUser } from '@/lib/security'
import { prisma } from '@/lib/prisma'
import { emitRealtime } from '@/lib/realtime'
import { effectiveSystemNotificationWhere } from '@/lib/system-notifications'
import { logNotificationError } from '@/lib/notification-errors'

const NOTIFICATION_ID_BATCH_LIMIT = 100
const NOTIFICATION_PAGE_SIZE = 20
const MAX_NOTIFICATION_PAGE_SIZE = 50
const privateHeaders = { 'Cache-Control': 'private, no-store, max-age=0', Vary: 'Cookie' }

export const dynamic = 'force-dynamic'
export const revalidate = 0

type NotificationReadInput = { id: string; source?: string }

export async function GET(request: Request) {
  const guard = await requireUser()
  if (!guard.user) return guard.response

  const { searchParams } = new URL(request.url)
  const unreadOnly = searchParams.get('unread') === '1'
  const pageSize = Math.min(Math.max(Number(searchParams.get('pageSize') || NOTIFICATION_PAGE_SIZE), 1), MAX_NOTIFICATION_PAGE_SIZE)
  const requestedPage = Math.max(1, Number.parseInt(searchParams.get('page') || '1', 10) || 1)
  const category = parseNotificationCategory(searchParams.get('category'))
  try {
    const result = await listUnifiedNotificationsPage(guard.user.id, { unreadOnly, page: requestedPage, pageSize, category })

    return NextResponse.json({
      notifications: result.items,
      items: result.items,
      unreadCount: result.unreadCount,
      page: result.page,
      pageSize: result.pageSize,
      limit: result.pageSize,
      total: result.total,
      totalPages: result.totalPages,
      hasMore: result.page < result.totalPages,
      degraded: result.degraded === true,
    }, { headers: privateHeaders })
  } catch (error) {
    logNotificationError('list', {
      userId: guard.user.id,
      page: requestedPage,
      pageSize,
      category,
    }, error)
    return NextResponse.json({
      ok: false,
      code: 'NOTIFICATIONS_UNAVAILABLE',
      message: '通知列表暂时无法加载，请稍后重试',
    }, { status: 503, headers: privateHeaders })
  }
}

export async function PATCH(request: Request) {
  const guard = await requireUser()
  if (!guard.user) return guard.response

  try {
    const body = await request.json().catch(() => null)
    const ids: NotificationReadInput[] = Array.isArray(body?.ids)
      ? body.ids.filter((item: unknown): item is NotificationReadInput => {
          return typeof item === 'object' && item !== null && typeof (item as { id?: unknown }).id === 'string'
        }).slice(0, NOTIFICATION_ID_BATCH_LIMIT)
      : []

    if (!ids.length) {
      await markAllUnifiedNotificationsRead(guard.user.id)
      emitRealtime(guard.user.id, 'notification')
      return NextResponse.json({ ok: true }, { headers: privateHeaders })
    }

    await Promise.all(ids.map((item) => markUnifiedNotificationRead(guard.user.id, item.source || 'personal', item.id)))
    emitRealtime(guard.user.id, 'notification')
    return NextResponse.json({ ok: true }, { headers: privateHeaders })
  } catch (error) {
    logNotificationError('read', { userId: guard.user.id }, error)
    return NextResponse.json({ ok: false, code: 'NOTIFICATIONS_ACTION_UNAVAILABLE', message: '通知暂时无法更新，请稍后重试' }, {
      status: 503,
      headers: privateHeaders,
    })
  }
}

export async function DELETE(request: Request) {
  const guard = await requireUser()
  if (!guard.user) return guard.response
  try {
    const body = await request.json().catch(() => null)
    const clearAll = body?.all === true || !Array.isArray(body?.ids)
    if (clearAll) {
      const result = await prisma.notification.deleteMany({
        where: { recipientId: guard.user.id },
      })
      const now = new Date()
      const systemNotifications = await prisma.systemNotification.findMany({
        where: { ...effectiveSystemNotificationWhere(now), type: { not: 'UPDATE' } },
        select: { id: true },
      })
      if (systemNotifications.length) {
        await prisma.systemNotificationRead.createMany({
          data: systemNotifications.map((item) => ({ notificationId: item.id, userId: guard.user.id, readAt: now })),
          skipDuplicates: true,
        })
      }
      emitRealtime(guard.user.id, 'notification')
      return NextResponse.json({
        ok: true,
        deleted: result.count,
        clearedAll: true,
        systemIds: systemNotifications.map((item) => item.id),
      }, { headers: privateHeaders })
    }
    const ids = Array.isArray(body?.ids)
      ? body.ids.filter((id: unknown): id is string => typeof id === 'string').slice(0, NOTIFICATION_ID_BATCH_LIMIT)
      : []
    const result = await prisma.notification.deleteMany({
      where: { recipientId: guard.user.id, ...(ids.length ? { id: { in: ids } } : {}) },
    })
    emitRealtime(guard.user.id, 'notification')
    return NextResponse.json({ ok: true, deleted: result.count }, { headers: privateHeaders })
  } catch (error) {
    logNotificationError('clear', { userId: guard.user.id }, error)
    return NextResponse.json({ ok: false, code: 'NOTIFICATIONS_ACTION_UNAVAILABLE', message: '通知暂时无法清除，请稍后重试' }, {
      status: 503,
      headers: privateHeaders,
    })
  }
}
