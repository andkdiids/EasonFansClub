import { NextResponse } from 'next/server'
import { normalizeFriendPair } from '@/lib/friends'
import { prisma } from '@/lib/prisma'
import { requireRequestUser } from '@/lib/security'

type RouteContext = { params: Promise<{ userId: string }> }
const PRIVATE_HEADERS = { 'Cache-Control': 'private, no-store, max-age=0', Vary: 'Cookie, Authorization' }

export async function GET(request: Request, context: RouteContext) {
  const guard = await requireRequestUser(request)
  if (!guard.user) return guard.response
  const { userId } = await context.params

  try {
    const target = await prisma.user.findFirst({
      where: { id: userId, status: 'ACTIVE', isDeleted: false, Profile: { isNot: null } },
      select: { id: true },
    })
    if (!target) return NextResponse.json({ message: '用户不存在或不可用' }, { status: 404, headers: PRIVATE_HEADERS })

    const viewerId = guard.user.id
    const [viewerFollowsTarget, targetFollowsViewer, blocked, counts, friendship] = await Promise.all([
      prisma.follow.findUnique({ where: { followerId_followingId: { followerId: viewerId, followingId: target.id } }, select: { id: true } }),
      prisma.follow.findUnique({ where: { followerId_followingId: { followerId: target.id, followingId: viewerId } }, select: { id: true } }),
      viewerId === target.id ? Promise.resolve(null) : prisma.block.findFirst({
        where: { OR: [{ blockerId: viewerId, blockedId: target.id }, { blockerId: target.id, blockedId: viewerId }] },
        select: { id: true },
      }),
      Promise.all([
        prisma.follow.count({ where: { followingId: target.id, User_Follow_followerIdToUser: { is: { status: 'ACTIVE', isDeleted: false } } } }),
        prisma.follow.count({ where: { followerId: target.id, User_Follow_followingIdToUser: { is: { status: 'ACTIVE', isDeleted: false } } } }),
      ]),
      viewerId === target.id ? Promise.resolve(null) : (() => {
        const [userAId, userBId] = normalizeFriendPair(viewerId, target.id)
        return prisma.friendship.findUnique({ where: { userAId_userBId: { userAId, userBId } }, select: { id: true } })
      })(),
    ])

    const isBlocked = Boolean(blocked)
    const follows = Boolean(viewerFollowsTarget)
    const followedBy = Boolean(targetFollowsViewer)
    const state = viewerId === target.id ? 'SELF'
      : isBlocked ? 'BLOCKED'
        : follows && followedBy ? 'MUTUAL'
          : follows ? 'FOLLOWING'
            : followedBy ? 'FOLLOWED_BY'
              : 'NONE'
    return NextResponse.json({
      relationship: {
        state,
        viewerFollowsTarget: follows,
        targetFollowsViewer: followedBy,
        blocked: isBlocked,
        canMessage: viewerId !== target.id && Boolean(friendship) && !isBlocked,
      },
      counts: isBlocked ? { followers: 0, following: 0 } : { followers: counts[0], following: counts[1] },
    }, { headers: PRIVATE_HEADERS })
  } catch (error) {
    console.error('[profile.relationship]', { viewerId: guard.user.id, targetId: userId, error })
    return NextResponse.json({ message: '关系信息暂时无法加载，请稍后重试' }, { status: 503, headers: PRIVATE_HEADERS })
  }
}
