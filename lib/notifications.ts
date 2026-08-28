import { prisma } from '@/lib/prisma'
import { getFriendDisplayName, getPublicUserDisplayName, loadFriendRemarkMap } from '@/lib/friend-remarks'
import { publicImageUrl } from '@/lib/images'
import { publicModerationText } from '@/lib/content-moderation'
import { splitContentImages } from '@/lib/content-images'
import { effectiveSystemNotificationOrder, effectiveSystemNotificationWhere } from '@/lib/system-notifications'
import { Prisma, type NotificationType, type SystemNotificationType } from '@prisma/client'
import { parseNotificationReplyTarget, type NotificationReplyTarget } from '@/lib/notification-target'
import { compareNotificationOrder } from '@/lib/notification-order'
import { clampPaginationPage } from '@/lib/pagination'
import { formatLikeNotificationText, loadLikeNotificationStats, parseLikeNotificationTarget, reconcileLikeNotifications, type LikeNotificationTargetKind } from '@/lib/like-notifications'
import { normalizeActionUrl, normalizeStoredInternalPath } from '@/lib/url-safety'
import { logNotificationError } from '@/lib/notification-errors'
import { getEquippedBadgesForUsers } from '@/lib/badge-service'
import type { EquippedBadgeView } from '@/lib/badge-types'
import type { FriendDockUser } from '@/lib/friend-types'
import { calculateGrowthSummary, defaultGrowthLevels, listGrowthLevels } from '@/lib/growth'
export { getNotificationTarget } from '@/lib/notification-target'

const MAX_NOTIFICATION_PAGE_SIZE = 50
const CONTENT_IMAGE_MARKER = /\[\[content-image:[^\]]+\]\]/g
const REPLY_UNAVAILABLE_TEXT = '该回复已被删除或不可查看'
const REPLY_NOT_FOUND_TEXT = '该回复不存在或已失效'
const REPLY_DELETED_TEXT = '该回复已被删除'
const REPLY_NO_PERMISSION_TEXT = '你暂时无法查看这条回复'
export const notificationCategoryValues = ['all', 'reply', 'like', 'application', 'feedback', 'system', 'review'] as const
export type NotificationCategory = typeof notificationCategoryValues[number]
const POPUP_SYSTEM_TYPES: SystemNotificationType[] = ['SYSTEM', 'ANNOUNCEMENT', 'MAINTENANCE', 'SECURITY']
const NOTIFICATION_RECONCILIATION_TTL_MS = 60_000
const MAX_NOTIFICATION_RECONCILIATION_USERS = 10_000
const MAX_STALE_NOTIFICATION_RECONCILIATION_ROWS = 200
const DUEL_INVITE_LINK_PREFIX = '/games/guess-song/duel'
const FRIEND_BIRTHDAY_LINK_PREFIX = '/user/'
const notificationReconciliationInFlight = new Map<string, Promise<void>>()
const notificationReconciliationLastRun = new Map<string, number>()

/**
 * Before FEEDBACK/REVIEW became first-class Notification types, the affected
 * write paths used ADMIN plus a stable link/key. Keep those records readable
 * without broad title/content matching, which would misclassify unrelated
 * administrator messages.
 */
function isLegacyReviewNotification(type: string, link?: string | null, key?: string | null) {
  if (type !== 'ADMIN' || !key) return false
  if (link === '/admin/posts/review') return key.startsWith('post-review:')
  if (link === '/admin/stickers') return key.startsWith('sticker-pack-review:') || key.startsWith('sticker-pack-resubmit:')
  if (link === '/admin/today') return key.startsWith('today-review:')
  return false
}

function isLegacyFeedbackNotification(type: string, key?: string | null) {
  return type === 'ADMIN' && Boolean(key?.startsWith('feedback-new:'))
}

function legacyReviewNotificationWhere(): Prisma.NotificationWhereInput {
  return {
    OR: [
      { type: 'ADMIN', link: '/admin/posts/review', key: { startsWith: 'post-review:' } },
      { type: 'ADMIN', link: '/admin/stickers', key: { startsWith: 'sticker-pack-review:' } },
      { type: 'ADMIN', link: '/admin/stickers', key: { startsWith: 'sticker-pack-resubmit:' } },
      { type: 'ADMIN', link: '/admin/today', key: { startsWith: 'today-review:' } },
    ],
  }
}

function reviewNotificationWhere(): Prisma.NotificationWhereInput {
  return { OR: [{ type: 'REVIEW' }, legacyReviewNotificationWhere()] }
}

function feedbackNotificationWhere(): Prisma.NotificationWhereInput {
  return {
    OR: [
      { type: 'FEEDBACK' },
      { link: { startsWith: '/feedback/' } },
      { type: 'ADMIN', key: { startsWith: 'feedback-new:' } },
    ],
  }
}

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

export function getNotificationCategory(type: string, link?: string | null, key?: string | null): NotificationCategory {
  if (type === 'FEEDBACK' || link?.startsWith('/feedback/') || isLegacyFeedbackNotification(type, key)) return 'feedback'
  if (type === 'REVIEW' || isLegacyReviewNotification(type, link, key)) return 'review'
  if (type === 'REPLY') return 'reply'
  if (type === 'LIKE') return 'like'
  if (type === 'FRIEND_REQUEST' || type === 'FOLLOW') return 'application'
  if (type === 'ACTIVITY' && (link?.startsWith(DUEL_INVITE_LINK_PREFIX) || link?.startsWith(FRIEND_BIRTHDAY_LINK_PREFIX))) return 'application'
  if (type === 'BIRTHDAY_GREETING' && link?.startsWith(FRIEND_BIRTHDAY_LINK_PREFIX)) return 'application'
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
  // readAt is the canonical read state. isRead remains a synchronized legacy
  // field for older writers and database compatibility, but it must not drive
  // list/summary results.
  return getNotificationVisibilityFilter(userId, { readAt: null, ...extra })
}

export function getNotificationCategoryFilter(category: string, canReview = false): Prisma.NotificationWhereInput {
  const normalizedCategory = parseNotificationCategory(category)
  if (normalizedCategory === 'all') {
    return canReview
      ? { type: { not: 'MESSAGE' } }
      : { AND: [{ type: { notIn: ['MESSAGE', 'REVIEW'] } }, { NOT: legacyReviewNotificationWhere() }] }
  }
  // 反馈回复历史上可能使用 REPLY + /feedback/，新通知使用 FEEDBACK。
  // 留言墙互动仍按真实行为归入回复 / 点赞，不再保留独立一级分类。
  if (normalizedCategory === 'reply') return { type: 'REPLY', OR: [{ link: null }, { link: { not: { startsWith: '/feedback/' } } }] }
  if (normalizedCategory === 'like') return { type: 'LIKE', OR: [{ link: null }, { link: { not: { startsWith: '/feedback/' } } }] }
  if (normalizedCategory === 'application') return {
    OR: [
      { type: { in: ['FRIEND_REQUEST', 'FOLLOW'] } },
      { type: 'ACTIVITY', link: { startsWith: DUEL_INVITE_LINK_PREFIX } },
      { type: 'ACTIVITY', link: { startsWith: FRIEND_BIRTHDAY_LINK_PREFIX } },
      { type: 'BIRTHDAY_GREETING', link: { startsWith: FRIEND_BIRTHDAY_LINK_PREFIX } },
    ],
  }
  if (normalizedCategory === 'feedback') return feedbackNotificationWhere()
  if (normalizedCategory === 'review') return canReview ? reviewNotificationWhere() : { id: { in: [] } }
  return {
    type: { notIn: ['REPLY', 'LIKE', 'FRIEND_REQUEST', 'FOLLOW', 'MESSAGE', 'FEEDBACK', 'REVIEW'] },
    AND: [
      { NOT: { type: 'ACTIVITY', link: { startsWith: DUEL_INVITE_LINK_PREFIX } } },
      { NOT: { type: 'ACTIVITY', link: { startsWith: FRIEND_BIRTHDAY_LINK_PREFIX } } },
      { NOT: { type: 'BIRTHDAY_GREETING', link: { startsWith: FRIEND_BIRTHDAY_LINK_PREFIX } } },
      { NOT: legacyReviewNotificationWhere() },
      { NOT: feedbackNotificationWhere() },
    ],
    OR: [{ link: null }, { link: { not: { startsWith: '/feedback/' } } }],
  }
}

export function parseNotificationCategory(value: unknown): NotificationCategory {
  if (notificationCategoryValues.includes(value as NotificationCategory)) return value as NotificationCategory
  // Keep old bookmarked URLs harmless: the removed tabs resolve to the main
  // feed instead of querying private-message or wall-only rows.
  if (value === 'friend') return 'application'
  return 'all'
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
function getPersonalNotificationCategorySql(category: NotificationCategory, canReview = false) {
  switch (category) {
    case 'reply': return Prisma.raw("AND n.type = 'REPLY' AND (n.link IS NULL OR n.link NOT LIKE '/feedback/%')")
    case 'like': return Prisma.raw("AND n.type = 'LIKE' AND (n.link IS NULL OR n.link NOT LIKE '/feedback/%')")
    case 'application': return Prisma.raw("AND (n.type IN ('FRIEND_REQUEST', 'FOLLOW') OR (n.type = 'ACTIVITY' AND (n.link LIKE '/games/guess-song/duel%' OR n.link LIKE '/user/%')) OR (n.type = 'BIRTHDAY_GREETING' AND n.link LIKE '/user/%'))")
    case 'feedback': return Prisma.raw("AND (n.type = 'FEEDBACK' OR n.link LIKE '/feedback/%' OR (n.type = 'ADMIN' AND COALESCE(n.`key`, '') LIKE 'feedback-new:%'))")
    case 'review': return canReview
      ? Prisma.raw("AND (n.type = 'REVIEW' OR (n.type = 'ADMIN' AND ((COALESCE(n.link, '') = '/admin/posts/review' AND COALESCE(n.`key`, '') LIKE 'post-review:%') OR (COALESCE(n.link, '') = '/admin/stickers' AND (COALESCE(n.`key`, '') LIKE 'sticker-pack-review:%' OR COALESCE(n.`key`, '') LIKE 'sticker-pack-resubmit:%')) OR (COALESCE(n.link, '') = '/admin/today' AND COALESCE(n.`key`, '') LIKE 'today-review:%'))))")
      : Prisma.raw('AND 1 = 0')
    case 'system': return Prisma.raw("AND n.type NOT IN ('REPLY', 'LIKE', 'FRIEND_REQUEST', 'FOLLOW', 'MESSAGE', 'FEEDBACK', 'REVIEW') AND NOT (n.type = 'ACTIVITY' AND (n.link LIKE '/games/guess-song/duel%' OR n.link LIKE '/user/%')) AND NOT (n.type = 'BIRTHDAY_GREETING' AND n.link LIKE '/user/%') AND NOT (n.type = 'ADMIN' AND ((COALESCE(n.link, '') = '/admin/posts/review' AND COALESCE(n.`key`, '') LIKE 'post-review:%') OR (COALESCE(n.link, '') = '/admin/stickers' AND (COALESCE(n.`key`, '') LIKE 'sticker-pack-review:%' OR COALESCE(n.`key`, '') LIKE 'sticker-pack-resubmit:%')) OR (COALESCE(n.link, '') = '/admin/today' AND COALESCE(n.`key`, '') LIKE 'today-review:%') OR COALESCE(n.`key`, '') LIKE 'feedback-new:%')) AND (n.link IS NULL OR n.link NOT LIKE '/feedback/%')")
    case 'all': return canReview
      ? Prisma.raw("AND n.type <> 'MESSAGE'")
      : Prisma.raw("AND n.type NOT IN ('MESSAGE', 'REVIEW') AND NOT (n.type = 'ADMIN' AND ((COALESCE(n.link, '') = '/admin/posts/review' AND COALESCE(n.`key`, '') LIKE 'post-review:%') OR (COALESCE(n.link, '') = '/admin/stickers' AND (COALESCE(n.`key`, '') LIKE 'sticker-pack-review:%' OR COALESCE(n.`key`, '') LIKE 'sticker-pack-resubmit:%')) OR (COALESCE(n.link, '') = '/admin/today' AND COALESCE(n.`key`, '') LIKE 'today-review:%')))")
    default: return Prisma.empty
  }
}

function getSystemNotificationCategorySql(category: NotificationCategory) {
  if (category === 'feedback') return Prisma.raw("AND sn.link LIKE '/feedback/%'")
  if (category === 'system') return Prisma.raw("AND (sn.link IS NULL OR sn.link NOT LIKE '/feedback/%')")
  if (category === 'review') return Prisma.raw('AND 1 = 0')
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

function getNotificationTypeLabel(type: string, link?: string | null, source?: 'personal' | 'system', key?: string | null) {
  if (type === 'FEEDBACK' || link?.startsWith('/feedback/') || isLegacyFeedbackNotification(type, key)) return '反馈'
  if (type === 'REVIEW' || isLegacyReviewNotification(type, link, key)) return '审核'
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
  if (!value) return value
  for (const suffix of dynamicActorSuffixes) {
    const index = value.indexOf(suffix)
    if (index <= 0) continue
    const hasSpace = /\s/.test(value[index - 1] || '')
    // Rebuild the actor prefix even when the related user was deleted or an
    // old notification has no actorId. This prevents a historical username
    // snapshot from being rendered as a public name.
    const displayActorName = actorName || '有人'
    return `${displayActorName}${hasSpace ? ' ' : ''}${value.slice(index)}`
  }
  return value
}

/**
 * Notification rows keep the target ID in their existing internal link. The
 * reply itself remains the source of truth for the preview, so edits/deletes
 * are reflected without copying a second long body into Notification.
 */
export function formatNotificationReplyPreview(input: {
  content?: string | null
  moderationStatus?: string | null
  stickerId?: string | null
  hasImages?: boolean
}) {
  const rawContent = input.content || ''
  const { text, images } = splitContentImages(rawContent)
  const imageCount = Math.max(images.length, (rawContent.match(CONTENT_IMAGE_MARKER) || []).length, input.hasImages ? 1 : 0)
  const parts = []
  const visibleText = publicModerationText(text, input.moderationStatus).trim()
  if (visibleText) parts.push(visibleText)
  if (imageCount > 0) parts.push('[图片]')
  if (input.stickerId) parts.push('[表情]')
  return parts.join(' ') || null
}

export type UnifiedNotification = {
  id: string
  source: 'personal' | 'system'
  type: string
  typeLabel: string
  category: string
  title: string
  content: string | null
  key?: string | null
  link: string | null
  targetUrl: string | null
  actorName: string | null
  actorUid: number | null
  actorAvatarUrl: string | null
  actorBadge: EquippedBadgeView | null
  /** 当前登录用户可见的公开资料卡数据；系统通知和无 actor 通知为 null。 */
  actorProfile: FriendDockUser | null
  /** actor 已被注销/停用时保留占位卡片，但不暴露内部状态。 */
  actorUnavailable: boolean
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
  replyPreview: string | null
}

export type UnreadSummary = {
  notifications: number
  system: number
  replies: number
  likes: number
  wall: number
  feedbackReplies: number
  feedback: number
  friendRequests: number
  directMessages: number
  messages: number
  review: number
  total: number
}

// Multiple browser tabs and realtime/focus events can reach the same process
// together. Share the read-only aggregate while it is in flight; this does
// not change the source of truth and does not start reconciliation.
const unreadSummaryInFlight = new Map<string, Promise<UnreadSummary>>()

export type UnreadPersonalCounts = {
  replies: number
  likes: number
  wall?: number
  friendRequests: number
  messages: number
  feedback: number
  system: number
  review?: number
}

type DailyCommentNotificationRow = {
  id: string
  messageId: string
  content: string
  moderationStatus: string
  isDeleted: boolean
  DailyMessage: {
    isDeleted: boolean
    moderationStatus: string
    userId: string
    User: { status: string; isDeleted: boolean; Profile: { id: string } | null }
  }
}

function canViewDailyNotificationMessage(row: DailyCommentNotificationRow, viewerId: string) {
  const userIsActive = row.DailyMessage.User.status === 'ACTIVE' && !row.DailyMessage.User.isDeleted
  if (!userIsActive || row.DailyMessage.isDeleted) return false
  const isPublic = ['APPROVED', 'VIOLATION'].includes(row.DailyMessage.moderationStatus)
    && Boolean(row.DailyMessage.User.Profile)
  return isPublic || row.DailyMessage.userId === viewerId
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
        content: true,
        moderationStatus: true,
        isDeleted: true,
        DailyMessage: {
          select: {
            isDeleted: true,
            moderationStatus: true,
            userId: true,
            User: { select: { status: true, isDeleted: true, Profile: { select: { id: true } } } },
          },
        },
      },
    })
    return { rows, failed: false }
  } catch (error) {
    logNotificationError('daily-comment-lookup', { label }, error)
    return { rows: [] as DailyCommentNotificationRow[], failed: true }
  }
}

async function reconcileStalePersonalNotifications(userId: string) {
  const unread = await prisma.notification.findMany({
    where: getUnreadNotificationWhere(userId),
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    take: MAX_STALE_NOTIFICATION_RECONCILIATION_ROWS,
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
    if (target.kind === 'daily-message' && !dailyCommentLookup.failed && !dailyComments.some((comment) => comment.id === target.parentId && !comment.isDeleted && !comment.DailyMessage.isDeleted && ['APPROVED', 'VIOLATION'].includes(comment.DailyMessage.moderationStatus))) staleIds.add(item.id)
    if (target.kind === 'feedback' && !feedbacks.some((feedback) => feedback.id === target.resourceId)) staleIds.add(item.id)
    if (target.kind === 'profile-wall' && !wallMessages.some((message) => message.id === target.parentId && String(message.User_ProfileWallMessage_receiverIdToUser.uid) === String(Number(target.resourceId)))) staleIds.add(item.id)
  }

  if (staleIds.size) {
    await prisma.notification.updateMany({
      where: getUnreadNotificationWhere(userId, { id: { in: Array.from(staleIds) } }),
      data: { isRead: true, readAt: new Date() },
    })
  }
}

/**
 * Reconciliation is maintenance work, not part of an unread read path. Keep
 * one in-flight job per user and rate-limit subsequent list/read-all calls so
 * a navbar refresh cannot create a transaction storm.
 */
function scheduleNotificationReconciliation(userId: string, source: 'list' | 'read-all') {
  if (notificationReconciliationInFlight.has(userId)) return

  const now = Date.now()
  if (notificationReconciliationLastRun.size > MAX_NOTIFICATION_RECONCILIATION_USERS) {
    for (const [cachedUserId, lastRunAt] of notificationReconciliationLastRun) {
      if (now - lastRunAt >= NOTIFICATION_RECONCILIATION_TTL_MS) notificationReconciliationLastRun.delete(cachedUserId)
    }
    while (notificationReconciliationLastRun.size > MAX_NOTIFICATION_RECONCILIATION_USERS) {
      const oldestUserId = notificationReconciliationLastRun.keys().next().value as string | undefined
      if (!oldestUserId) break
      notificationReconciliationLastRun.delete(oldestUserId)
    }
  }
  const lastRun = notificationReconciliationLastRun.get(userId) || 0
  if (now - lastRun < NOTIFICATION_RECONCILIATION_TTL_MS) return

  notificationReconciliationLastRun.set(userId, now)
  const task = (async () => {
    const [likeResult, staleResult] = await Promise.allSettled([
      reconcileLikeNotifications(userId),
      reconcileStalePersonalNotifications(userId),
    ])
    if (likeResult.status === 'rejected') {
      logNotificationError(`${source}.like-reconciliation`, { userId }, likeResult.reason)
    }
    if (staleResult.status === 'rejected') {
      logNotificationError(`${source}.stale-reconciliation`, { userId }, staleResult.reason)
    }
  })().finally(() => {
    notificationReconciliationInFlight.delete(userId)
  })
  notificationReconciliationInFlight.set(userId, task)
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
    // is being migrated. Direct messages are secondary to the notification
    // list, so a compatibility query failure must not take the whole page down.
    logNotificationError('unread-summary.direct-messages-compat', { userId }, error)
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
          AND (cp.lastReadAt IS NULL OR dm.createdAt > cp.lastReadAt)
      `
      return Number(rows[0]?.unreadCount || 0)
    } catch (fallbackError) {
      logNotificationError('unread-summary.direct-messages-fallback', { userId }, fallbackError)
      return 0
    }
  }
}

export function buildUnreadSummary(personal: UnreadPersonalCounts, systemCount: number, directMessages: number, systemFeedback = 0): UnreadSummary {
  const system = personal.system + systemCount
  const review = personal.review ?? 0
  // `wall` is kept as an input-only compatibility field for older callers.
  // Current SQL folds wall replies/likes into their real interaction category;
  // if an older caller still supplies a separate count, retain it in the
  // aggregate without exposing a removed wall tab.
  const legacyWall = personal.wall ?? 0
  const feedback = personal.feedback + systemFeedback
  const notifications = system + personal.replies + personal.likes + personal.friendRequests + feedback + review + legacyWall
  const friendRequests = personal.friendRequests
  const feedbackReplies = feedback
  return {
    notifications,
    system,
    replies: personal.replies,
    likes: personal.likes,
    wall: 0,
    feedbackReplies,
    feedback: feedbackReplies,
    friendRequests,
    directMessages,
    messages: directMessages,
    review,
    // Direct-message unread state has its own conversation cursor and must not
    // be duplicated in the notification-center total.
    total: notifications,
  }
}

async function loadUnreadSummary(userId: string, canReview = false): Promise<UnreadSummary> {
  // This endpoint is polled by the navigation/realtime fallback. It must stay
  // read-only and cheap; reconciliation belongs to the paginated list path.
  const now = new Date()
  // Keep the complete CASE expression in one stable SQL fragment. Interpolating
  // only the WHEN condition made the generated MySQL statement sensitive to
  // nested Prisma.sql fragments and caused the production 1064 near THEN.
  const reviewCountSql = canReview
    ? Prisma.sql`
        COUNT(
          CASE
            WHEN (
              n.type = 'REVIEW'
              OR (
                n.type = 'ADMIN'
                AND (
                  (
                    COALESCE(n.link, '') = '/admin/posts/review'
                    AND COALESCE(n.\`key\`, '') LIKE 'post-review:%'
                  )
                  OR (
                    COALESCE(n.link, '') = '/admin/stickers'
                    AND (
                      COALESCE(n.\`key\`, '') LIKE 'sticker-pack-review:%'
                      OR COALESCE(n.\`key\`, '') LIKE 'sticker-pack-resubmit:%'
                    )
                  )
                  OR (
                    COALESCE(n.link, '') = '/admin/today'
                    AND COALESCE(n.\`key\`, '') LIKE 'today-review:%'
                  )
                )
              )
            )
            THEN 1
          END
        )
      `
    : Prisma.sql`0`
  const [personalResult, systemResult, systemFeedbackResult, directMessageResult] = await Promise.allSettled([
    prisma.$queryRaw<Array<{
      replies: bigint | number
      likes: bigint | number
      wall: bigint | number
      friendRequests: bigint | number
      messages: bigint | number
      feedback: bigint | number
      systemCount: bigint | number
      review: bigint | number
    }>>`
      SELECT
        COUNT(CASE WHEN n.type = 'REPLY' AND (n.link IS NULL OR n.link NOT LIKE '/feedback/%') THEN 1 END) AS replies,
        COUNT(CASE WHEN n.type = 'LIKE' AND (n.link IS NULL OR n.link NOT LIKE '/feedback/%') THEN 1 END) AS likes,
        0 AS wall,
        COUNT(CASE WHEN (n.type IN ('FRIEND_REQUEST', 'FOLLOW') OR (n.type = 'ACTIVITY' AND (n.link LIKE '/games/guess-song/duel%' OR n.link LIKE '/user/%')) OR (n.type = 'BIRTHDAY_GREETING' AND n.link LIKE '/user/%')) AND (n.link IS NULL OR n.link NOT LIKE '/feedback/%') THEN 1 END) AS friendRequests,
        0 AS messages,
        COUNT(CASE WHEN (n.type = 'FEEDBACK' OR n.link LIKE '/feedback/%' OR (n.type = 'ADMIN' AND COALESCE(n.\`key\`, '') LIKE 'feedback-new:%')) THEN 1 END) AS feedback,
        COUNT(CASE WHEN n.type NOT IN ('REPLY', 'LIKE', 'FRIEND_REQUEST', 'FOLLOW', 'MESSAGE', 'FEEDBACK', 'REVIEW') AND NOT (n.type = 'ACTIVITY' AND (n.link LIKE '/games/guess-song/duel%' OR n.link LIKE '/user/%')) AND NOT (n.type = 'BIRTHDAY_GREETING' AND n.link LIKE '/user/%') AND NOT (n.type = 'ADMIN' AND ((COALESCE(n.link, '') = '/admin/posts/review' AND COALESCE(n.\`key\`, '') LIKE 'post-review:%') OR (COALESCE(n.link, '') = '/admin/stickers' AND (COALESCE(n.\`key\`, '') LIKE 'sticker-pack-review:%' OR COALESCE(n.\`key\`, '') LIKE 'sticker-pack-resubmit:%')) OR (COALESCE(n.link, '') = '/admin/today' AND COALESCE(n.\`key\`, '') LIKE 'today-review:%') OR COALESCE(n.\`key\`, '') LIKE 'feedback-new:%')) AND (n.link IS NULL OR n.link NOT LIKE '/feedback/%') THEN 1 END) AS systemCount,
        ${reviewCountSql} AS review
      FROM Notification n
      WHERE n.recipientId = ${userId}
        AND n.readAt IS NULL
    `,
    prisma.systemNotification.count({ where: {
      ...effectiveSystemNotificationWhere(now),
      type: { not: 'UPDATE' },
      OR: [{ link: null }, { link: { not: { startsWith: '/feedback/' } } }],
      SystemNotificationRead: { none: { userId } },
    } }),
    prisma.systemNotification.count({ where: {
      ...effectiveSystemNotificationWhere(now),
      type: { not: 'UPDATE' },
      link: { startsWith: '/feedback/' },
      SystemNotificationRead: { none: { userId } },
    } }),
    getDirectMessageUnreadCount(userId),
  ])

  if (personalResult.status === 'rejected') {
    logNotificationError('unread-summary.personal-query', { userId }, personalResult.reason)
    throw personalResult.reason
  }
  if (systemResult.status === 'rejected') {
    logNotificationError('unread-summary.system-query', { userId }, systemResult.reason)
    throw systemResult.reason
  }
  if (systemFeedbackResult.status === 'rejected') {
    logNotificationError('unread-summary.system-feedback-query', { userId }, systemFeedbackResult.reason)
    throw systemFeedbackResult.reason
  }

  const personalRows = personalResult.value
  const systemCount = systemResult.value
  const systemFeedback = systemFeedbackResult.value
  const directMessages = directMessageResult.status === 'fulfilled'
    ? directMessageResult.value
    : (() => {
        logNotificationError('unread-summary.direct-message-query', { userId }, directMessageResult.reason)
        return 0
      })()

  const personalRow = personalRows[0]
  const personalCounts = {
    replies: Number(personalRow?.replies || 0),
    likes: Number(personalRow?.likes || 0),
    wall: Number(personalRow?.wall || 0),
    friendRequests: Number(personalRow?.friendRequests || 0),
    messages: Number(personalRow?.messages || 0),
    feedback: Number(personalRow?.feedback || 0),
    system: Number(personalRow?.systemCount || 0),
    review: Number(personalRow?.review || 0),
  }

  // Direct messages have their own conversation read cursor and are rendered
  // by the notification center as a dedicated entry, not as Notification rows.
  const summary = buildUnreadSummary(personalCounts, systemCount, directMessages, systemFeedback)
  return summary
}

export async function getUnreadSummary(userId: string, canReview = false): Promise<UnreadSummary> {
  const inFlightKey = `${userId}:${canReview ? 'review' : 'standard'}`
  const inFlight = unreadSummaryInFlight.get(inFlightKey)
  if (inFlight) return inFlight

  const request = loadUnreadSummary(userId, canReview)
  unreadSummaryInFlight.set(inFlightKey, request)
  try {
    return await request
  } finally {
    if (unreadSummaryInFlight.get(inFlightKey) === request) unreadSummaryInFlight.delete(inFlightKey)
  }
}

export async function getUnreadNotificationCount(userId: string, canReview = false) {
  return (await getUnreadSummary(userId, canReview)).total
}

export type UnifiedNotificationPage = {
  items: UnifiedNotification[]
  total: number
  page: number
  pageSize: number
  totalPages: number
  unreadCount: number
  degraded?: boolean
  failed?: boolean
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
  canReview?: boolean
} = {}): Promise<UnifiedNotificationPage> {
  // Reconciliation cleans up historical notification ghosts, but it is not
  // required to render the current page. It is scheduled only after the core
  // page query succeeds, so a failed list/count path remains strictly read-only.
  const now = new Date()
  const category = parseNotificationCategory(options.category)
  const canReview = options.canReview === true
  const pageSize = Math.min(Math.max(Math.trunc(options.pageSize || 20) || 20, 1), MAX_NOTIFICATION_PAGE_SIZE)
  const personalCategory = getNotificationCategoryFilter(category, canReview)
  const systemCategory = getSystemNotificationCategoryFilter(category)
  const personalWhere = getNotificationVisibilityFilter(userId, {
    ...personalCategory,
    ...(options.unreadOnly ? { readAt: null } : {}),
  })
  const systemWhere = {
    ...effectiveSystemNotificationWhere(now),
    type: { not: 'UPDATE' as const },
    ...systemCategory,
    ...(options.unreadOnly ? { SystemNotificationRead: { none: { userId } } } : {}),
  }
  const [personalTotalResult, systemTotalResult, personalUnreadResult, systemUnreadResult] = await Promise.allSettled([
    prisma.notification.count({ where: personalWhere }),
    prisma.systemNotification.count({ where: systemWhere }),
    prisma.notification.count({ where: getNotificationVisibilityFilter(userId, { ...personalCategory, readAt: null }) }),
    prisma.systemNotification.count({ where: { ...systemWhere, SystemNotificationRead: { none: { userId } } } }),
  ])
  let degraded = false
  const getRequiredCount = (result: PromiseSettledResult<number>, phase: string) => {
    if (result.status === 'fulfilled') return result.value
    logNotificationError(phase, { userId, category }, result.reason)
    // Counts are part of the core notification page contract. Returning zero
    // here would fabricate unread state and make pagination disagree with the
    // list query, so let the API return its explicit 503 unavailable response.
    throw result.reason
  }
  const personalTotal = getRequiredCount(personalTotalResult, 'list.personal-count')
  const systemTotal = getRequiredCount(systemTotalResult, 'list.system-count')
  const personalUnread = getRequiredCount(personalUnreadResult, 'list.personal-unread-count')
  const systemUnread = getRequiredCount(systemUnreadResult, 'list.system-unread-count')
  const total = personalTotal + systemTotal
  const totalPages = Math.max(1, Math.ceil(total / pageSize))
  const page = clampPaginationPage(options.page || 1, totalPages)
  const offset = (page - 1) * pageSize
  const personalCategorySql = getPersonalNotificationCategorySql(category, canReview)
  const systemCategorySql = getSystemNotificationCategorySql(category)
  const unreadPersonalSql = options.unreadOnly ? Prisma.sql`AND n.readAt IS NULL` : Prisma.empty
  const unreadSystemSql = options.unreadOnly ? Prisma.sql`AND snr.id IS NULL` : Prisma.empty
  let rows: NotificationPageRow[]
  try {
    rows = await prisma.$queryRaw<NotificationPageRow[]>(Prisma.sql`
      SELECT n.id AS id, 'personal' AS source,
        CASE WHEN n.readAt IS NULL THEN 0 ELSE 1 END AS isRead,
        n.createdAt AS createdAt
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
  } catch (error) {
    logNotificationError('list.union-query', { userId, page, pageSize, category }, error)
    // Do not silently drop SystemNotification rows or invent a new total/page
    // from a personal-only fallback. The two-table union is the page source of
    // truth; an unavailable core query must be surfaced as a failed page.
    return {
      items: [],
      total,
      page,
      pageSize,
      totalPages,
      unreadCount: personalUnread + systemUnread,
      failed: true,
    }
  }

  const personalIds = rows.filter((row) => row.source === 'personal').map((row) => row.id)
  const systemIds = rows.filter((row) => row.source === 'system').map((row) => row.id)
  const [personalResult, systemResult] = await Promise.allSettled([
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
            nicknameViolationDisplay: true,
            avatarUrl: true,
            bio: true,
            bioModerationStatus: true,
            experience: true,
            isOnline: true,
            lastActiveAt: true,
            createdAt: true,
            status: true,
            isDeleted: true,
            Profile: { select: { displayName: true, displayNameModerationStatus: true, avatarUrl: true, bio: true, bioModerationStatus: true } },
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
  const personal = personalResult.status === 'fulfilled'
    ? personalResult.value
    : (() => {
        degraded = true
        logNotificationError('list.personal-hydration', { userId, page, pageSize, category }, personalResult.reason)
        return []
      })()
  const system = systemResult.status === 'fulfilled'
    ? systemResult.value
    : (() => {
        degraded = true
        logNotificationError('list.system-hydration', { userId, page, pageSize, category }, systemResult.reason)
        return []
      })()

  const actorIds = personal.flatMap((item) => item.User_Notification_actorIdToUser ? [item.User_Notification_actorIdToUser.id] : [])
  const likeTargets = personal.flatMap((item) => {
    if (item.type !== 'LIKE') return []
    const target = parseLikeNotificationTarget({ type: item.type, key: item.key, link: item.link })
    return target ? [target] : []
  })
  const [remarkResult, likeCountResult, actorBadgeResult, friendshipResult, actorRequestResult, growthLevelResult] = await Promise.allSettled([
    loadFriendRemarkMap(userId, actorIds),
    loadLikeNotificationStats(likeTargets),
    getEquippedBadgesForUsers(actorIds),
    actorIds.length
      ? prisma.friendship.findMany({
          where: {
            OR: [
              { userAId: userId, userBId: { in: actorIds } },
              { userBId: userId, userAId: { in: actorIds } },
            ],
          },
          select: { userAId: true, userBId: true },
        })
      : Promise.resolve([]),
    actorIds.length
      ? prisma.friendRequest.findMany({
          where: {
            status: 'PENDING',
            OR: [
              { senderId: userId, receiverId: { in: actorIds } },
              { receiverId: userId, senderId: { in: actorIds } },
            ],
          },
          select: { id: true, senderId: true, receiverId: true },
        })
      : Promise.resolve([]),
    actorIds.length ? listGrowthLevels() : Promise.resolve([...defaultGrowthLevels]),
  ])
  // 好友备注与点赞统计属于「增强数据」：即使查询失败，通知条目本身仍可正常渲染
  // （好友名回退到展示名、点赞通知回退到存储时生成的标题）。这类失败不应把整页
  // 标记为 degraded，否则前端会误报「部分通知无法加载」。
  const remarkMap = remarkResult.status === 'fulfilled'
    ? remarkResult.value
    : (() => {
        logNotificationError('list.friend-remarks', { userId, page, pageSize, category }, remarkResult.reason)
        return new Map<string, string>()
      })()
  const likeCounts = likeCountResult.status === 'fulfilled'
    ? likeCountResult.value
    : (() => {
        logNotificationError('list.like-stats', { userId, page, pageSize, category }, likeCountResult.reason)
        return new Map<string, number>()
      })()
  const actorBadgeMap = actorBadgeResult.status === 'fulfilled'
    ? actorBadgeResult.value
    : (() => {
        logNotificationError('list.actor-badge', { userId, page, pageSize, category }, actorBadgeResult.reason)
        return new Map<string, EquippedBadgeView>()
      })()
  const actorFriendshipRows = friendshipResult.status === 'fulfilled'
    ? friendshipResult.value
    : (() => {
        logNotificationError('list.actor-friendships', { userId, page, pageSize, category }, friendshipResult.reason)
        return []
      })()
  const actorFriendIds = new Set(actorFriendshipRows.flatMap((row) => [row.userAId, row.userBId]).filter((id) => id !== userId))
  const actorRequestRows = actorRequestResult.status === 'fulfilled'
    ? actorRequestResult.value
    : (() => {
        logNotificationError('list.actor-friend-requests', { userId, page, pageSize, category }, actorRequestResult.reason)
        return []
      })()
  const growthLevels = growthLevelResult.status === 'fulfilled'
    ? growthLevelResult.value
    : (() => {
        logNotificationError('list.actor-growth-levels', { userId, page, pageSize, category }, growthLevelResult.reason)
        return [...defaultGrowthLevels]
      })()
  const personalById = new Map(personal.map((item) => [item.id, item]))
  const systemById = new Map(system.map((item) => [item.id, item]))
  const merged: UnifiedNotification[] = rows.flatMap((row): UnifiedNotification[] => {
    if (row.source === 'personal') {
      const item = personalById.get(row.id)
      if (!item) return []
      const link = normalizeStoredInternalPath(item.link)
      const actor = item.User_Notification_actorIdToUser
      const actorNickname = actor ? getPublicUserDisplayName(actor) : null
      const actorRemark = actor ? (remarkMap.get(actor.id) || null) : null
      const actorDisplayName = actor
        ? getFriendDisplayName({
            nickname: actorNickname,
            friendRemark: actorRemark,
            isFriendContext: actorFriendIds.has(actor.id),
          })
        : null
      const actorName = actorDisplayName
      const actorRequest = actor
        ? actorRequestRows.find((request) => request.senderId === actor.id || request.receiverId === actor.id)
        : null
      const relationshipStatus = actor?.id === userId
        ? 'SELF' as const
        : actor && actorFriendIds.has(actor.id)
          ? 'FRIEND' as const
          : actorRequest?.senderId === userId
            ? 'OUTGOING_PENDING' as const
            : actorRequest
              ? 'INCOMING_PENDING' as const
              : 'NONE' as const
      const actorProfile = actor && actor.status === 'ACTIVE' && !actor.isDeleted
        ? (() => {
            const growth = calculateGrowthSummary(actor.experience, growthLevels)
            const bio = publicModerationText(actor.Profile?.bio || actor.bio, actor.Profile?.bioModerationStatus || actor.bioModerationStatus)
            return {
              id: actor.id,
              uid: actor.uid,
              nickname: actorNickname || 'E院用户',
              friendRemark: actorRemark,
              displayName: actorDisplayName || actorNickname || 'E院用户',
              avatarUrl: publicImageUrl(actor.avatarUrl),
              bio,
              isOnline: actor.isOnline,
              lastActiveAt: actor.lastActiveAt?.toISOString() || null,
              createdAt: actor.createdAt.toISOString(),
              level: growth.level,
              levelName: growth.levelName,
              equippedBadge: actorBadgeMap.get(actor.id) || null,
              profile: actor.Profile
                ? {
                    // Keep the public profile field public; the private
                    // contact name lives in the DTO's displayName field.
                    displayName: actor.Profile.displayName || null,
                    avatarUrl: publicImageUrl(actor.Profile.avatarUrl),
                    bio,
                  }
                : null,
              relationshipStatus,
              requestId: relationshipStatus === 'INCOMING_PENDING' ? actorRequest?.id || null : null,
            } satisfies FriendDockUser
          })()
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
        typeLabel: getNotificationTypeLabel(item.type, link, 'personal', item.key),
        category: getNotificationCategory(item.type, link, item.key),
        title: likeTitle || resolveNotificationActorText(item.title, actorName) || getNotificationTypeLabel(item.type, link, 'personal', item.key),
        content: likeTitle ? null : resolveNotificationActorText(item.content, actorName),
        key: item.key,
        link,
        targetUrl: link,
        actorName: actorDisplayName,
        actorUid: actor?.uid || null,
        actorAvatarUrl: publicImageUrl(actor?.Profile?.avatarUrl || actor?.avatarUrl),
        actorBadge: actor ? actorBadgeMap.get(actor.id) || null : null,
        actorProfile,
        actorUnavailable: Boolean(actor && !actorProfile),
        likeCount,
        likeTargetKind: likeTarget?.kind || null,
        popup: false,
        sticky: false,
        isRead: Boolean(item.readAt),
        read: Boolean(item.readAt),
        createdAt: item.createdAt,
        readAt: item.readAt,
        replyTarget: parseNotificationReplyTarget({
          id: item.id,
          source: 'personal',
          type: item.type,
          link,
          targetUrl: link,
        }),
        replyDisabledReason: null,
        replyPreview: null,
      } satisfies UnifiedNotification]
    }
    const item = systemById.get(row.id)
    if (!item) return []
    const targetUrl = normalizeActionUrl(item.buttonUrl) || normalizeActionUrl(item.link)
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
      actorBadge: null,
      actorProfile: null,
      actorUnavailable: false,
      popup: item.popup,
      sticky: item.sticky,
      isRead,
      read: isRead,
      createdAt: item.publishAt || item.createdAt,
      readAt: item.SystemNotificationRead[0]?.readAt || null,
      replyTarget: null,
      replyDisabledReason: null,
      replyPreview: null,
    } satisfies UnifiedNotification]
  }).sort(compareNotificationOrder)

  const targets = merged.flatMap((item) => item.replyTarget ? [item.replyTarget] : [])
  const postTargets = targets.filter((target) => target.kind === 'post')
  const dailyTargets = targets.filter((target) => target.kind === 'daily-message')
  const feedbackTargets = targets.filter((target) => target.kind === 'feedback')
  const wallTargets = targets.filter((target) => target.kind === 'profile-wall')
  const [postReplyResult, dailyCommentResult, feedbackResult, feedbackReplyResult, wallMessageResult] = await Promise.allSettled([
    postTargets.length ? prisma.reply.findMany({
      where: { id: { in: postTargets.map((target) => target.parentId) } },
      select: { id: true, postId: true, content: true, moderationStatus: true, stickerId: true, isDeleted: true },
    }) : [],
    loadDailyNotificationComments(dailyTargets, 'list'),
    feedbackTargets.length ? prisma.feedback.findMany({
      where: { id: { in: feedbackTargets.map((target) => target.resourceId) }, userId },
      select: { id: true, status: true },
    }) : [],
    feedbackTargets.length ? prisma.feedbackReply.findMany({
      where: {
        id: { in: feedbackTargets.map((target) => target.parentId) },
        Feedback: { userId },
      },
      select: {
        id: true,
        feedbackId: true,
        content: true,
        moderationStatus: true,
        FeedbackAttachment: { select: { id: true }, take: 1 },
      },
    }) : [],
    wallTargets.length ? prisma.profileWallMessage.findMany({
      where: { id: { in: wallTargets.map((target) => target.parentId) }, deletedAt: null },
      select: { id: true, content: true, moderationStatus: true, User_ProfileWallMessage_receiverIdToUser: { select: { uid: true } } },
    }) : [],
  ])
  const postReplies = postReplyResult.status === 'fulfilled'
    ? postReplyResult.value
    : (() => {
        degraded = true
        logNotificationError('list.reply-hydration', { userId, page, pageSize, category }, postReplyResult.reason)
        return []
      })()
  const dailyCommentLookup = dailyCommentResult.status === 'fulfilled'
    ? dailyCommentResult.value
    : (() => {
        degraded = true
        logNotificationError('list.daily-comment-hydration', { userId, page, pageSize, category }, dailyCommentResult.reason)
        return { rows: [] as DailyCommentNotificationRow[], failed: true }
      })()
  const feedbacks = feedbackResult.status === 'fulfilled'
    ? feedbackResult.value
    : (() => {
        degraded = true
        logNotificationError('list.feedback-hydration', { userId, page, pageSize, category }, feedbackResult.reason)
        return []
      })()
  const feedbackReplies = feedbackReplyResult.status === 'fulfilled'
    ? feedbackReplyResult.value
    : (() => {
        degraded = true
        logNotificationError('list.feedback-reply-hydration', { userId, page, pageSize, category }, feedbackReplyResult.reason)
        return []
      })()
  const wallMessages = wallMessageResult.status === 'fulfilled'
    ? wallMessageResult.value
    : (() => {
        degraded = true
        logNotificationError('list.wall-message-hydration', { userId, page, pageSize, category }, wallMessageResult.reason)
        return []
      })()
  if (dailyCommentLookup.failed) degraded = true
  const dailyComments = dailyCommentLookup.rows
  const postReplyById = new Map(postReplies.map((reply) => [reply.id, reply]))
  const feedbackReplyById = new Map(feedbackReplies.map((reply) => [reply.id, reply]))

  // 逐条占位容错：当某条通知关联的内容（帖子/评论/回复/反馈/留言墙）缺失或被删除时，
  // 保留通知记录并以占位文案展示，而不是让单条异常拖垮整页。同时收集这些通知的 ID，
  // 便于服务端定位「是哪一条通知导致加载异常」。
  const fallbackItemIds: string[] = []
  const items = merged.map((item) => {
    const target = item.replyTarget
    if (!target) return item
    if (target.kind === 'post') {
      const reply = postReplyById.get(target.parentId)
      if (!reply || reply.postId !== target.resourceId || reply.isDeleted) {
        fallbackItemIds.push(item.id)
        return { ...item, replyDisabledReason: REPLY_UNAVAILABLE_TEXT, replyPreview: REPLY_UNAVAILABLE_TEXT }
      }
      return {
        ...item,
        replyPreview: formatNotificationReplyPreview({
          content: reply.content,
          moderationStatus: reply.moderationStatus,
          stickerId: reply.stickerId,
        }),
      }
    }
    if (target.kind === 'daily-message') {
      if (dailyCommentLookup.failed) {
        fallbackItemIds.push(item.id)
        return { ...item, replyDisabledReason: '暂时无法加载回复，请稍后重试', replyPreview: '暂时无法加载回复，请稍后重试' }
      }
      // The reply ID is the durable identity. Its messageId is authoritative
      // for old links whose duplicated message parameter was stale or malformed.
      const comment = dailyComments.find((row) => row.id === target.parentId)
      if (!comment) {
        fallbackItemIds.push(item.id)
        return { ...item, replyDisabledReason: REPLY_NOT_FOUND_TEXT, replyPreview: REPLY_NOT_FOUND_TEXT }
      }
      if (comment.isDeleted) {
        fallbackItemIds.push(item.id)
        return { ...item, replyDisabledReason: REPLY_DELETED_TEXT, replyPreview: REPLY_DELETED_TEXT }
      }
      if (comment.DailyMessage.isDeleted) {
        fallbackItemIds.push(item.id)
        return { ...item, replyDisabledReason: REPLY_DELETED_TEXT, replyPreview: REPLY_DELETED_TEXT }
      }
      if (!canViewDailyNotificationMessage(comment, userId)) {
        fallbackItemIds.push(item.id)
        return { ...item, replyDisabledReason: REPLY_NO_PERMISSION_TEXT, replyPreview: REPLY_NO_PERMISSION_TEXT }
      }
      return {
        ...item,
        replyPreview: formatNotificationReplyPreview({ content: comment.content, moderationStatus: comment.moderationStatus }),
      }
    }
    if (target.kind === 'feedback') {
      const feedback = feedbacks.find((row) => row.id === target.resourceId)
      const reply = feedbackReplyById.get(target.parentId)
      if (!feedback || !reply || reply.feedbackId !== feedback.id) {
        fallbackItemIds.push(item.id)
        return { ...item, replyDisabledReason: '该内容已被删除或无法查看，或你没有查看权限', replyPreview: REPLY_UNAVAILABLE_TEXT }
      }
      if (feedback.status === 'RESOLVED' || feedback.status === 'CLOSED') {
        return {
          ...item,
          replyDisabledReason: '该反馈已关闭，无法回复',
          replyPreview: formatNotificationReplyPreview({
            content: reply.content,
            moderationStatus: reply.moderationStatus,
            hasImages: reply.FeedbackAttachment.length > 0,
          }),
        }
      }
      return {
        ...item,
        replyPreview: formatNotificationReplyPreview({
          content: reply.content,
          moderationStatus: reply.moderationStatus,
          hasImages: reply.FeedbackAttachment.length > 0,
        }),
      }
    }
    if (target.kind === 'profile-wall') {
      const message = wallMessages.find((row) => row.id === target.parentId && String(row.User_ProfileWallMessage_receiverIdToUser.uid) === String(Number(target.resourceId)))
      if (!message) {
        fallbackItemIds.push(item.id)
        return { ...item, replyDisabledReason: REPLY_UNAVAILABLE_TEXT, replyPreview: REPLY_UNAVAILABLE_TEXT }
      }
      return {
        ...item,
        replyPreview: formatNotificationReplyPreview({ content: message.content, moderationStatus: message.moderationStatus }),
      }
    }
    return item
  })

  // 服务端诊断日志：记录导致占位（内容缺失/无权限/查询失败）的具体通知 ID，
  // 直接回应「是哪一个 notificationId 导致加载失败」的排查需求。
  if (fallbackItemIds.length) {
    logNotificationError('list.item-fallback', {
      userId,
      page,
      pageSize,
      category,
      count: fallbackItemIds.length,
      sampleNotificationIds: fallbackItemIds.slice(0, 25).join(','),
    }, new Error('notification(s) rendered with placeholder due to missing related content'))
  }

  // Maintenance is deliberately after the page has been assembled. A database
  // failure above must not race a background task that changes readAt or removes
  // a notification while the user is looking at an error state.
  scheduleNotificationReconciliation(userId, 'list')

  return {
    items,
    total,
    page,
    pageSize,
    totalPages,
    unreadCount: personalUnread + systemUnread,
    ...(degraded ? { degraded: true } : {}),
  }
}

export async function listUnifiedNotifications(userId: string, options: { unreadOnly?: boolean; limit?: number; canReview?: boolean } = {}) {
  const page = await listUnifiedNotificationsPage(userId, {
    unreadOnly: options.unreadOnly,
    page: 1,
    pageSize: options.limit || MAX_NOTIFICATION_PAGE_SIZE,
    canReview: options.canReview,
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
    const targetUrl = normalizeActionUrl(item.buttonUrl) || normalizeActionUrl(item.link)
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
      actorBadge: null,
      actorProfile: null,
      actorUnavailable: false,
      popup: item.popup,
      sticky: item.sticky,
      isRead: false,
      read: false,
      createdAt: item.publishAt || item.createdAt,
      readAt: null,
      replyTarget: null,
      replyDisabledReason: null,
      replyPreview: null,
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
  return existing?.readAt ? { ok: true, readAt: existing.readAt } : { ok: false, readAt: null }
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
    ...(unreadSystem.length
      ? [
          prisma.systemNotificationRead.createMany({
            data: unreadSystem.map((item) => ({ notificationId: item.id, userId, readAt: now })),
            skipDuplicates: true,
          }),
        ]
      : []),
  ])

  // 对账（清理历史幽灵通知 / 点赞聚合）属于维护性工作，不是"全部已读"的必要路径。
  // 列表接口已经在后台异步对账，这里改为后台执行，避免阻塞用户点击的响应时间，
  // 让"全部已读"在一笔事务内完成（一次 UPDATE WHERE readAt IS NULL + 系统通知已读标记）。
  scheduleNotificationReconciliation(userId, 'read-all')
}

/**
 * 将当前用户所有"已完成审核结果"的通知标记为已读。
 *
 * 本项目里审核结果通知仍用 `type: 'ADMIN'` 存储，并通过 `link` 区分资源；
 * 待审核提醒使用 `type: 'REVIEW'`，旧提醒继续按稳定 link/key 兼容：
 *   - 帖子审核结果：link 以 `/posts/` 开头（无 key）
 *   - 表情包审核结果：link 为 `/profile/stickers...`（key = `sticker-pack-review:*`）
 *
 * 因此本函数把更新范围严格限定为审核结果或审核提醒的稳定 link/key，
 * 不会触碰以下通知：点赞(LIKE)、评论回复(REPLY)、私信(MESSAGE)、好友(FRIEND_REQUEST/FOLLOW)、
 * 系统(SYSTEM)、公告(ANNOUNCEMENT)、反馈提醒(/admin/feedback、/feedback/*)等。
 *
 * 幂等：仅更新 `readAt: null` 的行，重复调用安全，不会重置已读时间。
 * 不修改数据库结构。
 */
export async function markModerationNotificationsRead(userId: string) {
  const readAt = new Date()
  const pendingReviewNotifications = await prisma.notification.findMany({
    where: {
      recipientId: userId,
      readAt: null,
      OR: [
        { type: 'REVIEW', link: '/admin/posts/review', key: { startsWith: 'post-review:' } },
        { type: 'ADMIN', link: '/admin/posts/review', key: { startsWith: 'post-review:' } },
      ],
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
      readAt: null,
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
          readAt: null,
          link: '/admin/posts/review',
          AND: [
            { OR: [{ type: 'REVIEW' }, { type: 'ADMIN' }] },
            { OR: completedPostIds.map((id) => ({ key: { startsWith: `post-review:${id}` } })) },
          ],
        },
        data: { isRead: true, readAt },
      })
      count += completedResult.count
    }
  }

  return { ok: true, count, readAt }
}
