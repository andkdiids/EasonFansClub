import { prisma } from '@/lib/prisma'

export type CheckInMessageSort = 'latest' | 'hot'

type CheckInMessagesResult = Awaited<ReturnType<typeof getCheckInMessagesUncached>>
export type CheckInMessageItem = CheckInMessagesResult[number]

export type AnonymousCheckInMessageItem = {
  id: string
  date: string
  mood: string | null
  content: string
  isPinned: boolean
  isFeatured: boolean
  likeCount: number
  favoriteCount: number
  commentCount: number
  createdAt: string
  liked: boolean
  favorited: boolean
  canDelete: boolean
  author: { type: 'anonymous'; name: '匿名E友' }
  comments: Array<{
    id: string
    parentId: string | null
    content: string
    createdAt: string
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
    content: item.content,
    isPinned: item.isPinned,
    isFeatured: item.isFeatured,
    likeCount: item.likeCount,
    favoriteCount: item.favoriteCount,
    commentCount: item.commentCount,
    createdAt: item.createdAt,
    liked: item.likes.length > 0,
    favorited: item.favorites.length > 0,
    canDelete: item.canDelete,
    author: { type: 'anonymous', name: '匿名E友' },
    comments: item.comments.map((comment) => ({
      id: comment.id,
      parentId: comment.parentId,
      content: comment.content,
      createdAt: comment.createdAt,
      canDelete: comment.canDelete,
      author: { type: 'anonymous', name: '匿名E友' },
    })),
  }))
}

const checkInMessagesCacheTtlMs = Number(process.env.CHECKIN_MESSAGES_CACHE_TTL_MS || 10000)
const checkInMessagesCache = new Map<string, { expiresAt: number; promise: Promise<CheckInMessagesResult> }>()

export async function getCheckInMessages({
  selectedDate,
  nextDate,
  sort,
  viewerId,
  viewerCanModerate = false,
  userIds,
}: {
  selectedDate: Date
  nextDate: Date
  sort: CheckInMessageSort
  viewerId: string
  viewerCanModerate?: boolean
  userIds?: string[]
}): Promise<CheckInMessagesResult> {
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
  ].join(':')
  const now = Date.now()
  const cached = checkInMessagesCache.get(cacheKey)
  if (cached && cached.expiresAt > now) return cached.promise

  const promise = getCheckInMessagesUncached({ selectedDate, nextDate, sort, viewerId, viewerCanModerate, userIds }).catch((error) => {
    checkInMessagesCache.delete(cacheKey)
    throw error
  })
  checkInMessagesCache.set(cacheKey, { expiresAt: now + checkInMessagesCacheTtlMs, promise })
  return promise
}

async function getCheckInMessagesUncached({
  selectedDate,
  nextDate,
  sort,
  viewerId,
  viewerCanModerate,
  userIds,
}: {
  selectedDate: Date
  nextDate: Date
  sort: CheckInMessageSort
  viewerId: string
  viewerCanModerate: boolean
  userIds?: string[]
}) {
  if (userIds && userIds.length === 0) return []

  const rows = await prisma.dailyMessage.findMany({
    where: {
      date: { gte: selectedDate, lt: nextDate },
      isDeleted: false,
      moderationStatus: 'APPROVED',
      ...(userIds ? { userId: { in: userIds } } : {}),
      User: { status: 'ACTIVE', isDeleted: false, Profile: { isNot: null } },
    },
    orderBy: sort === 'hot'
      ? [{ isAdminMessage: 'desc' }, { sort: 'asc' }, { isPinned: 'desc' }, { isFeatured: 'desc' }, { likeCount: 'desc' }, { commentCount: 'desc' }, { createdAt: 'desc' }]
      : [{ isAdminMessage: 'desc' }, { sort: 'asc' }, { isPinned: 'desc' }, { isFeatured: 'desc' }, { createdAt: 'desc' }],
    take: 30,
    include: {
      User: {
        select: {
          uid: true,
          nickname: true,
          avatarUrl: true,
          level: true,
          Profile: { select: { displayName: true, avatarUrl: true } },
        },
      },
      DailyMessageLike: { where: { userId: viewerId }, select: { id: true } },
      DailyMessageFavorite: { where: { userId: viewerId }, select: { id: true } },
      DailyMessageComment: {
        where: { isDeleted: false },
        orderBy: { createdAt: 'asc' },
        take: 50,
        include: {
          User: {
            select: {
              id: true,
              uid: true,
              nickname: true,
              avatarUrl: true,
              level: true,
              Profile: { select: { displayName: true, avatarUrl: true } },
            },
          },
        },
      },
    },
  })

  return rows.map((item) => ({
    ...item,
    author: {
      ...item.User,
      profile: item.User.Profile,
    },
    likes: item.DailyMessageLike,
    favorites: item.DailyMessageFavorite,
    canDelete: viewerCanModerate || item.userId === viewerId,
    date: item.date.toISOString(),
    createdAt: item.createdAt.toISOString(),
    updatedAt: item.updatedAt.toISOString(),
    deletedAt: item.deletedAt?.toISOString() || null,
    comments: item.DailyMessageComment.map((comment) => ({
      ...comment,
      author: {
        ...comment.User,
        profile: comment.User.Profile,
      },
      canDelete: viewerCanModerate || comment.User.id === viewerId,
      createdAt: comment.createdAt.toISOString(),
      updatedAt: comment.updatedAt.toISOString(),
      deletedAt: comment.deletedAt?.toISOString() || null,
    })),
  }))
}
