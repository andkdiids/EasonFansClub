/**
 * Client-safe fallback for public user labels.
 *
 * `username` is an account/login field and must never be used as a public
 * display fallback. Server-side callers that also need moderation handling
 * should use getPublicUserDisplayName from lib/friend-remarks instead.
 */
export const PUBLIC_USER_FALLBACK_NAME = 'E院用户'

export function getPublicUserDisplayNameFromNickname(
  nickname: string | null | undefined,
  fallback = PUBLIC_USER_FALLBACK_NAME,
) {
  return nickname?.trim() || fallback
}
