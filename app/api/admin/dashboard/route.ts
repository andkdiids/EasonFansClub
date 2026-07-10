import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireAdmin } from '@/lib/security'

export async function GET() {
  const guard = await requireAdmin('stats_view')
  if (!guard.user) return guard.response

  const today = new Date()
  today.setHours(0, 0, 0, 0)

  const [
    users,
    onlineUsers,
    todayUsers,
    posts,
    todayPosts,
    replies,
    todayReplies,
    todayCheckIns,
    hotPosts,
    hotBoards,
    activeUsers,
  ] = await Promise.all([
    prisma.user.count({ where: { isDeleted: false } }),
    prisma.user.count({ where: { isOnline: true, isDeleted: false } }),
    prisma.user.count({ where: { createdAt: { gte: today }, isDeleted: false } }),
    prisma.post.count({ where: { isDeleted: false } }),
    prisma.post.count({ where: { createdAt: { gte: today }, isDeleted: false } }),
    prisma.reply.count({ where: { isDeleted: false } }),
    prisma.reply.count({ where: { createdAt: { gte: today }, isDeleted: false } }),
    prisma.checkIn.count({ where: { createdAt: { gte: today } } }),
    prisma.post.findMany({
      where: { isDeleted: false },
      orderBy: [{ viewCount: 'desc' }, { likeCount: 'desc' }, { replyCount: 'desc' }],
      take: 8,
      select: { id: true, title: true, viewCount: true, likeCount: true, replyCount: true },
    }),
    prisma.board.findMany({
      where: { isActive: true },
      orderBy: [{ postCount: 'desc' }, { followerCount: 'desc' }],
      take: 8,
    }),
    prisma.user.findMany({
      where: { isDeleted: false },
      orderBy: [{ points: 'desc' }, { exp: 'desc' }],
      take: 8,
      select: { id: true, nickname: true, points: true, level: true, exp: true },
    }),
  ])

  return NextResponse.json({
    stats: {
      users,
      onlineUsers,
      todayUsers,
      posts,
      todayPosts,
      replies,
      todayReplies,
      todayCheckIns,
    },
    hotPosts,
    hotBoards,
    activeUsers,
  })
}
