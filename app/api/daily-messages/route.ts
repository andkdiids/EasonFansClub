import { NextResponse } from 'next/server'
import { startOfLocalDay, startOfYesterday } from '@/lib/checkin'
import { prisma } from '@/lib/prisma'

export async function GET(request: Request) {
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
        user: { status: 'ACTIVE', isDeleted: false, profile: { isNot: null } },
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
        user: {
          select: {
            id: true,
            uid: true,
            nickname: true,
            avatarUrl: true,
            level: true,
            profile: { select: { displayName: true, avatarUrl: true } },
          },
        },
        comments: {
          where: { isDeleted: false, parentId: null },
          orderBy: { createdAt: 'desc' },
          take: 3,
          select: {
            id: true,
            content: true,
            createdAt: true,
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

    const hasMore = rows.length > take
    const messages = hasMore ? rows.slice(0, take) : rows
    const total = skip + messages.length + (hasMore ? 1 : 0)

    return NextResponse.json(
      { messages, total, page, hasMore },
      { headers: { 'Cache-Control': 'public, max-age=10, s-maxage=30, stale-while-revalidate=90' } },
    )
  } catch (error) {
    console.error('[daily-messages:list:error]', { day, sort, page, error })
    return NextResponse.json(
      { message: '留言暂时无法加载，请稍后重试', messages: [], total: 0, page, hasMore: false },
      { status: 503 },
    )
  }
}
