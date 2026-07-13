import { prisma } from '@/lib/prisma'

const MAX_NOTIFICATION_PAGE_SIZE = 50

export type UnifiedNotification = {
  id: string
  source: 'personal' | 'system'
  type: string
  title: string
  content: string | null
  link: string | null
  isRead: boolean
  createdAt: Date
  readAt: Date | null
}

export async function getUnreadNotificationCount(userId: string) {
  const now = new Date()
  const [personalUnread, systemUnread] = await Promise.all([
    prisma.notification.count({ where: { recipientId: userId, isRead: false } }),
    prisma.systemNotification.count({
      where: {
        isPublished: true,
        publishedAt: { lte: now },
        reads: { none: { userId } },
      },
    }),
  ])
  return personalUnread + systemUnread
}

export async function listUnifiedNotifications(userId: string, options: { unreadOnly?: boolean; limit?: number } = {}) {
  const now = new Date()
  const limit = Math.min(Math.max(options.limit || MAX_NOTIFICATION_PAGE_SIZE, 1), MAX_NOTIFICATION_PAGE_SIZE)
  const [personal, system] = await Promise.all([
    prisma.notification.findMany({
      where: {
        recipientId: userId,
        ...(options.unreadOnly ? { isRead: false } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
      select: {
        id: true,
        type: true,
        title: true,
        content: true,
        link: true,
        isRead: true,
        createdAt: true,
        readAt: true,
      },
    }),
    prisma.systemNotification.findMany({
      where: {
        isPublished: true,
        publishedAt: { lte: now },
        ...(options.unreadOnly ? { reads: { none: { userId } } } : {}),
      },
      orderBy: { publishedAt: 'desc' },
      take: limit,
      select: {
        id: true,
        type: true,
        title: true,
        content: true,
        link: true,
        publishedAt: true,
        reads: { where: { userId }, select: { readAt: true }, take: 1 },
      },
    }),
  ])

  const merged: UnifiedNotification[] = [
    ...personal.map((item) => ({
      id: item.id,
      source: 'personal' as const,
      type: item.type,
      title: item.title,
      content: item.content,
      link: item.link,
      isRead: item.isRead,
      createdAt: item.createdAt,
      readAt: item.readAt,
    })),
    ...system.map((item) => ({
      id: item.id,
      source: 'system' as const,
      type: item.type,
      title: item.title,
      content: item.content,
      link: item.link,
      isRead: item.reads.length > 0,
      createdAt: item.publishedAt,
      readAt: item.reads[0]?.readAt || null,
    })),
  ]

  return merged
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
    .slice(0, limit)
}

export async function markUnifiedNotificationRead(userId: string, source: string, id: string) {
  if (source === 'system') {
    const notification = await prisma.systemNotification.findFirst({
      where: { id, isPublished: true, publishedAt: { lte: new Date() } },
      select: { id: true },
    })
    if (!notification) return false
    await prisma.systemNotificationRead.upsert({
      where: { notificationId_userId: { notificationId: id, userId } },
      update: { readAt: new Date() },
      create: { notificationId: id, userId },
    })
    return true
  }

  const result = await prisma.notification.updateMany({
    where: { id, recipientId: userId, isRead: false },
    data: { isRead: true, readAt: new Date() },
  })
  return result.count > 0
}

export async function markAllUnifiedNotificationsRead(userId: string) {
  const now = new Date()
  const unreadSystem = await prisma.systemNotification.findMany({
    where: { isPublished: true, publishedAt: { lte: now }, reads: { none: { userId } } },
    select: { id: true },
    take: 500,
  })

  await prisma.$transaction([
    prisma.notification.updateMany({
      where: { recipientId: userId, isRead: false },
      data: { isRead: true, readAt: now },
    }),
    ...(unreadSystem.length
      ? [
          prisma.systemNotificationRead.createMany({
            data: unreadSystem.map((item) => ({ notificationId: item.id, userId, readAt: now })),
            skipDuplicates: true,
          }),
        ]
      : []),
  ])
}
