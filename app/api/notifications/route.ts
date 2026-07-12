import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireUser } from '@/lib/security'

const NOTIFICATION_ID_BATCH_LIMIT = 100
const NOTIFICATION_PAGE_SIZE = 50

export async function GET(request: Request) {
  const guard = await requireUser()
  if (!guard.user) return guard.response

  const { searchParams } = new URL(request.url)
  const unreadOnly = searchParams.get('unread') === '1'
  const page = Math.max(Number(searchParams.get('page') || 1), 1)
  const limit = Math.min(Math.max(Number(searchParams.get('limit') || NOTIFICATION_PAGE_SIZE), 1), NOTIFICATION_PAGE_SIZE)
  const skip = (page - 1) * limit

  const notifications = await prisma.notification.findMany({
    where: {
      recipientId: guard.user.id,
      ...(unreadOnly ? { isRead: false } : {}),
    },
    orderBy: { createdAt: 'desc' },
    skip,
    take: limit + 1,
    select: {
      id: true,
      type: true,
      title: true,
      content: true,
      link: true,
      isRead: true,
      createdAt: true,
      readAt: true,
      actor: { select: { id: true, nickname: true, avatarUrl: true } },
    },
  })
  const hasMore = notifications.length > limit

  const unreadCount = await prisma.notification.count({
    where: { recipientId: guard.user.id, isRead: false },
  })

  return NextResponse.json({
    notifications: hasMore ? notifications.slice(0, limit) : notifications,
    unreadCount,
    page,
    limit,
    hasMore,
  })
}

export async function PATCH(request: Request) {
  const guard = await requireUser()
  if (!guard.user) return guard.response

  const body = await request.json().catch(() => null)
  const ids = Array.isArray(body?.ids)
    ? body.ids.filter((id: unknown): id is string => typeof id === 'string' && id.length > 0).slice(0, NOTIFICATION_ID_BATCH_LIMIT)
    : []

  await prisma.notification.updateMany({
    where: {
      recipientId: guard.user.id,
      ...(ids.length ? { id: { in: ids } } : {}),
      isRead: false,
    },
    data: {
      isRead: true,
      readAt: new Date(),
    },
  })

  return NextResponse.json({ ok: true })
}
