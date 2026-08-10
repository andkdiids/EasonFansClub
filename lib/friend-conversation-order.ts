export type FriendConversationOrderInput = {
  latestMessageAt: Date | null
  fallbackAt: Date
  stableId: string
}

/**
 * Sort a friend/conversation row the same way the server does.
 *
 * A real, non-deleted message always wins over a friend with no messages.
 * For rows whose conversation has no visible messages, keep the existing
 * friendship/conversation creation order as a stable fallback.  Unread state
 * is deliberately not part of this comparator: opening a conversation must
 * never change its position.
 */
export function compareFriendConversationOrder(
  left: FriendConversationOrderInput,
  right: FriendConversationOrderInput,
) {
  const leftMessageTime = left.latestMessageAt?.getTime() || 0
  const rightMessageTime = right.latestMessageAt?.getTime() || 0
  if (leftMessageTime !== rightMessageTime) return rightMessageTime - leftMessageTime

  if (leftMessageTime === 0) {
    const fallbackDifference = right.fallbackAt.getTime() - left.fallbackAt.getTime()
    if (fallbackDifference !== 0) return fallbackDifference
  }

  return right.stableId.localeCompare(left.stableId)
}
