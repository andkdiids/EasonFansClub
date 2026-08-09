import { prisma } from '@/lib/prisma'
import { activeUserWhere } from '@/lib/friends'

export type FriendRemarkMap = ReadonlyMap<string, string>

type PublicNameUser = {
  nickname?: string | null
  username?: string | null
  Profile?: { displayName?: string | null } | null
}

type SerializedNameUser = {
  nickname?: string | null
  username?: string | null
  profile?: { displayName?: string | null } | null
}

export function getPublicUserDisplayName(user: PublicNameUser | SerializedNameUser) {
  const profile = 'Profile' in user ? user.Profile : 'profile' in user ? user.profile : null
  return profile?.displayName?.trim() || user.nickname?.trim() || '已注销用户'
}

export function resolveFriendDisplayName({
  viewerId,
  targetUserId,
  fallbackName,
  remarkMap,
  context = 'default',
}: {
  viewerId?: string | null
  targetUserId?: string | null
  fallbackName: string
  remarkMap?: FriendRemarkMap
  context?: 'default' | 'profile'
}) {
  if (context === 'profile' || !viewerId || !targetUserId) return fallbackName
  return remarkMap?.get(targetUserId) || fallbackName
}

export function withPrismaDisplayName<T extends { Profile: { displayName: string | null } | null }>(user: T, displayName: string): T {
  return {
    ...user,
    Profile: user.Profile ? { ...user.Profile, displayName } : user.Profile,
  }
}

export function withSerializedDisplayName<T extends { profile: { displayName: string | null } | null }>(user: T, displayName: string): T {
  return {
    ...user,
    profile: user.profile ? { ...user.profile, displayName } : user.profile,
  }
}

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
    if (friendIds.has(row.friendId) && !blockedIds.has(row.friendId)) result.set(row.friendId, row.remark)
  })
  return result
}
