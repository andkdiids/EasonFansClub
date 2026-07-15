import { prisma } from '@/lib/prisma'
import { publicImageUrl } from '@/lib/images'
import { effectiveSystemNotificationOrder, effectiveSystemNotificationWhere } from '@/lib/system-notifications'
import type { SystemNotificationType } from '@prisma/client'

const MAX_NOTIFICATION_PAGE_SIZE = 50
const POPUP_SYSTEM_TYPES: SystemNotificationType[] = ['SYSTEM', 'ANNOUNCEMENT', 'MAINTENANCE', 'SECURITY']

const personalTypeLabels: Record<string, string> = {
  REPLY: '回复',
  LIKE: '点赞',
  FRIEND_REQUEST: '好友',
  SYSTEM: '系统',
  MESSAGE: '消息',
  ACTIVITY: '活动',
  ADMIN: '系统',
  FOLLOW: '关注',
  BADGE: '勋章',
}

const systemTypeLabels: Record<string, string> = {
  SYSTEM: '系统',
  UPDATE: '更新日志',
  ANNOUNCEMENT: '公告',
  ACTIVITY: '活动',
  MAINTENANCE: '维护',
  SECURITY: '安全',
}

function getNotificationCategory(type: string, link?: string | null) {
  if (link?.startsWith('/feedback/')) return 'feedback'
  if (type === 'REPLY') return 'reply'
  if (type === 'LIKE') return 'like'
  if (type === 'FRIEND_REQUEST' || type === 'FOLLOW') return 'friend'
  return 'system'
}

function getNotificationTypeLabel(type: string, link?: string | null, source?: 'personal' | 'system') {
  if (link?.startsWith('/feedback/')) return '反馈'
  return source === 'system' ? systemTypeLabels[type] || type : personalTypeLabels[type] || type
}

export type UnifiedNotification = {
  id: string
  source: 'personal' | 'system'
  type: string
  typeLabel: string
  category: string
  title: string
  content: string | null
  link: string | null
  targetUrl: string | null
  actorName: string | null
  actorAvatarUrl: string | null
  popup: boolean
  sticky: boolean
  isRead: boolean
  read: boolean
  createdAt: Date
  readAt: Date | null
}

export async function getUnreadNotificationCount(userId: string) {
  const now = new Date()
  const [personalUnread, systemUnread] = await Promise.all([
    prisma.notification.count({ where: { recipientId: userId, isRead: false } }),
    prisma.systemNotification.count({
      where: {
        ...effectiveSystemNotificationWhere(now),
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
        actor: {
          select: {
            nickname: true,
            avatarUrl: true,
            profile: { select: { displayName: true, avatarUrl: true } },
          },
        },
      },
    }),
    prisma.systemNotification.findMany({
      where: {
        ...effectiveSystemNotificationWhere(now),
        ...(options.unreadOnly ? { reads: { none: { userId } } } : {}),
      },
      orderBy: effectiveSystemNotificationOrder,
      take: limit,
      select: {
        id: true,
        type: true,
        title: true,
        content: true,
        link: true,
        buttonUrl: true,
        popup: true,
        sticky: true,
        publishAt: true,
        createdAt: true,
        reads: { where: { userId }, select: { readAt: true }, take: 1 },
      },
    }),
  ])

  const merged: UnifiedNotification[] = [
    ...personal.map((item) => ({
      id: item.id,
      source: 'personal' as const,
      type: item.type,
      typeLabel: getNotificationTypeLabel(item.type, item.link, 'personal'),
      category: getNotificationCategory(item.type, item.link),
      title: item.title,
      content: item.content,
      link: item.link,
      targetUrl: item.link,
      actorName: item.actor?.profile?.displayName || item.actor?.nickname || null,
      actorAvatarUrl: publicImageUrl(item.actor?.profile?.avatarUrl || item.actor?.avatarUrl),
      popup: false,
      sticky: false,
      isRead: item.isRead,
      read: item.isRead,
      createdAt: item.createdAt,
      readAt: item.readAt,
    })),
    ...system.map((item) => {
      const targetUrl = item.buttonUrl || item.link
      const isRead = item.reads.length > 0
      return {
        id: item.id,
        source: 'system' as const,
        type: item.type,
        typeLabel: getNotificationTypeLabel(item.type, targetUrl, 'system'),
        category: getNotificationCategory(item.type, targetUrl),
        title: item.title,
        content: item.content,
        link: targetUrl,
        targetUrl,
        actorName: null,
        actorAvatarUrl: null,
        popup: item.popup,
        sticky: item.sticky,
        isRead,
        read: isRead,
        createdAt: item.publishAt || item.createdAt,
        readAt: item.reads[0]?.readAt || null,
      }
    }),
  ]

  return merged
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
    .slice(0, limit)
}

export async function listPopupSystemNotifications(userId: string, limit = 5) {
  const now = new Date()
  const items = await prisma.systemNotification.findMany({
    where: {
      ...effectiveSystemNotificationWhere(now),
      popup: true,
      type: { in: POPUP_SYSTEM_TYPES },
      reads: { none: { userId } },
    },
    orderBy: effectiveSystemNotificationOrder,
    take: Math.min(Math.max(limit, 1), 10),
    select: {
      id: true,
      type: true,
      title: true,
      content: true,
      link: true,
      buttonUrl: true,
      popup: true,
      sticky: true,
      publishAt: true,
      createdAt: true,
    },
  })

  return items.map((item) => {
    const targetUrl = item.buttonUrl || item.link
    return {
      id: item.id,
      source: 'system' as const,
      type: item.type,
      typeLabel: getNotificationTypeLabel(item.type, targetUrl, 'system'),
      category: getNotificationCategory(item.type, targetUrl),
      title: item.title,
      content: item.content,
      link: targetUrl,
      targetUrl,
      actorName: null,
      actorAvatarUrl: null,
      popup: item.popup,
      sticky: item.sticky,
      isRead: false,
      read: false,
      createdAt: item.publishAt || item.createdAt,
      readAt: null,
    } satisfies UnifiedNotification
  })
}

export async function markUnifiedNotificationRead(userId: string, source: string, id: string) {
  if (source === 'system') {
    const notification = await prisma.systemNotification.findFirst({
      where: { id, ...effectiveSystemNotificationWhere(new Date()) },
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
    where: { ...effectiveSystemNotificationWhere(now), reads: { none: { userId } } },
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
