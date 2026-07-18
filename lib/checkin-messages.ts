import { prisma } from '@/lib/prisma'

export type CheckInMessageSort = 'latest' | 'hot'

type CheckInMessagesResult = Awaited<ReturnType<typeof getCheckInMessagesUncached>>
export type CheckInMessageItem = CheckInMessagesResult[number]

export function anonymizeCheckInMessages(messages: CheckInMessageItem[]): CheckInMessageItem[] {
  return messages.map((item) => ({
    ...item,
    user: { ...item.user, uid: 0, nickname: '匿名E友', avatarUrl: null, level: 0, profile: { displayName: '匿名E友', avatarUrl: null } },
    comments: item.comments.map((comment) => ({
      ...comment,
      author: { ...comment.author, uid: 0, nickname: '匿名E友', avatarUrl: null, level: 0, profile: { displayName: '匿名E友', avatarUrl: null } },
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
  userIds,
}: {
  selectedDate: Date
  nextDate: Date
  sort: CheckInMessageSort
  viewerId: string
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
    userScope,
  ].join(':')
  const now = Date.now()
  const cached = checkInMessagesCache.get(cacheKey)
  if (cached && cached.expiresAt > now) return cached.promise

  const promise = getCheckInMessagesUncached({ selectedDate, nextDate, sort, viewerId, userIds }).catch((error) => {
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
  userIds,
}: {
  selectedDate: Date
  nextDate: Date
  sort: CheckInMessageSort
  viewerId: string
  userIds?: string[]
}) {
  if (userIds && userIds.length === 0) return []

  const rows = await prisma.dailyMessage.findMany({
    where: {
      date: { gte: selectedDate, lt: nextDate },
      isDeleted: false,
      ...(userIds ? { userId: { in: userIds } } : {}),
      user: { status: 'ACTIVE', isDeleted: false, profile: { isNot: null } },
    },
    orderBy: sort === 'hot'
      ? [{ isPinned: 'desc' }, { isFeatured: 'desc' }, { likeCount: 'desc' }, { commentCount: 'desc' }, { createdAt: 'desc' }]
      : [{ isPinned: 'desc' }, { isFeatured: 'desc' }, { createdAt: 'desc' }],
    take: 30,
    include: {
      user: {
        select: {
          uid: true,
          nickname: true,
          avatarUrl: true,
          level: true,
          profile: { select: { displayName: true, avatarUrl: true } },
        },
      },
      likes: { where: { userId: viewerId }, select: { id: true } },
      favorites: { where: { userId: viewerId }, select: { id: true } },
      comments: {
        where: { isDeleted: false },
        orderBy: { createdAt: 'asc' },
        take: 50,
        include: {
          author: {
            select: {
              id: true,
              uid: true,
              nickname: true,
              avatarUrl: true,
              level: true,
              profile: { select: { displayName: true, avatarUrl: true } },
            },
          },
        },
      },
    },
  })

  return rows.map((item) => ({
    ...item,
    date: item.date.toISOString(),
    createdAt: item.createdAt.toISOString(),
    updatedAt: item.updatedAt.toISOString(),
    deletedAt: item.deletedAt?.toISOString() || null,
    comments: item.comments.map((comment) => ({
      ...comment,
      createdAt: comment.createdAt.toISOString(),
      updatedAt: comment.updatedAt.toISOString(),
      deletedAt: comment.deletedAt?.toISOString() || null,
    })),
  }))
}
