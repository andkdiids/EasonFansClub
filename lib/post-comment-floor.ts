import type { Prisma } from '@prisma/client'

export function readPersistedCommentFloor(value: unknown) {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : null
}

export function buildPostCommentFloorMap<T extends { id: string; parentId?: string | null; floorNumber?: number | null }>(replies: readonly T[]) {
  const map = new Map<string, number>()
  for (const reply of replies) {
    if (reply.parentId !== undefined && reply.parentId !== null) continue
    const floorNumber = readPersistedCommentFloor(reply.floorNumber)
    if (floorNumber !== null) map.set(reply.id, floorNumber)
  }
  return map
}

export async function allocatePostCommentFloor(
  tx: Pick<Prisma.TransactionClient, 'post'>,
  postId: string,
) {
  const post = await tx.post.update({
    where: { id: postId },
    data: { lastCommentFloor: { increment: 1 } },
    select: { lastCommentFloor: true },
  })
  const floorNumber = readPersistedCommentFloor(post.lastCommentFloor)
  if (floorNumber === null) throw new Error('POST_COMMENT_FLOOR_INVALID')
  return floorNumber
}
