export const UNGROUPED_FRIEND_GROUP_ID = '__ungrouped__'

export type FriendGroupMembershipLike = {
  friendId: string
  groupId: string
}

/**
 * Build the client-visible group index from the current, valid friendships.
 * Membership rows for deleted/non-friend users are deliberately ignored so
 * group counts and scoped friend lists use the same population.
 */
export function buildFriendGroupIndex(
  friendIds: Iterable<string>,
  memberships: Iterable<FriendGroupMembershipLike>,
) {
  const uniqueFriendIds = new Set(friendIds)
  const groupByFriend = new Map<string, string>()

  for (const membership of memberships) {
    if (!uniqueFriendIds.has(membership.friendId) || groupByFriend.has(membership.friendId)) continue
    groupByFriend.set(membership.friendId, membership.groupId)
  }

  const groupCounts = new Map<string, number>()
  for (const groupId of groupByFriend.values()) {
    groupCounts.set(groupId, (groupCounts.get(groupId) || 0) + 1)
  }

  return {
    friendIds: [...uniqueFriendIds],
    groupByFriend,
    groupCounts,
    ungroupedCount: Math.max(0, uniqueFriendIds.size - groupByFriend.size),
  }
}

export function belongsToFriendGroup(friendId: string, groupId: string, groupByFriend: ReadonlyMap<string, string>) {
  return groupId === UNGROUPED_FRIEND_GROUP_ID
    ? !groupByFriend.has(friendId)
    : groupByFriend.get(friendId) === groupId
}

/** Merge a paged response by stable user id, never by display name or index. */
export function mergeUniqueFriendPage<T extends { id: string }>(current: T[], incoming: T[], append: boolean) {
  const next: T[] = append ? [...current] : []
  const indexById = new Map(next.map((item, index) => [item.id, index]))

  incoming.forEach((item) => {
    const existingIndex = indexById.get(item.id)
    if (existingIndex === undefined) {
      indexById.set(item.id, next.length)
      next.push(item)
    } else {
      next[existingIndex] = item
    }
  })

  return next
}
