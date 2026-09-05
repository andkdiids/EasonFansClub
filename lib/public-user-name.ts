/**
 * Client-safe fallback for public user labels.
 *
 * `username` is an account/login field and must never be used as a public
 * display fallback. Server-side callers that also need moderation handling
 * should use getPublicUserDisplayName from lib/friend-display instead.
 */
export const PUBLIC_USER_FALLBACK_NAME = 'E院用户'

/**
 * Public label shown when a nickname was moderated as violating. The real
 * (violating) nickname must never be sent to the client in that case.
 *
 * Lives here so client-safe display code can use it without importing
 * `lib/content-moderation`, which owns Prisma queries (server-only).
 */
export const VIOLATION_USER_TEXT = '违规用户'

export function getPublicUserDisplayNameFromNickname(
  nickname: string | null | undefined,
  fallback = PUBLIC_USER_FALLBACK_NAME,
) {
  return nickname?.trim() || fallback
}
