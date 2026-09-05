/**
 * Browser-safe notification identity keys.
 *
 * These are pure string builders with no database, crypto or Node dependency.
 * They deliberately live outside `lib/notifications`, because that module owns
 * Prisma queries and badge lookups (server-only). A runtime import of the keys
 * from `lib/notifications` would drag the whole server graph into the browser
 * bundle through:
 *
 *   notifications -> badge-service -> node:crypto
 *
 * Keeping them here lets `lib/friends.ts` (server-only) use the same helpers
 * without making `lib/notifications` reachable from client code.
 */
export const FRIEND_REQUEST_NOTIFICATION_KEY_PREFIX = 'friend-request:'
export const FRIEND_REQUEST_ACCEPTED_NOTIFICATION_KEY_PREFIX = 'friend-request-accepted:'

export function getFriendRequestNotificationKey(requestId: string) {
  return `${FRIEND_REQUEST_NOTIFICATION_KEY_PREFIX}${requestId}`
}

export function getFriendRequestAcceptedNotificationKey(requestId: string) {
  return `${FRIEND_REQUEST_ACCEPTED_NOTIFICATION_KEY_PREFIX}${requestId}`
}
