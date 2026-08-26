import { PUBLIC_USER_FALLBACK_NAME } from '@/lib/public-user-name'

export function normalizeFriendRemark(value: unknown) {
  if (typeof value !== 'string') return null
  const remark = value.trim()
  return remark || null
}

/**
 * Resolve a viewer-owned friend alias only for an explicitly private friend
 * context. `nickname` is always the public identity and must stay unchanged.
 */
export function getFriendDisplayName({
  nickname,
  friendRemark,
  isFriendContext,
}: {
  nickname?: string | null
  friendRemark?: string | null
  isFriendContext: boolean
}) {
  const publicName = nickname?.trim() || PUBLIC_USER_FALLBACK_NAME
  const remark = normalizeFriendRemark(friendRemark)
  return isFriendContext && remark ? remark : publicName
}
