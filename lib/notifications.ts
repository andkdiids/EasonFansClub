import { prisma } from '@/lib/prisma'
import { publicImageUrl } from '@/lib/images'
import { effectiveSystemNotificationOrder, effectiveSystemNotificationWhere } from '@/lib/system-notifications'
import type { SystemNotificationType } from '@prisma/client'
import { parseNotificationReplyTarget, type NotificationReplyTarget } from '@/lib/notification-target'
export { getNotificationTarget } from '@/lib/notification-target'

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
  BIRTHDAY_GREETING: '生日',
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
  if (type === 'MESSAGE') return 'messages'
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
  actorUid: number | null
  actorAvatarUrl: string | null
  popup: boolean
  sticky: boolean
  isRead: boolean
  read: boolean
  createdAt: Date
  readAt: Date | null
  replyTarget: NotificationReplyTarget | null
  replyDisabledReason: string | null
}

export type UnreadSummary = {
  notifications: number
  system: number
  replies: number
  likes: number
  feedbackReplies: number
  feedback: number
  friendRequests: number
  directMessages: number
  messages: number
  total: number
}

export async function getUnreadSummary(userId: string): Promise<UnreadSummary> {
  const now = new Date()
  const [otherPersonal, system, replies, likes, feedbackReplies, pendingFriendRequests, friendUpdates, directMessageRows] = await Promise.all([
    prisma.notification.count({ where: {
      recipientId: userId,
      isRead: false,
      type: { notIn: ['FRIEND_REQUEST', 'MESSAGE', 'REPLY', 'LIKE'] },
      NOT: { link: { startsWith: '/feedback/' } },
    } }),
    prisma.systemNotification.count({ where: { ...effectiveSystemNotificationWhere(now), type: { not: 'UPDATE' }, SystemNotificationRead: { none: { userId } } } }),
    prisma.notification.count({ where: { recipientId: userId, isRead: false, type: 'REPLY' } }),
    prisma.notification.count({ where: { recipientId: userId, isRead: false, type: 'LIKE' } }),
    prisma.feedback.count({ where: { userId, userUnread: true } }),
    prisma.friendRequest.count({ where: { receiverId: userId, status: 'PENDING' } }),
    prisma.notification.count({ where: {
      recipientId: userId,
      isRead: false,
      type: 'FRIEND_REQUEST',
      title: { not: '好友申请' },
    } }),
    prisma.$queryRaw<Array<{ unreadCount: bigint | number }>>`
      SELECT COUNT(*) AS unreadCount
      FROM DirectMessage dm
      INNER JOIN ConversationParticipant cp
        ON cp.conversationId = dm.conversationId
       AND cp.userId = ${userId}
      WHERE dm.senderId <> ${userId}
        AND dm.isDeleted = false
        AND cp.isDeleted = false
        AND (cp.lastReadAt IS NULL OR dm.createdAt > cp.lastReadAt)
    `,
  ])
  const directMessages = Number(directMessageRows[0]?.unreadCount || 0)
  const notifications = otherPersonal + system + replies + likes
  const friendRequests = pendingFriendRequests + friendUpdates
  return {
    notifications,
    system: system + otherPersonal,
    replies,
    likes,
    feedbackReplies,
    feedback: feedbackReplies,
    friendRequests,
    directMessages,
    messages: directMessages,
    total: notifications + feedbackReplies + friendRequests + directMessages,
  }
}

export async function getUnreadNotificationCount(userId: string) {
  return (await getUnreadSummary(userId)).total
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
        User_Notification_actorIdToUser: {
          select: {
            uid: true,
            nickname: true,
            avatarUrl: true,
            Profile: { select: { displayName: true, avatarUrl: true } },
          },
        },
      },
    }),
    prisma.systemNotification.findMany({
      where: {
        ...effectiveSystemNotificationWhere(now),
        type: { not: 'UPDATE' },
        ...(options.unreadOnly ? { SystemNotificationRead: { none: { userId } } } : {}),
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
        SystemNotificationRead: { where: { userId }, select: { readAt: true }, take: 1 },
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
      actorName: item.User_Notification_actorIdToUser?.Profile?.displayName || item.User_Notification_actorIdToUser?.nickname || null,
      actorUid: item.User_Notification_actorIdToUser?.uid || null,
      actorAvatarUrl: publicImageUrl(item.User_Notification_actorIdToUser?.Profile?.avatarUrl || item.User_Notification_actorIdToUser?.avatarUrl),
      popup: false,
      sticky: false,
      isRead: item.isRead,
      read: item.isRead,
      createdAt: item.createdAt,
      readAt: item.readAt,
      replyTarget: parseNotificationReplyTarget({
        id: item.id,
        source: 'personal',
        type: item.type,
        link: item.link,
        targetUrl: item.link,
      }),
      replyDisabledReason: null,
    })),
    ...system.map((item) => {
      const targetUrl = item.buttonUrl || item.link
      const isRead = item.SystemNotificationRead.length > 0
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
        actorUid: null,
        actorAvatarUrl: null,
        popup: item.popup,
        sticky: item.sticky,
        isRead,
        read: isRead,
        createdAt: item.publishAt || item.createdAt,
        readAt: item.SystemNotificationRead[0]?.readAt || null,
        replyTarget: null,
        replyDisabledReason: null,
      }
    }),
  ]

  const visible = merged
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
    .slice(0, limit)

  const targets = visible.flatMap((item) => item.replyTarget ? [item.replyTarget] : [])
  const postTargets = targets.filter((target) => target.kind === 'post')
  const dailyTargets = targets.filter((target) => target.kind === 'daily-message')
  const feedbackTargets = targets.filter((target) => target.kind === 'feedback')
  const wallTargets = targets.filter((target) => target.kind === 'profile-wall')
  const [postReplies, dailyComments, feedbacks, wallMessages] = await Promise.all([
    postTargets.length ? prisma.reply.findMany({
      where: { id: { in: postTargets.map((target) => target.parentId) }, isDeleted: false },
      select: { id: true, postId: true },
    }) : [],
    dailyTargets.length ? prisma.dailyMessageComment.findMany({
      where: { id: { in: dailyTargets.map((target) => target.parentId) }, isDeleted: false, DailyMessage: { isDeleted: false } },
      select: { id: true, messageId: true },
    }) : [],
    feedbackTargets.length ? prisma.feedback.findMany({
      where: { id: { in: feedbackTargets.map((target) => target.resourceId) }, userId },
      select: { id: true, status: true },
    }) : [],
    wallTargets.length ? prisma.profileWallMessage.findMany({
      where: { id: { in: wallTargets.map((target) => target.parentId) }, deletedAt: null },
      select: { id: true, User_ProfileWallMessage_receiverIdToUser: { select: { uid: true } } },
    }) : [],
  ])

  return visible.map((item) => {
    const target = item.replyTarget
    if (!target) return item
    if (target.kind === 'post' && !postReplies.some((reply) => reply.id === target.parentId && reply.postId === target.resourceId)) {
      return { ...item, replyDisabledReason: '该内容已被删除或无法查看' }
    }
    if (target.kind === 'daily-message' && !dailyComments.some((comment) => comment.id === target.parentId && comment.messageId === target.resourceId)) {
      return { ...item, replyDisabledReason: '该内容已被删除或无法查看' }
    }
    if (target.kind === 'feedback') {
      const feedback = feedbacks.find((row) => row.id === target.resourceId)
      if (!feedback) return { ...item, replyDisabledReason: '该内容已被删除或无法查看，或你没有查看权限' }
      if (feedback.status === 'RESOLVED' || feedback.status === 'CLOSED') {
        return { ...item, replyDisabledReason: '该反馈已关闭，无法回复' }
      }
    }
    if (target.kind === 'profile-wall' && !wallMessages.some((message) => message.id === target.parentId && String(message.User_ProfileWallMessage_receiverIdToUser.uid) === target.resourceId)) {
      return { ...item, replyDisabledReason: '该内容已被删除或无法查看' }
    }
    return item
  })
}

export async function listPopupSystemNotifications(userId: string, limit = 5) {
  const now = new Date()
  const items = await prisma.systemNotification.findMany({
    where: {
      ...effectiveSystemNotificationWhere(now),
      popup: true,
      type: { in: POPUP_SYSTEM_TYPES },
      SystemNotificationRead: { none: { userId } },
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
      actorUid: null,
      actorAvatarUrl: null,
      popup: item.popup,
      sticky: item.sticky,
      isRead: false,
      read: false,
      createdAt: item.publishAt || item.createdAt,
      readAt: null,
      replyTarget: null,
      replyDisabledReason: null,
    } satisfies UnifiedNotification
  })
}

export type MarkUnifiedNotificationReadResult = {
  ok: boolean
  readAt: Date | null
}

/**
 * Mark one notification as read and return the persisted timestamp.
 *
 * Keep this separate from the boolean helper below so existing batch callers
 * do not need to know about the response shape, while the single-item API can
 * send the server value back to the client (rather than inventing a local
 * timestamp).
 */
export async function markUnifiedNotificationReadWithState(userId: string, source: string, id: string): Promise<MarkUnifiedNotificationReadResult> {
  if (source === 'system') {
    const existingRead = await prisma.systemNotificationRead.findUnique({
      where: { notificationId_userId: { notificationId: id, userId } },
      select: { readAt: true },
    })
    // An item can expire between the list response and the click. Preserve
    // idempotence for a read row that already exists instead of returning 404.
    if (existingRead) return { ok: true, readAt: existingRead.readAt }

    const notification = await prisma.systemNotification.findFirst({
      where: { id, ...effectiveSystemNotificationWhere(new Date()) },
      select: { id: true },
    })
    if (!notification) return { ok: false, readAt: null }
    const read = await prisma.systemNotificationRead.upsert({
      where: { notificationId_userId: { notificationId: id, userId } },
      // A repeated read is idempotent: preserve the original timestamp.
      update: {},
      create: { notificationId: id, userId },
      select: { readAt: true },
    })
    return { ok: true, readAt: read.readAt }
  }

  const readAt = new Date()
  const result = await prisma.notification.updateMany({
    where: { id, recipientId: userId, isRead: false },
    data: { isRead: true, readAt },
  })

  if (result.count > 0) return { ok: true, readAt }

  // Marking an already-read row is idempotent. This also handles two tabs
  // racing to read the same notification without turning a successful read
  // into a misleading 404 response.
  const existing = await prisma.notification.findFirst({
    where: { id, recipientId: userId },
    select: { isRead: true, readAt: true },
  })
  return existing?.isRead ? { ok: true, readAt: existing.readAt } : { ok: false, readAt: null }
}

/** Backwards-compatible boolean helper used by batch/read-all callers. */
export async function markUnifiedNotificationRead(userId: string, source: string, id: string) {
  return (await markUnifiedNotificationReadWithState(userId, source, id)).ok
}

export async function markAllUnifiedNotificationsRead(userId: string) {
  const now = new Date()
  const unreadSystem = await prisma.systemNotification.findMany({
    where: { ...effectiveSystemNotificationWhere(now), type: { not: 'UPDATE' }, SystemNotificationRead: { none: { userId } } },
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
