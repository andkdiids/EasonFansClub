import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import { getFriendIds } from '@/lib/friends'
import { prisma } from '@/lib/prisma'

export async function GET() {
  const viewer = await getCurrentUser()
  if (!viewer) return NextResponse.json({ message: '请先登录' }, { status: 401 })

  const friendIds = await getFriendIds(viewer.id)
  if (!friendIds.length) return NextResponse.json({ activities: [] })

  const activities = await prisma.friendActivity.findMany({
    where: {
      actorId: { in: friendIds },
      actor: { status: 'ACTIVE', isDeleted: false, profile: { isNot: null } },
    },
    orderBy: { createdAt: 'desc' },
    take: 30,
    include: {
      actor: {
        select: {
          uid: true,
          nickname: true,
          avatarUrl: true,
          profile: { select: { displayName: true, avatarUrl: true } },
        },
      },
    },
  })

  return NextResponse.json({
    activities: activities.map((item) => ({
      id: item.id,
      mood: item.mood,
      content: item.content,
      createdAt: item.createdAt.toISOString(),
      actor: item.actor,
    })),
  })
}
