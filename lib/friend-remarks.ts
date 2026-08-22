import { prisma } from '@/lib/prisma'
import { activeUserWhere } from '@/lib/friends'
import { VIOLATION_USER_TEXT } from '@/lib/content-moderation'
import { PUBLIC_USER_FALLBACK_NAME } from '@/lib/public-user-name'

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
 *    nicknameViolationDisplay（如「违规昵称A82KD92L」）；若展示昵称缺失（历史遗留 /
 *    异常兜底）则遮罩为「违规用户」，绝不下发真实（违规）昵称。
 *  - 正常：只使用 nickname；历史异常数据统一使用公共匿名占位，不回退到旧展示字段。
 *
 * 重要：username 是登录句柄而非展示名。usernameModerationStatus=VIOLATION 只影响
 * username 字段本身（经 publicModerationUserName 独立遮罩），**绝不**影响昵称展示——
 * 否则用户改回合法昵称后仍会因残留的 username 标记被遮罩为「违规用户」（问题根因）。
 * Profile.displayNameModerationStatus 是昵称违规的旧版镜像标记，同样不参与判定。
 */
export function getPublicUserDisplayName(user: PublicNameUser | SerializedNameUser) {
  if (user.nicknameModerationStatus === 'VIOLATION') {
    const display = user.nicknameViolationDisplay?.trim()
    if (display) return display
    return VIOLATION_USER_TEXT
  }

  return user.nickname?.trim() || PUBLIC_USER_FALLBACK_NAME
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
