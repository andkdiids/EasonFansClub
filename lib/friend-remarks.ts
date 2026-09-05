/**
 * Server-only friend remark loading.
 *
 * The pure display-name helpers now live in `lib/friend-display` (browser-safe)
 * and are re-exported here so existing server importers keep working unchanged.
 *
 * Client components must import display helpers from '@/lib/friend-display'
 * instead of this module: importing from here pulls Prisma into the browser
 * bundle and, transitively through friends -> notifications -> badge-service,
 * `node:crypto` as well.
 */
import { prisma } from '@/lib/prisma'
import { activeUserWhere } from '@/lib/friends'
import { normalizeFriendRemark } from '@/lib/friend-display-name'

export * from '@/lib/friend-display'

export async function loadFriendRemarkMap(viewerId: string | null | undefined, targetUserIds: Iterable<string>) {
  const ids = [...new Set([...targetUserIds].filter((id) => Boolean(id) && id !== viewerId))]
  const result = new Map<string, string>()
  if (!viewerId || !ids.length) return result

  const [friendships, blocks, remarks] = await Promise.all([
    prisma.friendship.findMany({
      where: {
        OR: [
          { userAId: viewerId, userBId: { in: ids }, User_Friendship_userBIdToUser: activeUserWhere },
          { userBId: viewerId, userAId: { in: ids }, User_Friendship_userAIdToUser: activeUserWhere },
        ],
      },
      select: { userAId: true, userBId: true },
    }),
    prisma.block.findMany({
      where: {
        OR: [
          { blockerId: viewerId, blockedId: { in: ids } },
          { blockedId: viewerId, blockerId: { in: ids } },
        ],
      },
      select: { blockerId: true, blockedId: true },
    }),
    prisma.friendRemark.findMany({
      where: { ownerId: viewerId, friendId: { in: ids }, remark: { not: '' } },
      select: { friendId: true, remark: true },
    }),
  ])

  const friendIds = new Set(friendships.map((row) => row.userAId === viewerId ? row.userBId : row.userAId))
  const blockedIds = new Set(blocks.map((row) => row.blockerId === viewerId ? row.blockedId : row.blockerId))
  remarks.forEach((row) => {
    const remark = normalizeFriendRemark(row.remark)
    if (remark && friendIds.has(row.friendId) && !blockedIds.has(row.friendId)) result.set(row.friendId, remark)
  })
  return result
}
