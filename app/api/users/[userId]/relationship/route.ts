import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireRequestUser } from '@/lib/security'
import { normalizeFriendPair } from '@/lib/friends'

type RouteContext = { params: Promise<{ userId: string }> }

const privateHeaders = {
  'Cache-Control': 'private, no-store, max-age=0',
  Vary: 'Cookie, Authorization',
}

export async function GET(request: Request, context: RouteContext) {
  const guard = await requireRequestUser(request)
  if (!guard.user) return guard.response

  const { userId } = await context.params
  const target = await prisma.user.findFirst({
    where: { id: userId, status: 'ACTIVE', isDeleted: false, Profile: { isNot: null } },
    select: { id: true },
  })
  if (!target) return NextResponse.json({ message: '用户不存在或不可见' }, { status: 404, headers: privateHeaders })

  const [viewerFollowsTarget, targetFollowsViewer, blocked, followers, following, friendship] = await Promise.all([
    prisma.follow.findUnique({ where: { followerId_followingId: { followerId: guard.user.id, followingId: target.id } }, select: { id: true } }),
    prisma.follow.findUnique({ where: { followerId_followingId: { followerId: target.id, followingId: guard.user.id } }, select: { id: true } }),
    prisma.block.findFirst({ where: { OR: [{ blockerId: guard.user.id, blockedId: target.id }, { blockerId: target.id, blockedId: guard.user.id }] }, select: { id: true } }),
    prisma.follow.count({ where: { followingId: target.id } }),
    prisma.follow.count({ where: { followerId: target.id } }),
    (() => {
      const [userAId, userBId] = normalizeFriendPair(guard.user.id, target.id)
      return prisma.friendship.findUnique({ where: { userAId_userBId: { userAId, userBId } }, select: { id: true } })
    })(),
  ])

  const isBlocked = Boolean(blocked)
  const follows = Boolean(viewerFollowsTarget)
  const followedBy = Boolean(targetFollowsViewer)
  const state = guard.user.id === target.id
    ? 'SELF'
    : isBlocked ? 'BLOCKED'
      : follows && followedBy ? 'MUTUAL'
        : follows ? 'FOLLOWING'
          : followedBy ? 'FOLLOWED_BY' : 'NONE'

  return NextResponse.json({
    relationship: {
      state,
      viewerFollowsTarget: follows,
      targetFollowsViewer: followedBy,
      blocked: isBlocked,
      canMessage: !isBlocked && Boolean(friendship),
    },
    counts: { followers, following },
  }, { headers: privateHeaders })
}
