import type { Prisma } from '@prisma/client'
import type { FollowEdge } from '@/lib/follow-migration'

export async function insertMissingFollowEdges(tx: Prisma.TransactionClient, edges: ReadonlyArray<FollowEdge>) {
  if (!edges.length) return 0
  const result = await tx.follow.createMany({
    data: edges.map((edge) => ({ followerId: edge.followerId, followingId: edge.followingId })),
    skipDuplicates: true,
  })
  return result.count
}

export async function ensureMutualFollowInTransaction(tx: Prisma.TransactionClient, leftUserId: string, rightUserId: string) {
  if (!leftUserId || !rightUserId || leftUserId === rightUserId) throw new Error('Cannot create a self-follow relationship')
  const edges: FollowEdge[] = [
    { followerId: leftUserId, followingId: rightUserId },
    { followerId: rightUserId, followingId: leftUserId },
  ]
  await insertMissingFollowEdges(tx, edges)
}
