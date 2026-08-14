import { prisma } from '@/lib/prisma'
import { getPublicUserDisplayName, loadFriendRemarkMap, resolveFriendDisplayName } from '@/lib/friend-remarks'
import { publicImageUrl } from '@/lib/images'
import { effectiveSystemNotificationOrder, effectiveSystemNotificationWhere } from '@/lib/system-notifications'
import { Prisma, type NotificationType, type SystemNotificationType } from '@prisma/client'
import { parseNotificationReplyTarget, type NotificationReplyTarget } from '@/lib/notification-target'
import { compareNotificationOrder } from '@/lib/notification-order'
import { clampPaginationPage } from '@/lib/pagination'
import { formatLikeNotificationText, loadLikeNotificationStats, parseLikeNotificationTarget, reconcileLikeNotifications, type LikeNotificationTargetKind } from '@/lib/like-notifications'
export { getNotificationTarget } from '@/lib/notification-target'

const MAX_NOTIFICATION_PAGE_SIZE = 50
export const notificationCategoryValues = ['all', 'reply', 'like', 'friend', 'messages', 'feedback', 'system'] as const
export type NotificationCategory = typeof notificationCategoryValues[number]
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
  GUESS_SONG_DUEL_INVITE: '听听·对决',
  USER_REWARD: '获得奖励',
}

const systemTypeLabels: Record<string, string> = {
  SYSTEM: '系统',
  UPDATE: '更新日志',
  ANNOUNCEMENT: '公告',
  ACTIVITY: '活动',
  MAINTENANCE: '维护',
  SECURITY: '安全',
}

export function getNotificationCategory(type: string, link?: string | null) {
  if (link?.startsWith('/feedback/')) return 'feedback'
  if (type === 'REPLY') return 'reply'
  if (type === 'LIKE') return 'like'
  if (type === 'FRIEND_REQUEST' || type === 'FOLLOW' || type === 'GUESS_SONG_DUEL_INVITE') return 'friend'
  if (type === 'MESSAGE') return 'messages'
  return 'system'
}

/**
 * All personal-notification reads must start from the same recipient scope.
 * Keeping this in one place prevents the list, summary and read endpoints from
 * slowly drifting apart again.
 */
export function getNotificationVisibilityFilter(userId: string, extra: Prisma.NotificationWhereInput = {}): Prisma.NotificationWhereInput {
  return { recipientId: userId, ...extra }
}

export function getUnreadNotificationWhere(userId: string, extra: Prisma.NotificationWhereInput = {}): Prisma.NotificationWhereInput {
  // isRead is the canonical unread flag. readAt is only an audit timestamp.
  return getNotificationVisibilityFilter(userId, { isRead: false, ...extra })
}

export function getNotificationCategoryFilter(category: string): Prisma.NotificationWhereInput {
  if (category === 'all') return {}
  if (category === 'reply') return { type: 'REPLY' }
  if (category === 'like') return { type: 'LIKE' }
  if (category === 'friend') return { type: { in: ['FRIEND_REQUEST', 'FOLLOW', 'GUESS_SONG_DUEL_INVITE'] } }
  if (category === 'messages') return { type: 'MESSAGE' }
  if (category === 'feedback') return { link: { startsWith: '/feedback/' } }
  return {
    type: { notIn: ['REPLY', 'LIKE', 'FRIEND_REQUEST', 'FOLLOW', 'GUESS_SONG_DUEL_INVITE', 'MESSAGE'] },
    OR: [{ link: null }, { link: { not: { startsWith: '/feedback/' } } }],
  }
}

export function parseNotificationCategory(value: unknown): NotificationCategory {
  return notificationCategoryValues.includes(value as NotificationCategory)
    ? value as NotificationCategory
    : 'all'
}

function getSystemNotificationCategoryFilter(category: NotificationCategory): Prisma.SystemNotificationWhereInput {
  if (category === 'all') return {}
  if (category === 'feedback') return { link: { startsWith: '/feedback/' } }
  if (category === 'system') return { OR: [{ link: null }, { link: { not: { startsWith: '/feedback/' } } }] }
  return { id: { in: [] } }
}

// These clauses contain only fixed, code-defined category values. They let the
// database page the union of personal and system notifications before the
// application loads actor/target details, so an unread row can never be left
// behind on a later page.
function getPersonalNotificationCategorySql(category: NotificationCategory) {
  switch (category) {
    case 'reply': return Prisma.raw("AND n.type = 'REPLY'")
    case 'like': return Prisma.raw("AND n.type = 'LIKE'")
    case 'friend': return Prisma.raw("AND n.type IN ('FRIEND_REQUEST', 'FOLLOW', 'GUESS_SONG_DUEL_INVITE')")
    case 'messages': return Prisma.raw("AND n.type = 'MESSAGE'")
    case 'feedback': return Prisma.raw("AND n.link LIKE '/feedback/%'")
    case 'system': return Prisma.raw("AND n.type NOT IN ('REPLY', 'LIKE', 'FRIEND_REQUEST', 'FOLLOW', 'GUESS_SONG_DUEL_INVITE', 'MESSAGE') AND (n.link IS NULL OR n.link NOT LIKE '/feedback/%')")
    default: return Prisma.empty
  }
}

function getSystemNotificationCategorySql(category: NotificationCategory) {
  if (category === 'feedback') return Prisma.raw("AND sn.link LIKE '/feedback/%'")
  if (category === 'system') return Prisma.raw("AND (sn.link IS NULL OR sn.link NOT LIKE '/feedback/%')")
  if (category !== 'all') return Prisma.raw('AND 1 = 0')
  return Prisma.empty
}

export const FRIEND_REQUEST_NOTIFICATION_KEY_PREFIX = 'friend-request:'
export const FRIEND_REQUEST_ACCEPTED_NOTIFICATION_KEY_PREFIX = 'friend-request-accepted:'

export function getFriendRequestNotificationKey(requestId: string) {
  return `${FRIEND_REQUEST_NOTIFICATION_KEY_PREFIX}${requestId}`
}

export function getFriendRequestAcceptedNotificationKey(requestId: string) {
  return `${FRIEND_REQUEST_ACCEPTED_NOTIFICATION_KEY_PREFIX}${requestId}`
}

function getNotificationTypeLabel(type: string, link?: string | null, source?: 'personal' | 'system') {
  if (link?.startsWith('/feedback/')) return '反馈'
  return source === 'system' ? systemTypeLabels[type] || type : personalTypeLabels[type] || type
}

const dynamicActorSuffixes = [
  '点赞了你的帖子',
  '点赞了你的回复',
  '点赞了你的挂号留言',
  '赞了你的留言',
  '回复了你的评论',
  '回复了你的帖子',
  '评论了你的挂号留言',
  '回复了你的留言',
  '给你留言了',
  '关注了你',
  '向你发送了好友申请',
  '在回复中提到了你',
]

function resolveNotificationActorText(value: string | null, actorName: string | null) {
  if (!value || !actorName) return value
  for (const suffix of dynamicActorSuffixes) {
    const index = value.indexOf(suffix)
    if (index <= 0) continue
    const hasSpace = /\s/.test(value[index - 1] || '')
    return `${actorName}${hasSpace ? ' ' : ''}${value.slice(index)}`
  }
  return value
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
  likeCount?: number | null
  likeTargetKind?: LikeNotificationTargetKind | null
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

export type UnreadPersonalCounts = {
  replies: number
  likes: number
  friendRequests: number
  messages: number
  feedback: number
  system: number
}

type DailyCommentNotificationRow = {
  id: string
  messageId: string
  isDeleted: boolean
  DailyMessage: { isDeleted: boolean }
}

async function loadDailyNotificationComments(
  targets: Array<Extract<NotificationReplyTarget, { kind: 'daily-message' }>>,
  label: string,
) {
  if (!targets.length) return { rows: [] as DailyCommentNotificationRow[], failed: false }

  try {
    const rows = await prisma.dailyMessageComment.findMany({
      where: { id: { in: Array.from(new Set(targets.map((target) => target.parentId))) } },
      select: {
        id: true,
        messageId: true,
        isDeleted: true,
        DailyMessage: { select: { isDeleted: true } },
      },
    })
    return { rows, failed: false }
  } catch (error) {
    console.error(`[notifications:${label}:daily-comment-lookup-failed]`, error)
    return { rows: [] as DailyCommentNotificationRow[], failed: true }
  }
}

async function reconcileStalePersonalNotifications(userId: string) {
  const unread = await prisma.notification.findMany({
    where: getUnreadNotificationWhere(userId),
    select: {
      id: true,
      type: true,
      title: true,
      link: true,
      createdAt: true,
      key: true,
      actorId: true,
      User_Notification_actorIdToUser: { select: { id: true } },
    },
  })
  if (!unread.length) return

  const targetRows = unread.map((item) => ({
    item,
    target: parseNotificationReplyTarget({
      id: item.id,
      source: 'personal' as const,
      type: item.type,
      link: item.link,
      targetUrl: item.link,
    }),
  }))
  const postTargets = targetRows.flatMap(({ target }) => target?.kind === 'post' ? [target] : [])
  const dailyTargets = targetRows.flatMap(({ target }) => target?.kind === 'daily-message' ? [target] : [])
  const feedbackTargets = targetRows.flatMap(({ target }) => target?.kind === 'feedback' ? [target] : [])
  const wallTargets = targetRows.flatMap(({ target }) => target?.kind === 'profile-wall' ? [target] : [])

  const requestIds = unread.flatMap(({ key }) => {
    if (key?.startsWith(FRIEND_REQUEST_NOTIFICATION_KEY_PREFIX)) return [key.slice(FRIEND_REQUEST_NOTIFICATION_KEY_PREFIX.length)]
    if (key?.startsWith(FRIEND_REQUEST_ACCEPTED_NOTIFICATION_KEY_PREFIX)) return [key.slice(FRIEND_REQUEST_ACCEPTED_NOTIFICATION_KEY_PREFIX.length)]
    return []
  })
  const legacyIncomingActorIds = unread.flatMap((item) => (
    item.type === 'FRIEND_REQUEST' && !item.key && item.title === '好友申请' && item.actorId ? [item.actorId] : []
  ))

  const [requests, legacyIncomingRequests, postReplies, dailyCommentLookup, feedbacks, wallMessages] = await Promise.all([
    requestIds.length ? prisma.friendRequest.findMany({
      where: { id: { in: Array.from(new Set(requestIds)) } },
      select: { id: true, status: true, senderId: true, receiverId: true },
    }) : [],
    legacyIncomingActorIds.length ? prisma.friendRequest.findMany({
      where: { receiverId: userId, senderId: { in: Array.from(new Set(legacyIncomingActorIds)) } },
      select: { senderId: true, status: true, createdAt: true },
    }) : [],
    postTargets.length ? prisma.reply.findMany({
      where: { id: { in: postTargets.map((target) => target.parentId) }, isDeleted: false },
      select: { id: true, postId: true },
    }) : [],
    loadDailyNotificationComments(dailyTargets, 'reconcile'),
    feedbackTargets.length ? prisma.feedback.findMany({
      where: { id: { in: feedbackTargets.map((target) => target.resourceId) }, userId },
      select: { id: true },
    }) : [],
    wallTargets.length ? prisma.profileWallMessage.findMany({
      where: { id: { in: wallTargets.map((target) => target.parentId) }, deletedAt: null },
      select: { id: true, User_ProfileWallMessage_receiverIdToUser: { select: { uid: true } } },
    }) : [],
  ])
  const dailyComments = dailyCommentLookup.rows

  const requestById = new Map(requests.map((request) => [request.id, request]))
  const pendingLegacyIncomingRequests = new Map(legacyIncomingRequests
    .filter((request) => request.status === 'PENDING')
    .map((request) => [request.senderId, request.createdAt]))
  const staleIds = new Set<string>()

  for (const { item, target } of targetRows) {
    if ((item.type === 'FRIEND_REQUEST' || item.type === 'FOLLOW') && item.actorId && !item.User_Notification_actorIdToUser) {
      staleIds.add(item.id)
      continue
    }

    if (item.type === 'FRIEND_REQUEST' && item.key?.startsWith(FRIEND_REQUEST_NOTIFICATION_KEY_PREFIX)) {
      const request = requestById.get(item.key.slice(FRIEND_REQUEST_NOTIFICATION_KEY_PREFIX.length))
      if (!request || request.receiverId !== userId || request.status !== 'PENDING') staleIds.add(item.id)
    } else if (item.type === 'FRIEND_REQUEST' && item.key?.startsWith(FRIEND_REQUEST_ACCEPTED_NOTIFICATION_KEY_PREFIX)) {
      const request = requestById.get(item.key.slice(FRIEND_REQUEST_ACCEPTED_NOTIFICATION_KEY_PREFIX.length))
      if (!request || request.senderId !== userId || request.status !== 'ACCEPTED') staleIds.add(item.id)
    } else if (item.type === 'FRIEND_REQUEST' && !item.key && item.title === '好友申请' && item.actorId) {
      // Legacy rows did not store requestId. Keep only the row created for the
      // currently pending request; older rows from a processed request are
      // historical ghosts and can be retired safely.
      const pendingCreatedAt = pendingLegacyIncomingRequests.get(item.actorId)
      if (!pendingCreatedAt || item.createdAt < pendingCreatedAt) staleIds.add(item.id)
    }

    if (!target) continue
    if (target.kind === 'post' && !postReplies.some((reply) => reply.id === target.parentId && reply.postId === target.resourceId)) staleIds.add(item.id)
    if (target.kind === 'daily-message' && !dailyCommentLookup.failed && !dailyComments.some((comment) => comment.id === target.parentId && comment.messageId === target.resourceId && !comment.isDeleted && !comment.DailyMessage.isDeleted)) staleIds.add(item.id)
    if (target.kind === 'feedback' && !feedbacks.some((feedback) => feedback.id === target.resourceId)) staleIds.add(item.id)
    if (target.kind === 'profile-wall' && !wallMessages.some((message) => message.id === target.parentId && String(message.User_ProfileWallMessage_receiverIdToUser.uid) === target.resourceId)) staleIds.add(item.id)
  }

  if (staleIds.size) {
    await prisma.notification.updateMany({
      where: getUnreadNotificationWhere(userId, { id: { in: Array.from(staleIds) } }),
      data: { isRead: true, readAt: new Date() },
    })
  }
}

async function getDirectMessageUnreadCount(userId: string) {
  try {
    const rows = await prisma.$queryRaw<Array<{ unreadCount: bigint | number }>>`
      SELECT COUNT(*) AS unreadCount
      FROM DirectMessage dm
      INNER JOIN ConversationParticipant cp
        ON cp.conversationId = dm.conversationId
       AND cp.userId = ${userId}
      WHERE dm.senderId <> ${userId}
        AND dm.isDeleted = false
        AND cp.isDeleted = false
        AND (cp.clearedAt IS NULL OR dm.createdAt > cp.clearedAt)
        AND (cp.lastReadAt IS NULL OR dm.createdAt > cp.lastReadAt)
    `
    return Number(rows[0]?.unreadCount || 0)
  } catch (error) {
    // ConversationParticipant.clearedAt was added after the original private
    // message schema. Keep notification counts usable while an older database
    // is being migrated, but do not turn a second database failure into zero.
    console.warn('[notifications.unread-summary.direct-messages-compat]', {
      userId,
      error: error instanceof Error ? error.name : 'unknown',
    })
    const rows = await prisma.$queryRaw<Array<{ unreadCount: bigint | number }>>`
      SELECT COUNT(*) AS unreadCount
      FROM DirectMessage dm
      INNER JOIN ConversationParticipant cp
        ON cp.conversationId = dm.conversationId
       AND cp.userId = ${userId}
      WHERE dm.senderId <> ${userId}
        AND dm.isDeleted = false
        AND cp.isDeleted = false
        AND (cp.lastReadAt IS NULL OR dm.createdAt > cp.lastReadAt)
    `
    return Number(rows[0]?.unreadCount || 0)
  }
}

export function buildUnreadSummary(personal: UnreadPersonalCounts, systemCount: number, directMessages: number): UnreadSummary {
  const system = personal.system + systemCount
  const notifications = system + personal.replies + personal.likes
  const friendRequests = personal.friendRequests
  const feedbackReplies = personal.feedback
  return {
    notifications,
    system,
    replies: personal.replies,
    likes: personal.likes,
    feedbackReplies,
    feedback: feedbackReplies,
    friendRequests,
    directMessages,
    messages: directMessages,
    total: notifications + feedbackReplies + friendRequests + directMessages,
  }
}

export async function getUnreadSummary(userId: string): Promise<UnreadSummary> {
  await reconcileLikeNotifications(userId)
  const now = new Date()
  const [personalRows, systemCount, directMessages] = await Promise.all([
    prisma.$queryRaw<Array<{
      replies: bigint | number
      likes: bigint | number
      friendRequests: bigint | number
      messages: bigint | number
      feedback: bigint | number
      systemCount: bigint | number
    }>>`
      SELECT
        COUNT(CASE WHEN n.type = 'REPLY' AND (n.link IS NULL OR n.link NOT LIKE '/feedback/%') THEN 1 END) AS replies,
        COUNT(CASE WHEN n.type = 'LIKE' AND (n.link IS NULL OR n.link NOT LIKE '/feedback/%') THEN 1 END) AS likes,
        COUNT(CASE WHEN n.type IN ('FRIEND_REQUEST', 'FOLLOW', 'GUESS_SONG_DUEL_INVITE') AND (n.link IS NULL OR n.link NOT LIKE '/feedback/%') THEN 1 END) AS friendRequests,
        COUNT(CASE WHEN n.type = 'MESSAGE' AND (n.link IS NULL OR n.link NOT LIKE '/feedback/%') THEN 1 END) AS messages,
        COUNT(CASE WHEN n.link LIKE '/feedback/%' THEN 1 END) AS feedback,
        COUNT(CASE WHEN n.type NOT IN ('REPLY', 'LIKE', 'FRIEND_REQUEST', 'FOLLOW', 'GUESS_SONG_DUEL_INVITE', 'MESSAGE') AND (n.link IS NULL OR n.link NOT LIKE '/feedback/%') THEN 1 END) AS systemCount
      FROM Notification n
      WHERE n.recipientId = ${userId}
        AND n.isRead = 0
    `,
    prisma.systemNotification.count({ where: { ...effectiveSystemNotificationWhere(now), type: { not: 'UPDATE' }, SystemNotificationRead: { none: { userId } } } }),
    getDirectMessageUnreadCount(userId),
  ])

  const personalRow = personalRows[0]
  const personalCounts = {
    replies: Number(personalRow?.replies || 0),
    likes: Number(personalRow?.likes || 0),
    friendRequests: Number(personalRow?.friendRequests || 0),
    messages: Number(personalRow?.messages || 0),
    feedback: Number(personalRow?.feedback || 0),
    system: Number(personalRow?.systemCount || 0),
  }

  // Direct messages have their own conversation read cursor and are rendered
  // by the notification center as a dedicated entry, not as Notification rows.
  const summary = buildUnreadSummary(personalCounts, systemCount, directMessages)
  console.info('[notifications.unread-summary]', {
    userId,
    total: summary.total,
    reply: summary.replies,
    like: summary.likes,
    request: summary.friendRequests,
    message: summary.messages,
    feedback: summary.feedback,
    system: summary.system,
  })
  return summary
}

export async function getUnreadNotificationCount(userId: string) {
  return (await getUnreadSummary(userId)).total
}

export type UnifiedNotificationPage = {
  items: UnifiedNotification[]
  total: number
  page: number
  pageSize: number
  totalPages: number
  unreadCount: number
}

type NotificationPageRow = {
  id: string
  source: string
  isRead: boolean | number
  createdAt: Date | string
}

export async function listUnifiedNotificationsPage(userId: string, options: {
  unreadOnly?: boolean
  page?: number
  pageSize?: number
  category?: NotificationCategory
} = {}): Promise<UnifiedNotificationPage> {
  await reconcileLikeNotifications(userId)
  await reconcileStalePersonalNotifications(userId)
  const now = new Date()
  const category = parseNotificationCategory(options.category)
  const pageSize = Math.min(Math.max(Math.trunc(options.pageSize || 20) || 20, 1), MAX_NOTIFICATION_PAGE_SIZE)
  const personalCategory = category === 'all' ? {} : getNotificationCategoryFilter(category)
  const systemCategory = getSystemNotificationCategoryFilter(category)
  const personalWhere = getNotificationVisibilityFilter(userId, {
    ...personalCategory,
    ...(options.unreadOnly ? { isRead: false } : {}),
  })
  const systemWhere = {
    ...effectiveSystemNotificationWhere(now),
    type: { not: 'UPDATE' as const },
    ...systemCategory,
    ...(options.unreadOnly ? { SystemNotificationRead: { none: { userId } } } : {}),
  }
  const [personalTotal, systemTotal, personalUnread, systemUnread] = await Promise.all([
    prisma.notification.count({ where: personalWhere }),
    prisma.systemNotification.count({ where: systemWhere }),
    prisma.notification.count({ where: getNotificationVisibilityFilter(userId, { ...personalCategory, isRead: false }) }),
    prisma.systemNotification.count({ where: { ...systemWhere, SystemNotificationRead: { none: { userId } } } }),
  ])
  const total = personalTotal + systemTotal
  const totalPages = Math.max(1, Math.ceil(total / pageSize))
  const page = clampPaginationPage(options.page || 1, totalPages)
  const offset = (page - 1) * pageSize
  const personalCategorySql = getPersonalNotificationCategorySql(category)
  const systemCategorySql = getSystemNotificationCategorySql(category)
  const unreadPersonalSql = options.unreadOnly ? Prisma.sql`AND n.isRead = 0` : Prisma.empty
  const unreadSystemSql = options.unreadOnly ? Prisma.sql`AND snr.id IS NULL` : Prisma.empty
  const rows = await prisma.$queryRaw<NotificationPageRow[]>(Prisma.sql`
    SELECT n.id AS id, 'personal' AS source, n.isRead AS isRead, n.createdAt AS createdAt
    FROM Notification n
    WHERE n.recipientId = ${userId}
      ${personalCategorySql}
      ${unreadPersonalSql}
    UNION ALL
    SELECT sn.id AS id, 'system' AS source,
      CASE WHEN snr.id IS NULL THEN 0 ELSE 1 END AS isRead,
      COALESCE(sn.publishAt, sn.createdAt) AS createdAt
    FROM SystemNotification sn
    LEFT JOIN SystemNotificationRead snr
      ON snr.notificationId = sn.id AND snr.userId = ${userId}
    WHERE sn.published = 1
      AND sn.publishAt <= ${now}
      AND (sn.expireAt IS NULL OR sn.expireAt > ${now})
      AND sn.type <> 'UPDATE'
      ${systemCategorySql}
      ${unreadSystemSql}
    ORDER BY isRead ASC, createdAt DESC, source ASC, id ASC
    LIMIT ${pageSize} OFFSET ${offset}
  `)

  const personalIds = rows.filter((row) => row.source === 'personal').map((row) => row.id)
  const systemIds = rows.filter((row) => row.source === 'system').map((row) => row.id)
  const [personal, system] = await Promise.all([
    personalIds.length ? prisma.notification.findMany({
      where: { recipientId: userId, id: { in: personalIds } },
      select: {
        id: true,
        type: true,
        title: true,
        content: true,
        link: true,
        key: true,
        isRead: true,
        createdAt: true,
        readAt: true,
        User_Notification_actorIdToUser: {
          select: {
            id: true,
            uid: true,
            nickname: true,
            usernameModerationStatus: true,
            nicknameModerationStatus: true,
            avatarUrl: true,
            Profile: { select: { displayName: true, displayNameModerationStatus: true, avatarUrl: true } },
          },
        },
      },
    }) : [],
    systemIds.length ? prisma.systemNotification.findMany({
      where: { id: { in: systemIds }, ...effectiveSystemNotificationWhere(now), type: { not: 'UPDATE' }, ...systemCategory },
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
    }) : [],
  ])

  const actorIds = personal.flatMap((item) => item.User_Notification_actorIdToUser ? [item.User_Notification_actorIdToUser.id] : [])
  const likeTargets = personal.flatMap((item) => {
    if (item.type !== 'LIKE') return []
    const target = parseLikeNotificationTarget({ type: item.type, key: item.key, link: item.link })
    return target ? [target] : []
  })
  const [remarkMap, likeCounts] = await Promise.all([
    loadFriendRemarkMap(userId, actorIds),
    loadLikeNotificationStats(likeTargets),
  ])
  const personalById = new Map(personal.map((item) => [item.id, item]))
  const systemById = new Map(system.map((item) => [item.id, item]))
  const merged: UnifiedNotification[] = rows.flatMap((row): UnifiedNotification[] => {
    if (row.source === 'personal') {
      const item = personalById.get(row.id)
      if (!item) return []
      const actor = item.User_Notification_actorIdToUser
      const actorName = actor
        ? resolveFriendDisplayName({
            viewerId: userId,
            targetUserId: actor.id,
            fallbackName: getPublicUserDisplayName(actor),
            remarkMap,
        })
        : null
      const likeTarget = item.type === 'LIKE'
        ? parseLikeNotificationTarget({ type: item.type, key: item.key, link: item.link })
        : null
      const likeCount = likeTarget ? likeCounts.get(`${likeTarget.kind}:${likeTarget.id}`) ?? null : null
      const likeTitle = likeTarget && likeCount !== null && likeCount > 0
        ? formatLikeNotificationText(actorName, likeCount, likeTarget.kind)
        : null
      return [{
        id: item.id,
        source: 'personal' as const,
        type: item.type,
        typeLabel: getNotificationTypeLabel(item.type, item.link, 'personal'),
        category: getNotificationCategory(item.type, item.link),
        title: likeTitle || resolveNotificationActorText(item.title, actorName) || getNotificationTypeLabel(item.type, item.link, 'personal'),
        content: likeTitle ? null : resolveNotificationActorText(item.content, actorName),
        link: item.link,
        targetUrl: item.link,
        actorName,
        actorUid: actor?.uid || null,
        actorAvatarUrl: publicImageUrl(actor?.Profile?.avatarUrl || actor?.avatarUrl),
        likeCount,
        likeTargetKind: likeTarget?.kind || null,
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
      } satisfies UnifiedNotification]
    }
    const item = systemById.get(row.id)
    if (!item) return []
    const targetUrl = item.buttonUrl || item.link
    const isRead = item.SystemNotificationRead.length > 0
    return [{
      id: item.id,
      source: 'system' as const,
      type: item.type,
      typeLabel: getNotificationTypeLabel(item.type, targetUrl, 'system'),
      category: getNotificationCategory(item.type, targetUrl),
      title: item.title || getNotificationTypeLabel(item.type, targetUrl, 'system'),
      content: item.content || null,
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
    } satisfies UnifiedNotification]
  }).sort(compareNotificationOrder)

  const targets = merged.flatMap((item) => item.replyTarget ? [item.replyTarget] : [])
  const postTargets = targets.filter((target) => target.kind === 'post')
  const dailyTargets = targets.filter((target) => target.kind === 'daily-message')
  const feedbackTargets = targets.filter((target) => target.kind === 'feedback')
  const wallTargets = targets.filter((target) => target.kind === 'profile-wall')
  const [postReplies, dailyCommentLookup, feedbacks, wallMessages] = await Promise.all([
    postTargets.length ? prisma.reply.findMany({
      where: { id: { in: postTargets.map((target) => target.parentId) }, isDeleted: false },
      select: { id: true, postId: true },
    }) : [],
    loadDailyNotificationComments(dailyTargets, 'list'),
    feedbackTargets.length ? prisma.feedback.findMany({
      where: { id: { in: feedbackTargets.map((target) => target.resourceId) }, userId },
      select: { id: true, status: true },
    }) : [],
    wallTargets.length ? prisma.profileWallMessage.findMany({
      where: { id: { in: wallTargets.map((target) => target.parentId) }, deletedAt: null },
      select: { id: true, User_ProfileWallMessage_receiverIdToUser: { select: { uid: true } } },
    }) : [],
  ])
  const dailyComments = dailyCommentLookup.rows

  const items = merged.map((item) => {
    const target = item.replyTarget
    if (!target) return item
    if (target.kind === 'post' && !postReplies.some((reply) => reply.id === target.parentId && reply.postId === target.resourceId)) {
      return { ...item, replyDisabledReason: '该内容已被删除或无法查看' }
    }
    if (target.kind === 'daily-message') {
      if (dailyCommentLookup.failed) return { ...item, replyDisabledReason: '暂时无法加载回复，请稍后重试' }
      const comment = dailyComments.find((row) => row.id === target.parentId && row.messageId === target.resourceId)
      if (!comment) return { ...item, replyDisabledReason: '你暂时无法查看这条回复' }
      if (comment.isDeleted || comment.DailyMessage.isDeleted) return { ...item, replyDisabledReason: '该回复已被删除' }
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

  return { items, total, page, pageSize, totalPages, unreadCount: personalUnread + systemUnread }
}

export async function listUnifiedNotifications(userId: string, options: { unreadOnly?: boolean; limit?: number } = {}) {
  const page = await listUnifiedNotificationsPage(userId, {
    unreadOnly: options.unreadOnly,
    page: 1,
    pageSize: options.limit || MAX_NOTIFICATION_PAGE_SIZE,
  })
  return page.items
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
    where: getUnreadNotificationWhere(userId, { id }),
    data: { isRead: true, readAt },
  })

  if (result.count > 0) return { ok: true, readAt }

  // Marking an already-read row is idempotent. This also handles two tabs
  // racing to read the same notification without turning a successful read
  // into a misleading 404 response.
  const existing = await prisma.notification.findFirst({
    where: getNotificationVisibilityFilter(userId, { id }),
    select: { isRead: true, readAt: true },
  })
  return existing?.isRead ? { ok: true, readAt: existing.readAt } : { ok: false, readAt: null }
}

/** Backwards-compatible boolean helper used by batch/read-all callers. */
export async function markUnifiedNotificationRead(userId: string, source: string, id: string) {
  return (await markUnifiedNotificationReadWithState(userId, source, id)).ok
}

/** Mark only notifications whose link points at the resource just opened. */
export async function markPersonalNotificationsForTargetRead(input: {
  userId: string
  linkPrefix: string
  types?: NotificationType[]
}) {
  const readAt = new Date()
  const result = await prisma.notification.updateMany({
    where: getUnreadNotificationWhere(input.userId, {
      link: { startsWith: input.linkPrefix },
      ...(input.types?.length ? { type: { in: input.types } } : {}),
    }),
    data: { isRead: true, readAt },
  })
  return result.count
}

export async function markAllUnifiedNotificationsRead(userId: string) {
  await reconcileLikeNotifications(userId)
  await reconcileStalePersonalNotifications(userId)
  const now = new Date()
  const unreadSystem = await prisma.systemNotification.findMany({
    where: { ...effectiveSystemNotificationWhere(now), type: { not: 'UPDATE' }, SystemNotificationRead: { none: { userId } } },
    select: { id: true },
  })

  await prisma.$transaction([
    prisma.notification.updateMany({
      where: getUnreadNotificationWhere(userId),
      data: { isRead: true, readAt: now },
    }),
    prisma.feedback.updateMany({
      where: { userId, userUnread: true },
      data: { userUnread: false },
    }),
    prisma.conversationParticipant.updateMany({
      where: { userId, isDeleted: false },
      data: { lastReadAt: now },
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

/**
 * 将当前用户所有"已完成审核结果"的通知标记为已读。
 *
 * 本项目里审核结果通知统一用 `type: 'ADMIN'` 存储，并通过 `link` 区分资源：
 *   - 帖子审核结果：link 以 `/posts/` 开头（无 key）
 *   - 表情包审核结果：link 为 `/profile/stickers...`（key = `sticker-pack-review:*`）
 *
 * 因此本函数把更新范围严格限定为 `type: 'ADMIN'` 且 `link` 满足上述前缀，
 * 不会触碰以下通知：点赞(LIKE)、评论回复(REPLY)、私信(MESSAGE)、好友(FRIEND_REQUEST/FOLLOW)、
 * 系统(SYSTEM)、公告(ANNOUNCEMENT)、反馈提醒(/admin/feedback、/feedback/*)等。
 *
 * 幂等：仅更新 `isRead: false` 的行，重复调用安全，不会重置已读时间。
 * 不修改数据库结构。
 */
export async function markModerationNotificationsRead(userId: string) {
  const readAt = new Date()
  const pendingReviewNotifications = await prisma.notification.findMany({
    where: {
      recipientId: userId,
      isRead: false,
      type: 'ADMIN',
      link: '/admin/posts/review',
      key: { startsWith: 'post-review:' },
    },
    select: { key: true },
  })
  const reviewPostIds = Array.from(new Set(pendingReviewNotifications.flatMap(({ key }) => {
    const postId = key?.startsWith('post-review:') ? key.slice('post-review:'.length).split(':', 1)[0] : ''
    return postId ? [postId] : []
  })))

  const resultNotifications = await prisma.notification.updateMany({
    where: {
      recipientId: userId,
      isRead: false,
      type: 'ADMIN',
      OR: [
        { link: { startsWith: '/posts/' } },
        { link: { startsWith: '/profile/stickers' } },
      ],
    },
    data: { isRead: true, readAt },
  })
  let count = resultNotifications.count

  if (reviewPostIds.length) {
    const completedPosts = await prisma.post.findMany({
      where: { id: { in: reviewPostIds }, moderationStatus: { not: 'PENDING' } },
      select: { id: true },
    })
    const completedPostIds = completedPosts.map(({ id }) => id)
    if (completedPostIds.length) {
      const completedResult = await prisma.notification.updateMany({
        where: {
          recipientId: userId,
          isRead: false,
          type: 'ADMIN',
          link: '/admin/posts/review',
          OR: completedPostIds.map((id) => ({ key: { startsWith: `post-review:${id}` } })),
        },
        data: { isRead: true, readAt },
      })
      count += completedResult.count
    }
  }

  return { ok: true, count, readAt }
}
