import { prisma } from '@/lib/prisma'

export type CheckInMessageSort = 'latest' | 'hot'

export type CheckInMessageItem = Awaited<ReturnType<typeof getCheckInMessages>>[number]

export async function getCheckInMessages({
  selectedDate,
  nextDate,
  sort,
  viewerId,
}: {
  selectedDate: Date
  nextDate: Date
  sort: CheckInMessageSort
  viewerId: string
}) {
  const rows = await prisma.dailyMessage.findMany({
    where: {
      date: { gte: selectedDate, lt: nextDate },
      isDeleted: false,
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
        where: { isDeleted: false, parentId: null },
        orderBy: { createdAt: 'desc' },
        take: 3,
        include: {
          author: {
            select: {
              id: true,
              uid: true,
              nickname: true,
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
