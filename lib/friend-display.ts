/**
 * Browser-safe user display-name helpers.
 *
 * These are pure functions over plain objects — no Prisma, no Node built-ins.
 * They are split out of `lib/friend-remarks` because that module also owns
 * `loadFriendRemarkMap`, a database lookup. Importing the display helpers from
 * `lib/friend-remarks` pulled Prisma (and, transitively, `node:crypto` via
 * friends -> notifications -> badge-service) into the client bundle.
 *
 * Client code must import from here; server code may use either module.
 */
import { getFriendDisplayName, normalizeFriendRemark } from '@/lib/friend-display-name'
import { PUBLIC_USER_FALLBACK_NAME, VIOLATION_USER_TEXT } from '@/lib/public-user-name'

export { getFriendDisplayName, normalizeFriendRemark }

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
  return getFriendDisplayName({
    nickname: fallbackName,
    friendRemark: targetUserId ? remarkMap?.get(targetUserId) : null,
    isFriendContext: context !== 'profile' && Boolean(viewerId && targetUserId),
  })
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
