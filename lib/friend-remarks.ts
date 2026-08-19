import { prisma } from '@/lib/prisma'
import { activeUserWhere } from '@/lib/friends'
import { VIOLATION_USER_TEXT } from '@/lib/content-moderation'

export type FriendRemarkMap = ReadonlyMap<string, string>

type PublicNameUser = {
  nickname?: string | null
  username?: string | null
  usernameModerationStatus?: string | null
  nicknameModerationStatus?: string | null
  nicknameViolationDisplay?: string | null
  Profile?: { displayName?: string | null; displayNameModerationStatus?: string | null } | null
}

type SerializedNameUser = {
  nickname?: string | null
  username?: string | null
  usernameModerationStatus?: string | null
  nicknameModerationStatus?: string | null
  nicknameViolationDisplay?: string | null
  profile?: { displayName?: string | null; displayNameModerationStatus?: string | null } | null
}

/**
 * 统一展示昵称（需求 七：所有展示接口均经此函数读取「生效展示昵称」）。
 *
 *  - 昵称违规（nicknameModerationStatus === 'VIOLATION'）：返回生成的唯一展示昵称
 *    nicknameViolationDisplay（如「违规昵称A82KD92L」），不再统一显示「违规用户」。
 *    若展示昵称缺失（异常兜底）才退回「违规用户」。
 *  - 用户名 / 个人主页展示名违规：沿用原「违规用户」遮罩。
 *  - 正常：优先 Profile.displayName，其次 nickname，最后「已注销用户」。
 */
export function getPublicUserDisplayName(user: PublicNameUser | SerializedNameUser) {
  const profile = 'Profile' in user ? user.Profile : 'profile' in user ? user.profile : null

  if (user.nicknameModerationStatus === 'VIOLATION') {
    const display = user.nicknameViolationDisplay?.trim()
    if (display) return display
  }

  if (
    user.usernameModerationStatus === 'VIOLATION' ||
    profile?.displayNameModerationStatus === 'VIOLATION'
  ) return VIOLATION_USER_TEXT

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
  if (fallbackName === '违规用户') return fallbackName
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
