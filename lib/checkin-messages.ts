import { prisma } from '@/lib/prisma'
import { getFriendDisplayName, getPublicUserDisplayName, loadFriendRemarkMap } from '@/lib/friend-remarks'
import { publicImageUrl } from '@/lib/images'
import { planFriendCheckInMessagePage } from '@/lib/checkin-message-order'
import { publicModerationText } from '@/lib/content-moderation'
import { getEquippedBadgesForUsers } from '@/lib/badge-service'
import { CHECK_IN_MESSAGE_PAGE_SIZE } from '@/lib/checkin-pagination'
export { anonymizeCheckInMessages } from '@/lib/checkin-message-display'
export type { AnonymousCheckInMessageItem } from '@/lib/checkin-message-display'

export { CHECK_IN_DESKTOP_MESSAGE_PAGE_SIZE, CHECK_IN_MESSAGE_PAGE_SIZE, getCheckInMessagePageSize } from '@/lib/checkin-pagination'

export type CheckInMessageSort = 'latest' | 'hot'

type CheckInMessagesResult = Awaited<ReturnType<typeof getCheckInMessagesUncached>>
export type CheckInMessageItem = CheckInMessagesResult[number]
const publicDailyMessageStatuses: Array<'APPROVED' | 'VIOLATION'> = ['APPROVED', 'VIOLATION']
export type CheckInMessagePagination = {
  page: number
  pageSize: number
  total: number
  totalPages: number
  hasMore: boolean
}
export type CheckInMessagesPage = {
  messages: CheckInMessageItem[]
  pagination: CheckInMessagePagination
}

export type CheckInNotificationTarget = {
  messageId: string | null
  commentId: string | null
  date: Date | null
  status: CheckInNotificationTargetStatus
}

/**
 * The notification center and the check-in page need to distinguish a target
 * that is missing from one that exists but is no longer visible.  Keeping the
 * result explicit prevents a valid reply from being reported as a generic
 * "no permission" error when it simply lives outside the current list page.
 */
export type CheckInNotificationTargetStatus = 'FOUND' | 'DELETED' | 'NOT_FOUND' | 'FORBIDDEN'
export type CheckInNotificationResolutionStatus = CheckInNotificationTargetStatus | 'LOAD_FAILED'

const checkInNotificationMessageSelect = {
  id: true,
  date: true,
  isDeleted: true,
  moderationStatus: true,
  userId: true,
  User: {
    select: {
      status: true,
      isDeleted: true,
      Profile: { select: { id: true } },
    },
  },
} as const

type CheckInNotificationMessage = {
  id: string
  date: Date
  isDeleted: boolean
  moderationStatus: string
  userId: string
  User: { status: string; isDeleted: boolean; Profile: { id: string } | null }
}

function isActiveCheckInUser(user: CheckInNotificationMessage['User']) {
  return user.status === 'ACTIVE' && !user.isDeleted
}

function isPublicCheckInMessage(message: CheckInNotificationMessage) {
  return !message.isDeleted
    && publicDailyMessageStatuses.includes(message.moderationStatus as 'APPROVED' | 'VIOLATION')
    && isActiveCheckInUser(message.User)
    && Boolean(message.User.Profile)
}

function canViewCheckInNotificationMessage(
  message: CheckInNotificationMessage,
  viewerId?: string,
  viewerCanModerate = false,
) {
  if (isPublicCheckInMessage(message)) return true
  if (viewerCanModerate && !message.isDeleted && isActiveCheckInUser(message.User)) return true
  return Boolean(viewerId && message.userId === viewerId && !message.isDeleted && isActiveCheckInUser(message.User))
}

function getCheckInNotificationMessageStatus(
  message: CheckInNotificationMessage,
  viewerId?: string,
  viewerCanModerate = false,
): CheckInNotificationTargetStatus {
  if (message.isDeleted) return 'DELETED'
  return canViewCheckInNotificationMessage(message, viewerId, viewerCanModerate) ? 'FOUND' : 'FORBIDDEN'
}

/**
 * Resolve a notification target from durable database IDs, not from the
 * current date, sort order, or pagination. A reply is authoritative about
 * both its parent message and the business date, which also makes reply-only
 * legacy links recoverable when the reply ID was persisted in the URL.
 */
export async function resolveCheckInNotificationTarget({
  messageId,
  commentId,
  viewerId,
  viewerCanModerate = false,
}: {
  messageId?: string | null
  commentId?: string | null
  viewerId?: string | null
  viewerCanModerate?: boolean
}): Promise<CheckInNotificationTarget> {
  const safeMessageId = messageId?.trim() || null
  const safeCommentId = commentId?.trim() || null
  if (!safeMessageId && !safeCommentId) return { messageId: null, commentId: null, date: null, status: 'NOT_FOUND' }

  const comment = safeCommentId
    ? await prisma.dailyMessageComment.findUnique({
        where: { id: safeCommentId },
        select: {
          id: true,
          messageId: true,
          isDeleted: true,
          DailyMessage: { select: checkInNotificationMessageSelect },
        },
      })
    : null
  if (comment) {
    return {
      messageId: comment.messageId,
      commentId: safeCommentId,
      date: comment.DailyMessage.date,
      status: comment.isDeleted
        ? 'DELETED'
        : getCheckInNotificationMessageStatus(comment.DailyMessage, viewerId || undefined, viewerCanModerate),
    }
  }

  const message = safeMessageId
    ? await prisma.dailyMessage.findUnique({ where: { id: safeMessageId }, select: checkInNotificationMessageSelect })
    : null
  return {
    messageId: message?.id || safeMessageId,
    commentId: safeCommentId,
    date: message?.date || null,
    status: safeCommentId
      ? 'NOT_FOUND'
      : message
        ? getCheckInNotificationMessageStatus(message, viewerId || undefined, viewerCanModerate)
        : 'NOT_FOUND',
  }
}

import type { AnonymousCheckInMessageItem } from '@/lib/checkin-message-display'

export type CheckInDisplayMessageItem = CheckInMessageItem | AnonymousCheckInMessageItem

const checkInMessagesCacheTtlMs = Number(process.env.CHECKIN_MESSAGES_CACHE_TTL_MS || 10000)
const checkInMessagesCache = new Map<string, { expiresAt: number; promise: Promise<CheckInMessagesResult> }>()

const checkInCommentUserSelect = {
  id: true,
  uid: true,
  nickname: true,
  usernameModerationStatus: true,
  nicknameModerationStatus: true,
  nicknameViolationDisplay: true,
  avatarUrl: true,
  level: true,
  Profile: { select: { displayName: true, displayNameModerationStatus: true, avatarUrl: true } },
} as const

export function invalidateCheckInMessagesCache() {
  checkInMessagesCache.clear()
}

function buildCheckInMessagesWhere({
  messageId,
  selectedDate,
  nextDate,
  userIds,
}: {
  messageId?: string
  selectedDate: Date
  nextDate: Date
  userIds?: string[]
}) {
  return {
    ...(messageId ? { id: messageId } : {}),
    date: { gte: selectedDate, lt: nextDate },
    isDeleted: false,
    moderationStatus: { in: publicDailyMessageStatuses },
    ...(userIds ? { userId: { in: userIds } } : {}),
    User: { status: 'ACTIVE' as const, isDeleted: false, Profile: { isNot: null } },
  }
}

/**
 * A notification target is not a list query.  It must be loadable even when
 * the message is outside the current page, and the author must still be able
 * to open their own valid message from a notification.  Keep this narrower
 * than the normal feed query so the relaxed owner/moderator branches are only
 * reachable when an exact durable message ID was supplied.
 */
function buildFocusedCheckInMessageWhere({
  messageId,
  selectedDate,
  nextDate,
  viewerId,
  viewerCanModerate,
}: {
  messageId: string
  selectedDate: Date
  nextDate: Date
  viewerId: string
  viewerCanModerate: boolean
}) {
  const activeUser = { status: 'ACTIVE' as const, isDeleted: false }
  return {
    id: messageId,
    date: { gte: selectedDate, lt: nextDate },
    OR: [
      {
        isDeleted: false,
        moderationStatus: { in: publicDailyMessageStatuses },
        User: { ...activeUser, Profile: { isNot: null } },
      },
      {
        isDeleted: false,
        userId: viewerId,
        User: activeUser,
      },
      ...(viewerCanModerate ? [{ isDeleted: false, User: activeUser }] : []),
    ],
  }
}

function getCheckInMessagesOrderBy(sort: CheckInMessageSort) {
  return sort === 'hot'
    ? [
        { isAdminMessage: 'desc' as const },
        { sort: 'asc' as const },
        { isPinned: 'desc' as const },
        { isFeatured: 'desc' as const },
        { likeCount: 'desc' as const },
        { commentCount: 'desc' as const },
        { createdAt: 'desc' as const },
        { id: 'desc' as const },
      ]
    : [
        { isAdminMessage: 'desc' as const },
        { sort: 'asc' as const },
        { isPinned: 'desc' as const },
        { isFeatured: 'desc' as const },
        { createdAt: 'desc' as const },
        { id: 'desc' as const },
      ]
}

export async function getCheckInMessages({
  selectedDate,
  nextDate,
  sort,
  viewerId,
  viewerCanModerate = false,
  userIds,
  orderByCreatedAtDesc = false,
  page = 1,
  pageSize = CHECK_IN_MESSAGE_PAGE_SIZE,
  skip,
  take,
  friendContext = false,
}: {
  selectedDate: Date
  nextDate: Date
  sort: CheckInMessageSort
  viewerId: string
  viewerCanModerate?: boolean
  userIds?: string[]
  orderByCreatedAtDesc?: boolean
  page?: number
  pageSize?: number
  skip?: number
  take?: number
  /** True only for the authenticated viewer's private friend feed. */
  friendContext?: boolean
}): Promise<CheckInMessagesResult> {
  const safePage = Math.max(1, Math.trunc(page) || 1)
  const safePageSize = Math.min(50, Math.max(1, Math.trunc(pageSize) || CHECK_IN_MESSAGE_PAGE_SIZE))
  const safeSkip = typeof skip === 'number' ? Math.max(0, Math.trunc(skip) || 0) : (safePage - 1) * safePageSize
  const safeTake = Math.min(50, Math.max(1, Math.trunc(take ?? safePageSize) || safePageSize))
  const userScope = userIds === undefined
    ? 'public'
    : `friends:${[...userIds].sort().join(',') || 'none'}`
  const cacheKey = [
    selectedDate.toISOString(),
    nextDate.toISOString(),
    sort,
    viewerId,
    viewerCanModerate ? 'moderator' : 'member',
    friendContext ? 'friend' : 'public',
    userScope,
    orderByCreatedAtDesc ? 'createdAt' : 'display',
    safeSkip,
    safeTake,
  ].join(':')
  const now = Date.now()
  const cached = checkInMessagesCache.get(cacheKey)
  if (cached && cached.expiresAt > now) return cached.promise

  const promise = getCheckInMessagesUncached({
    selectedDate,
    nextDate,
    sort,
    viewerId,
    viewerCanModerate,
    userIds,
    orderByCreatedAtDesc,
    skip: safeSkip,
    take: safeTake,
    friendContext,
  }).catch((error) => {
    checkInMessagesCache.delete(cacheKey)
    throw error
  })
  checkInMessagesCache.set(cacheKey, { expiresAt: now + checkInMessagesCacheTtlMs, promise })
  return promise
}

export async function getCheckInMessagesPage({
  selectedDate,
  nextDate,
  sort,
  viewerId,
  viewerCanModerate = false,
  userIds,
  stickyUserId,
  followedUserIds,
  page = 1,
  pageSize = CHECK_IN_MESSAGE_PAGE_SIZE,
  friendContext = false,
}: {
  selectedDate: Date
  nextDate: Date
  sort: CheckInMessageSort
  viewerId: string
  viewerCanModerate?: boolean
  userIds?: string[]
  /** Friends scope only: keep this user's latest valid message outside friend pagination. */
  stickyUserId?: string
  /** Friends scope only: a subset of userIds that belongs in the second group. */
  followedUserIds?: string[]
  page?: number
  pageSize?: number
  friendContext?: boolean
}): Promise<CheckInMessagesPage> {
  const safePageSize = Math.min(50, Math.max(1, Math.trunc(pageSize) || CHECK_IN_MESSAGE_PAGE_SIZE))
  const safeRequestedPage = Math.max(1, Math.trunc(page) || 1)
  if (userIds !== undefined && (stickyUserId || followedUserIds !== undefined)) {
    const friendUserIds = [...new Set(userIds)].filter((userId) => userId !== stickyUserId)
    const followedSet = new Set((followedUserIds || []).filter((userId) => friendUserIds.includes(userId)))
    const followedFriendUserIds = friendUserIds.filter((userId) => followedSet.has(userId))
    const ordinaryFriendUserIds = friendUserIds.filter((userId) => !followedSet.has(userId))
    const [stickyMessages, followedTotal, ordinaryTotal] = await Promise.all([
      stickyUserId
        ? getCheckInMessages({
            selectedDate,
            nextDate,
            sort: 'latest',
            viewerId,
            viewerCanModerate,
            userIds: [stickyUserId],
            orderByCreatedAtDesc: true,
            page: 1,
            pageSize: 1,
            friendContext,
          })
        : Promise.resolve([] as CheckInMessageItem[]),
      followedFriendUserIds.length
        ? prisma.dailyMessage.count({
            where: buildCheckInMessagesWhere({ selectedDate, nextDate, userIds: followedFriendUserIds }),
          })
        : Promise.resolve(0),
      ordinaryFriendUserIds.length
        ? prisma.dailyMessage.count({
            where: buildCheckInMessagesWhere({ selectedDate, nextDate, userIds: ordinaryFriendUserIds }),
          })
        : Promise.resolve(0),
    ])
    const stickyMessage = stickyMessages[0] || null
    const plan = planFriendCheckInMessagePage({
      ownCount: stickyMessage ? 1 : 0,
      followedCount: followedTotal,
      ordinaryCount: ordinaryTotal,
      page: safeRequestedPage,
      pageSize: safePageSize,
    })
    const messages: CheckInMessageItem[] = []

    if (stickyMessage && plan.own.take > 0) messages.push(stickyMessage)

    async function appendGroup(userIdsForGroup: string[], offset: number, take: number) {
      if (!userIdsForGroup.length || take <= 0) return
      const rows = await getCheckInMessages({
        selectedDate,
        nextDate,
        sort,
        viewerId,
        viewerCanModerate,
        userIds: userIdsForGroup,
        skip: offset,
        take,
        page: 1,
        pageSize: take,
        friendContext,
      })
      messages.push(...rows)
    }

    await appendGroup(followedFriendUserIds, plan.followed.offset, plan.followed.take)
    await appendGroup(ordinaryFriendUserIds, plan.ordinary.offset, plan.ordinary.take)

    return {
      messages,
      pagination: {
        page: plan.page,
        pageSize: plan.pageSize,
        total: plan.total,
        totalPages: plan.totalPages,
        hasMore: plan.hasMore,
      },
    }
  }

  if (userIds && userIds.length === 0) {
    return {
      messages: [],
      pagination: { page: 1, pageSize: safePageSize, total: 0, totalPages: 1, hasMore: false },
    }
  }

  const total = await prisma.dailyMessage.count({
    where: buildCheckInMessagesWhere({ selectedDate, nextDate, userIds }),
  })
  const totalPages = Math.max(1, Math.ceil(total / safePageSize))
  const safePage = Math.min(safeRequestedPage, totalPages)
  const messages = await getCheckInMessages({
    selectedDate,
    nextDate,
    sort,
    viewerId,
    viewerCanModerate,
    userIds,
    page: safePage,
    pageSize: safePageSize,
    friendContext,
  })

  return {
    messages,
    pagination: { page: safePage, pageSize: safePageSize, total, totalPages, hasMore: safePage < totalPages },
  }
}

export async function getCheckInMessage({
  messageId,
  selectedDate,
  nextDate,
  viewerId,
  viewerCanModerate = false,
  focusCommentId,
  friendContext = false,
}: {
  messageId: string
  selectedDate: Date
  nextDate: Date
  viewerId: string
  viewerCanModerate?: boolean
  focusCommentId?: string
  friendContext?: boolean
}): Promise<CheckInMessageItem | null> {
  const messages = await getCheckInMessagesUncached({
    messageId,
    focusCommentId,
    focusedTarget: true,
    selectedDate,
    nextDate,
    sort: 'latest',
    viewerId,
    viewerCanModerate,
    friendContext,
  })
  return messages[0] || null
}

async function getCheckInMessagesUncached({
  messageId,
  focusCommentId,
  focusedTarget = false,
  selectedDate,
  nextDate,
  sort,
  viewerId,
  viewerCanModerate,
  userIds,
  orderByCreatedAtDesc,
  skip,
  take,
  friendContext,
}: {
  messageId?: string
  focusCommentId?: string
  focusedTarget?: boolean
  selectedDate: Date
  nextDate: Date
  sort: CheckInMessageSort
  viewerId: string
  viewerCanModerate: boolean
  userIds?: string[]
  orderByCreatedAtDesc?: boolean
  skip?: number
  take?: number
  friendContext: boolean
}) {
  if (userIds && userIds.length === 0) return []

  const rows = await prisma.dailyMessage.findMany({
    where: messageId && focusedTarget
      ? buildFocusedCheckInMessageWhere({
          messageId,
          selectedDate,
          nextDate,
          viewerId,
          viewerCanModerate,
        })
      : buildCheckInMessagesWhere({ messageId, selectedDate, nextDate, userIds }),
    orderBy: orderByCreatedAtDesc
      ? [{ createdAt: 'desc' as const }, { id: 'desc' as const }]
      : getCheckInMessagesOrderBy(sort),
    ...(typeof skip === 'number' ? { skip } : {}),
    take: messageId ? 1 : take ?? CHECK_IN_MESSAGE_PAGE_SIZE,
    include: {
      User: {
        select: {
          id: true,
          uid: true,
          nickname: true,
          usernameModerationStatus: true,
          nicknameModerationStatus: true,
          nicknameViolationDisplay: true,
          avatarUrl: true,
          level: true,
          Profile: { select: { displayName: true, displayNameModerationStatus: true, avatarUrl: true } },
        },
      },
      DailyMessageLike: {
        orderBy: { createdAt: 'desc' as const },
        take: 10,
        select: {
          userId: true,
          User: {
            select: {
              id: true,
              uid: true,
              nickname: true,
              usernameModerationStatus: true,
              nicknameModerationStatus: true,
              nicknameViolationDisplay: true,
              avatarUrl: true,
              Profile: { select: { displayName: true, displayNameModerationStatus: true, avatarUrl: true } },
            },
          },
        },
      },
      DailyMessageFavorite: { where: { userId: viewerId }, select: { id: true } },
      DailyMessageComment: {
        where: { isDeleted: false },
        orderBy: { createdAt: 'asc' },
        take: 50,
        include: { User: { select: checkInCommentUserSelect } },
      },
    },
  })

  // Notification links may target an older reply that falls outside the first
  // 50 replies returned for a message. Load that exact visible reply as well,
  // so a valid notification target cannot be mistaken for a deleted reply.
  const focusedComment = messageId && focusCommentId
    ? await prisma.dailyMessageComment.findFirst({
        where: { id: focusCommentId, messageId, isDeleted: false },
        include: { User: { select: checkInCommentUserSelect } },
      })
    : null
  const focusedComments = focusedComment ? [focusedComment] : []
  const focusedCommentIds = new Set(focusedComments.map((comment) => comment.id))
  let parentId = focusedComment?.parentId || null
  // A notification can point to an old nested reply that is outside the
  // normal first-50 comment window. Load its visible ancestor chain as well;
  // otherwise the reply has no root in the client tree and cannot be rendered.
  while (parentId && focusedComments.length < 20 && !focusedCommentIds.has(parentId)) {
    const parent = await prisma.dailyMessageComment.findFirst({
      where: { id: parentId, messageId, isDeleted: false },
      include: { User: { select: checkInCommentUserSelect } },
    })
    if (!parent) break
    focusedComments.push(parent)
    focusedCommentIds.add(parent.id)
    parentId = parent.parentId
  }
  // If a visible reply's deleted/inaccessible parent stopped the chain, make
  // the first visible node a root for this read-only view so the target itself
  // remains reachable instead of silently disappearing from the tree.
  const focusedCommentsForDisplay = focusedComments.map((comment) => (
    comment.parentId && !focusedCommentIds.has(comment.parentId)
      ? { ...comment, parentId: null }
      : comment
  ))
  const rowsWithFocus = focusedCommentsForDisplay.length
    ? rows.map((row) => row.id !== messageId
      ? row
      : {
          ...row,
          DailyMessageComment: [...row.DailyMessageComment, ...focusedCommentsForDisplay]
            .filter((comment, index, all) => all.findIndex((candidate) => candidate.id === comment.id) === index)
            .sort((left, right) => left.createdAt.getTime() - right.createdAt.getTime()),
        })
    : rows

  // 当前用户对这些留言的点赞：一次批量查询（避免 N+1），保持 likes.length > 0 ⇔ 当前用户已点赞 的既有契约。
  const viewerLikes = rowsWithFocus.length
    ? await prisma.dailyMessageLike.findMany({
        where: { userId: viewerId, messageId: { in: rowsWithFocus.map((row) => row.id) } },
        select: { id: true, messageId: true },
      })
    : []
  const viewerLikeIdByMessage = new Map(viewerLikes.map((like) => [like.messageId, like.id]))
  const displayNameUserIds = [
    ...rowsWithFocus.map((item) => item.userId),
    ...rowsWithFocus.flatMap((item) => item.DailyMessageLike.map((like) => like.userId)),
    ...rowsWithFocus.flatMap((item) => item.DailyMessageComment.map((comment) => comment.User.id)),
  ]
  const [equippedBadges, friendRemarkMap] = await Promise.all([
    getEquippedBadgesForUsers(displayNameUserIds),
    friendContext ? loadFriendRemarkMap(viewerId, displayNameUserIds) : Promise.resolve(new Map<string, string>()),
  ])
  return rowsWithFocus.map((item) => {
    const publicUser = {
      ...item.User,
      nickname: getPublicUserDisplayName(item.User),
      avatarUrl: publicImageUrl(item.User.avatarUrl),
      equippedBadges: equippedBadges.get(item.User.id) || [],
      equippedBadge: equippedBadges.get(item.User.id)?.[0] || null,
      Profile: item.User.Profile ? { ...item.User.Profile, avatarUrl: publicImageUrl(item.User.Profile.avatarUrl) } : item.User.Profile,
    }
    const publicLikes = item.DailyMessageLike.map((like) => ({
      ...like,
      User: {
        ...like.User,
        nickname: getPublicUserDisplayName(like.User),
        avatarUrl: publicImageUrl(like.User.avatarUrl),
        equippedBadges: equippedBadges.get(like.User.id) || [],
        equippedBadge: equippedBadges.get(like.User.id)?.[0] || null,
        Profile: like.User.Profile ? { ...like.User.Profile, avatarUrl: publicImageUrl(like.User.Profile.avatarUrl) } : like.User.Profile,
      },
    }))
    const publicComments = item.DailyMessageComment.map((comment) => ({
      ...comment,
      content: publicModerationText(comment.content, comment.moderationStatus),
      User: {
        ...comment.User,
        nickname: getPublicUserDisplayName(comment.User),
        avatarUrl: publicImageUrl(comment.User.avatarUrl),
        equippedBadges: equippedBadges.get(comment.User.id) || [],
        equippedBadge: equippedBadges.get(comment.User.id)?.[0] || null,
        Profile: comment.User.Profile ? { ...comment.User.Profile, avatarUrl: publicImageUrl(comment.User.Profile.avatarUrl) } : comment.User.Profile,
      },
    }))
    const authorNickname = getPublicUserDisplayName(item.User)
    const authorRemark = friendRemarkMap.get(item.userId) || null
    const authorName = getFriendDisplayName({ nickname: authorNickname, friendRemark: authorRemark, isFriendContext: friendContext })
    return {
      ...item,
      content: publicModerationText(item.content, item.moderationStatus),
      User: publicUser,
      DailyMessageLike: publicLikes,
      DailyMessageComment: publicComments,
      author: {
        ...publicUser,
        friendRemark: authorRemark,
        displayName: authorName,
        profile: item.User.Profile ? { ...item.User.Profile, avatarUrl: publicImageUrl(item.User.Profile.avatarUrl), displayName: item.User.Profile.displayName } : item.User.Profile,
      },
      likes: viewerLikeIdByMessage.has(item.id) ? [{ id: viewerLikeIdByMessage.get(item.id)! }] : [],
      likers: item.DailyMessageLike.map((like) => ({
        id: like.User.id,
        uid: like.User.uid,
        nickname: getPublicUserDisplayName(like.User),
        friendRemark: friendRemarkMap.get(like.User.id) || null,
        displayName: getFriendDisplayName({
          nickname: getPublicUserDisplayName(like.User),
          friendRemark: friendRemarkMap.get(like.User.id),
          isFriendContext: friendContext,
        }),
        avatarUrl: publicImageUrl(like.User.Profile?.avatarUrl || like.User.avatarUrl || null),
        equippedBadges: equippedBadges.get(like.User.id) || [],
        equippedBadge: equippedBadges.get(like.User.id)?.[0] || null,
      })),
      favorites: item.DailyMessageFavorite,
      canDelete: viewerCanModerate || item.userId === viewerId,
      date: item.date.toISOString(),
      createdAt: item.createdAt.toISOString(),
      updatedAt: item.updatedAt.toISOString(),
      deletedAt: item.deletedAt?.toISOString() || null,
      comments: item.DailyMessageComment.map((comment) => ({
        ...comment,
        content: publicModerationText(comment.content, comment.moderationStatus),
        author: {
          ...publicComments.find((candidate) => candidate.id === comment.id)!.User,
          friendRemark: friendRemarkMap.get(comment.User.id) || null,
          displayName: getFriendDisplayName({
            nickname: getPublicUserDisplayName(comment.User),
            friendRemark: friendRemarkMap.get(comment.User.id),
            isFriendContext: friendContext,
          }),
          profile: comment.User.Profile ? {
            ...comment.User.Profile,
            avatarUrl: publicImageUrl(comment.User.Profile.avatarUrl),
            displayName: comment.User.Profile.displayName,
          } : comment.User.Profile,
        },
        canDelete: viewerCanModerate || comment.User.id === viewerId,
        createdAt: comment.createdAt.toISOString(),
        updatedAt: comment.updatedAt.toISOString(),
        deletedAt: comment.deletedAt?.toISOString() || null,
      })),
    }
  })
}

export type CheckInReplyStatus = 'visible' | 'deleted' | 'not-found' | 'unavailable'

export async function getCheckInReplyStatus({
  messageId,
  commentId,
  viewerId,
  viewerCanModerate = false,
}: {
  messageId: string
  commentId: string
  viewerId?: string
  viewerCanModerate?: boolean
}): Promise<CheckInReplyStatus> {
  const comment = await prisma.dailyMessageComment.findUnique({
    where: { id: commentId },
    select: {
      messageId: true,
      isDeleted: true,
      DailyMessage: {
        select: {
          ...checkInNotificationMessageSelect,
        },
      },
    },
  })

  if (!comment || comment.messageId !== messageId) return 'not-found'
  if (comment.isDeleted || comment.DailyMessage.isDeleted) return 'deleted'
  return getCheckInNotificationMessageStatus(comment.DailyMessage, viewerId, viewerCanModerate) === 'FOUND'
    ? 'visible'
    : 'unavailable'
}
