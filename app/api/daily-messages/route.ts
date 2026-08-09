import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import { startOfLocalDay, startOfYesterday } from '@/lib/checkin'
import { getPublicUserDisplayName, loadFriendRemarkMap, resolveFriendDisplayName } from '@/lib/friend-remarks'
import { prisma } from '@/lib/prisma'

export async function GET(request: Request) {
  const viewer = await getCurrentUser()
  const { searchParams } = new URL(request.url)
  const day = searchParams.get('day') === 'yesterday' ? 'yesterday' : 'today'
  const sort = searchParams.get('sort') === 'hot' ? 'hot' : 'latest'
  const page = Math.max(Number(searchParams.get('page') || 1), 1)
  const take = Math.min(Number(searchParams.get('take') || 20), 50)
  const date = day === 'yesterday' ? startOfYesterday() : startOfLocalDay()
  const nextDate = new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1)
  const skip = (page - 1) * take

  try {
    const rows = await prisma.dailyMessage.findMany({
      where: {
        date: { gte: date, lt: nextDate },
        isDeleted: false,
        User: { status: 'ACTIVE', isDeleted: false, Profile: { isNot: null } },
      },
      orderBy: sort === 'hot'
        ? [{ isPinned: 'desc' }, { isFeatured: 'desc' }, { likeCount: 'desc' }, { commentCount: 'desc' }, { createdAt: 'desc' }]
        : [{ isPinned: 'desc' }, { isFeatured: 'desc' }, { createdAt: 'desc' }],
      skip,
      take: take + 1,
      select: {
        id: true,
        date: true,
        mood: true,
        content: true,
        likeCount: true,
        favoriteCount: true,
        commentCount: true,
        isPinned: true,
        isFeatured: true,
        createdAt: true,
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
        DailyMessageComment: {
          where: { isDeleted: false, parentId: null },
          orderBy: { createdAt: 'desc' },
          take: 3,
          select: {
            id: true,
            content: true,
            createdAt: true,
            User: {
              select: {
                id: true,
                uid: true,
                nickname: true,
                level: true,
                Profile: { select: { displayName: true, avatarUrl: true } },
              },
            },
          },
        },
      },
    })

    const hasMore = rows.length > take
    const visibleRows = hasMore ? rows.slice(0, take) : rows
    const displayNameUserIds = [
      ...visibleRows.map((row) => row.User.id),
      ...visibleRows.flatMap((row) => row.DailyMessageComment.map((comment) => comment.User.id)),
    ]
    const remarkMap = await loadFriendRemarkMap(viewer?.id, displayNameUserIds)
    const messages = visibleRows.map(({ User, DailyMessageComment, ...message }) => ({
      ...message,
      user: {
        ...User,
        profile: User.Profile ? {
          ...User.Profile,
          displayName: resolveFriendDisplayName({
            viewerId: viewer?.id,
            targetUserId: User.id,
            fallbackName: getPublicUserDisplayName(User),
            remarkMap,
          }),
        } : User.Profile,
      },
      comments: DailyMessageComment.map(({ User: commentUser, ...comment }) => ({
        ...comment,
        user: {
          ...commentUser,
          profile: commentUser.Profile ? {
            ...commentUser.Profile,
            displayName: resolveFriendDisplayName({
              viewerId: viewer?.id,
              targetUserId: commentUser.id,
              fallbackName: getPublicUserDisplayName(commentUser),
              remarkMap,
            }),
          } : commentUser.Profile,
        },
      })),
    }))
    const total = skip + messages.length + (hasMore ? 1 : 0)

    return NextResponse.json(
      { messages, total, page, hasMore },
      { headers: viewer
        ? { 'Cache-Control': 'private, no-store, max-age=0', Vary: 'Cookie' }
        : { 'Cache-Control': 'public, max-age=10, s-maxage=30, stale-while-revalidate=90', Vary: 'Cookie' } },
    )
  } catch (error) {
    console.error('[daily-messages:list:error]', { day, sort, page, error })
    return NextResponse.json(
      { message: '留言暂时无法加载，请稍后重试', messages: [], total: 0, page, hasMore: false },
      { status: 503 },
    )
  }
}
