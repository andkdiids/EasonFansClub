import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { sanitizeText } from '@/lib/security'

export async function GET(request: Request) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ message: '请先登录' }, { status: 401 })
  const params = new URL(request.url).searchParams
  const q = sanitizeText(params.get('q'), 50)
  const page = Math.max(1, Number(params.get('page')) || 1)
  const pageSize = Math.min(15, Math.max(5, Number(params.get('pageSize')) || 10))

  const rows = await prisma.friendship.findMany({
    where: {
      OR: [
        { userAId: user.id, User_Friendship_userBIdToUser: { status: 'ACTIVE', isDeleted: false, ...(q ? { OR: [{ nickname: { contains: q } }, { Profile: { displayName: { contains: q } } }] } : {}) } },
        { userBId: user.id, User_Friendship_userAIdToUser: { status: 'ACTIVE', isDeleted: false, ...(q ? { OR: [{ nickname: { contains: q } }, { Profile: { displayName: { contains: q } } }] } : {}) } },
      ],
    },
    orderBy: { createdAt: 'desc' },
    skip: (page - 1) * pageSize,
    take: pageSize + 1,
    include: {
      User_Friendship_userAIdToUser: { select: { id: true, uid: true, nickname: true, avatarUrl: true, level: true, isOnline: true, Profile: { select: { displayName: true, avatarUrl: true } } } },
      User_Friendship_userBIdToUser: { select: { id: true, uid: true, nickname: true, avatarUrl: true, level: true, isOnline: true, Profile: { select: { displayName: true, avatarUrl: true } } } },
    },
  })
  const hasMore = rows.length > pageSize
  return NextResponse.json({
    friends: rows.slice(0, pageSize).map((row) => {
      const friend = row.userAId === user.id ? row.User_Friendship_userBIdToUser : row.User_Friendship_userAIdToUser
      return { ...friend, profile: friend.Profile }
    }),
    page,
    hasMore,
  })
}
