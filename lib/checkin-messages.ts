import { prisma } from '@/lib/prisma'
import type { LikeAvatarUser } from '@/components/LikeAvatars'
import { getPublicUserDisplayName, loadFriendRemarkMap, resolveFriendDisplayName } from '@/lib/friend-remarks'
import { publicImageUrl } from '@/lib/images'
import { planFriendCheckInMessagePage } from '@/lib/checkin-message-order'
import { publicModerationText } from '@/lib/content-moderation'

export type CheckInMessageSort = 'latest' | 'hot'

type CheckInMessagesResult = Awaited<ReturnType<typeof getCheckInMessagesUncached>>
export type CheckInMessageItem = CheckInMessagesResult[number]
export const CHECK_IN_MESSAGE_PAGE_SIZE = 5
export const CHECK_IN_DESKTOP_MESSAGE_PAGE_SIZE = 7
const publicDailyMessageStatuses: Array<'APPROVED' | 'VIOLATION'> = ['APPROVED', 'VIOLATION']

export function getCheckInMessagePageSize(isDesktop: boolean) {
  return isDesktop ? CHECK_IN_DESKTOP_MESSAGE_PAGE_SIZE : CHECK_IN_MESSAGE_PAGE_SIZE
}
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

export type AnonymousCheckInMessageItem = {
  id: string
  date: string
  mood: string | null
  moodType: string | null
  moodEmoji: string | null
  moodText: string | null
  content: string
  isPinned: boolean
  isFeatured: boolean
  likeCount: number
  favoriteCount: number
  commentCount: number
  createdAt: string
  ipRegion: string | null
  liked: boolean
  favorited: boolean
  canDelete: boolean
  /** 最新点赞用户（最多 10 个，朋友圈式头像展示）。 */
  likers: LikeAvatarUser[]
  author: { type: 'anonymous'; name: '匿名E友' }
  comments: Array<{
    id: string
    parentId: string | null
    content: string
    createdAt: string
    ipRegion: string | null
    canDelete: boolean
    author: { type: 'anonymous'; name: '匿名E友' }
  }>
}

export type CheckInDisplayMessageItem = CheckInMessageItem | AnonymousCheckInMessageItem

export function anonymizeCheckInMessages(messages: CheckInMessageItem[]): AnonymousCheckInMessageItem[] {
  return messages.map((item) => ({
    id: item.id,
    date: item.date,
    mood: item.mood,
    moodType: item.moodType,
    moodEmoji: item.moodEmoji,
    moodText: item.moodText,
    content: item.content,
    isPinned: item.isPinned,
    isFeatured: item.isFeatured,
    likeCount: item.likeCount,
    favoriteCount: item.favoriteCount,
    commentCount: item.commentCount,
    createdAt: item.createdAt,
    ipRegion: item.ipRegion,
    liked: item.likes.length > 0,
    favorited: item.favorites.length > 0,
    canDelete: item.canDelete,
    // 匿名墙不返回点赞者身份，保护点赞者隐私（点赞数量仍通过 likeCount 公开）。
    likers: [],
    author: { type: 'anonymous', name: '匿名E友' },
    comments: item.comments.map((comment) => ({
      id: comment.id,
      parentId: comment.parentId,
      content: comment.content,
      createdAt: comment.createdAt,
      ipRegion: comment.ipRegion,
      canDelete: comment.canDelete,
      author: { type: 'anonymous', name: '匿名E友' },
    })),
  }))
}

const checkInMessagesCacheTtlMs = Number(process.env.CHECKIN_MESSAGES_CACHE_TTL_MS || 10000)
const checkInMessagesCache = new Map<string, { expiresAt: number; promise: Promise<CheckInMessagesResult> }>()

const checkInCommentUserSelect = {
  id: true,
  uid: true,
  nickname: true,
  usernameModerationStatus: true,
  nicknameModerationStatus: true,
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
}: {
  messageId: string
  selectedDate: Date
  nextDate: Date
  viewerId: string
  viewerCanModerate?: boolean
  focusCommentId?: string
}): Promise<CheckInMessageItem | null> {
  const messages = await getCheckInMessagesUncached({
    messageId,
    focusCommentId,
    selectedDate,
    nextDate,
    sort: 'latest',
    viewerId,
    viewerCanModerate,
  })
  return messages[0] || null
}

async function getCheckInMessagesUncached({
  messageId,
  focusCommentId,
  selectedDate,
  nextDate,
  sort,
  viewerId,
  viewerCanModerate,
  userIds,
  orderByCreatedAtDesc,
  skip,
  take,
}: {
  messageId?: string
  focusCommentId?: string
  selectedDate: Date
  nextDate: Date
  sort: CheckInMessageSort
  viewerId: string
  viewerCanModerate: boolean
  userIds?: string[]
  orderByCreatedAtDesc?: boolean
  skip?: number
  take?: number
}) {
  if (userIds && userIds.length === 0) return []

  const rows = await prisma.dailyMessage.findMany({
    where: buildCheckInMessagesWhere({ messageId, selectedDate, nextDate, userIds }),
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
  const remarkMap = await loadFriendRemarkMap(viewerId, displayNameUserIds)

  return rowsWithFocus.map((item) => {
    const publicUser = {
      ...item.User,
      nickname: getPublicUserDisplayName(item.User),
      avatarUrl: publicImageUrl(item.User.avatarUrl),
      Profile: item.User.Profile ? { ...item.User.Profile, avatarUrl: publicImageUrl(item.User.Profile.avatarUrl) } : item.User.Profile,
    }
    const publicLikes = item.DailyMessageLike.map((like) => ({
      ...like,
      User: {
        ...like.User,
        nickname: getPublicUserDisplayName(like.User),
        avatarUrl: publicImageUrl(like.User.avatarUrl),
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
        Profile: comment.User.Profile ? { ...comment.User.Profile, avatarUrl: publicImageUrl(comment.User.Profile.avatarUrl) } : comment.User.Profile,
      },
    }))
    const authorName = resolveFriendDisplayName({
      viewerId,
      targetUserId: item.userId,
      fallbackName: getPublicUserDisplayName(item.User),
      remarkMap,
    })
    return {
      ...item,
      content: publicModerationText(item.content, item.moderationStatus),
      User: publicUser,
      DailyMessageLike: publicLikes,
      DailyMessageComment: publicComments,
      author: {
        ...publicUser,
        profile: item.User.Profile ? { ...item.User.Profile, avatarUrl: publicImageUrl(item.User.Profile.avatarUrl), displayName: authorName } : item.User.Profile,
      },
      likes: viewerLikeIdByMessage.has(item.id) ? [{ id: viewerLikeIdByMessage.get(item.id)! }] : [],
      likers: item.DailyMessageLike.map((like) => ({
        uid: like.User.uid,
        nickname: getPublicUserDisplayName(like.User),
        displayName: resolveFriendDisplayName({
          viewerId,
          targetUserId: like.userId,
          fallbackName: getPublicUserDisplayName(like.User),
          remarkMap,
        }),
        avatarUrl: publicImageUrl(like.User.Profile?.avatarUrl || like.User.avatarUrl || null),
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
          profile: comment.User.Profile ? {
            ...comment.User.Profile,
            avatarUrl: publicImageUrl(comment.User.Profile.avatarUrl),
            displayName: resolveFriendDisplayName({
              viewerId,
              targetUserId: comment.User.id,
              fallbackName: getPublicUserDisplayName(comment.User),
              remarkMap,
            }),
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

export type CheckInReplyStatus = 'visible' | 'deleted' | 'unavailable'

export async function getCheckInReplyStatus({ messageId, commentId }: { messageId: string; commentId: string }): Promise<CheckInReplyStatus> {
  const comment = await prisma.dailyMessageComment.findUnique({
    where: { id: commentId },
    select: {
      messageId: true,
      isDeleted: true,
      DailyMessage: { select: { isDeleted: true, moderationStatus: true } },
    },
  })

  if (!comment || comment.messageId !== messageId || comment.DailyMessage.isDeleted || !['APPROVED', 'VIOLATION'].includes(comment.DailyMessage.moderationStatus)) {
    return 'unavailable'
  }
  return comment.isDeleted ? 'deleted' : 'visible'
}
