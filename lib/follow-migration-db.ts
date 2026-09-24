import type { PrismaClient } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import type { LegacyBlockRow, LegacyFriendshipRow, LegacyUserState, FollowEdge } from '@/lib/follow-migration'

export type FollowBackfillSnapshot = Readonly<{
  friendships: ReadonlyArray<LegacyFriendshipRow>
  follows: ReadonlyArray<FollowEdge>
  blocks: ReadonlyArray<LegacyBlockRow>
  users: ReadonlyArray<LegacyUserState>
  pendingFriendRequests: number
}>

type FollowMigrationDatabase = Pick<PrismaClient, 'friendship' | 'follow' | 'block' | 'friendRequest' | 'user'>

export async function loadFollowBackfillSnapshot(db: FollowMigrationDatabase = prisma): Promise<FollowBackfillSnapshot> {
  const [friendships, follows, blocks, pendingFriendRequests] = await Promise.all([
    db.friendship.findMany({ select: { userAId: true, userBId: true } }),
    db.follow.findMany({ select: { followerId: true, followingId: true } }),
    db.block.findMany({ select: { blockerId: true, blockedId: true } }),
    db.friendRequest.count({ where: { status: 'PENDING' } }),
  ])

  const relatedUserIds = [...new Set(friendships.flatMap((row) => [row.userAId, row.userBId]))]
  const users = relatedUserIds.length
    ? await db.user.findMany({
        where: { id: { in: relatedUserIds } },
        select: { id: true, status: true, isDeleted: true, Profile: { select: { id: true } } },
      })
    : []

  return {
    friendships,
    follows,
    blocks,
    users: users.map((user) => ({
      id: user.id,
      status: user.status,
      isDeleted: user.isDeleted,
      hasProfile: Boolean(user.Profile),
    })),
    pendingFriendRequests,
  }
}
