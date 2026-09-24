import { NextResponse } from 'next/server'
import { activeUserWhere } from '@/lib/friends'
import { getFollowListBadges, findActiveFollowTarget, followUserSelect, parseFollowPagination, privateFollowHeaders, serializeFollowUser } from '@/lib/follow-service'
import { prisma } from '@/lib/prisma'
import { resolveRelationships } from '@/lib/relationship-resolver'
import { enforceApiRateLimit, requireRequestUser } from '@/lib/security'

type RouteContext = { params: Promise<{ userId: string }> }

export async function GET(request: Request, context: RouteContext) {
  const guard = await requireRequestUser(request)
  if (!guard.user) return guard.response

  const { userId } = await context.params
  const target = await findActiveFollowTarget(userId)
  if (!target) return NextResponse.json({ message: '用户不存在' }, { status: 404, headers: privateFollowHeaders })

  const limited = await enforceApiRateLimit(request, guard.user.id, {
    endpoint: '/api/users/:userId/following',
    ip: { limit: 120, windowSeconds: 60 },
    user: { limit: 60, windowSeconds: 60 },
  })
  if (limited) return limited

  const { page, pageSize, skip } = parseFollowPagination(request)
  const where = {
    followerId: target.id,
    User_Follow_followingIdToUser: activeUserWhere,
  }
  const [rows, total] = await Promise.all([
    prisma.follow.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      skip,
      take: pageSize,
      select: {
        createdAt: true,
        User_Follow_followingIdToUser: { select: followUserSelect },
      },
    }),
    prisma.follow.count({ where }),
  ])
  const users = rows.map((row) => row.User_Follow_followingIdToUser)
  const userIds = users.map((user) => user.id)
  const [relationships, badges] = await Promise.all([
    resolveRelationships(guard.user.id, userIds),
    getFollowListBadges(userIds, guard.user.id),
  ])
  const items = rows.map((row) => ({
    ...serializeFollowUser(
      row.User_Follow_followingIdToUser,
      relationships.get(row.User_Follow_followingIdToUser.id)!,
      badges.get(row.User_Follow_followingIdToUser.id) || [],
    ),
    followedAt: row.createdAt.toISOString(),
  }))
  const totalPages = Math.ceil(total / pageSize)

  return NextResponse.json({ users: items, items, page, pageSize, total, totalPages, hasMore: page < totalPages }, { headers: privateFollowHeaders })
}
