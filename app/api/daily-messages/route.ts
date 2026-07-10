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

  const [messages, total] = await Promise.all([
    prisma.dailyMessage.findMany({
      where: {
        date: { gte: date, lt: nextDate },
        isDeleted: false,
      },
      orderBy: sort === 'hot'
        ? [{ isPinned: 'desc' }, { isFeatured: 'desc' }, { likeCount: 'desc' }, { commentCount: 'desc' }, { createdAt: 'desc' }]
        : [{ isPinned: 'desc' }, { isFeatured: 'desc' }, { createdAt: 'desc' }],
      skip: (page - 1) * take,
      take,
      include: {
        user: { select: { id: true, nickname: true, avatarUrl: true, level: true } },
        comments: {
          where: { isDeleted: false, parentId: null },
          orderBy: { createdAt: 'desc' },
          take: 3,
          include: { author: { select: { id: true, nickname: true, level: true } } },
        },
      },
    }),
    prisma.dailyMessage.count({
      where: {
        date: { gte: date, lt: nextDate },
        isDeleted: false,
      },
    }),
  ])

  return NextResponse.json({ messages, total, page, hasMore: page * take < total })
}
