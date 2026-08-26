import { CHECK_IN_MESSAGE_PAGE_SIZE } from '@/lib/checkin-pagination'

export type CheckInMessageOrderItem = {
  id: string
  createdAt: string
  author?: unknown
}

export function checkInMessageAuthorId(message: CheckInMessageOrderItem) {
  if (!message.author || typeof message.author !== 'object' || !('id' in message.author)) return null
  const id = (message.author as { id?: unknown }).id
  return typeof id === 'string' ? id : null
}

export function latestOwnCheckInMessage<T extends CheckInMessageOrderItem>(messages: T[], sessionUserId?: string) {
  if (!sessionUserId) return null
  return messages
    .filter((message) => checkInMessageAuthorId(message) === sessionUserId)
    .sort((left, right) => {
      const createdAtOrder = new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime()
      return createdAtOrder || right.id.localeCompare(left.id)
    })[0] || null
}

/**
 * The current user's one valid check-in message is a sticky item, not part of
 * the friend offset/take window. On later pages every own row is removed so it
 * can never be rendered twice after a page change or a realtime merge.
 */
export function normalizeFriendCheckInMessages<T extends CheckInMessageOrderItem>(messages: T[], page: number, sessionUserId?: string) {
  if (!sessionUserId) return messages
  const ownMessage = latestOwnCheckInMessage(messages, sessionUserId)
  const friendMessages = messages.filter((message) => checkInMessageAuthorId(message) !== sessionUserId)
  return page === 1 && ownMessage ? [ownMessage, ...friendMessages] : friendMessages
}

export type FriendCheckInPageGroup = {
  offset: number
  take: number
}

export type FriendCheckInPagePlan = {
  page: number
  pageSize: number
  total: number
  totalPages: number
  hasMore: boolean
  own: FriendCheckInPageGroup
  followed: FriendCheckInPageGroup
  ordinary: FriendCheckInPageGroup
}

/**
 * Plans one exact-size server page for the three friend-message priority
 * groups. The caller can fetch each group with its returned offset/take, so a
 * followed friend is promoted before pagination rather than after a page was
 * already selected.
 */
export function planFriendCheckInMessagePage({
  ownCount,
  followedCount,
  ordinaryCount,
  page = 1,
  pageSize = CHECK_IN_MESSAGE_PAGE_SIZE,
}: {
  ownCount: number
  followedCount: number
  ordinaryCount: number
  page?: number
  pageSize?: number
}): FriendCheckInPagePlan {
  const safePageSize = Math.min(50, Math.max(1, Math.trunc(pageSize) || CHECK_IN_MESSAGE_PAGE_SIZE))
  const safeRequestedPage = Math.max(1, Math.trunc(page) || 1)
  const counts = {
    own: Math.max(0, Math.trunc(ownCount) || 0),
    followed: Math.max(0, Math.trunc(followedCount) || 0),
    ordinary: Math.max(0, Math.trunc(ordinaryCount) || 0),
  }
  const total = counts.own + counts.followed + counts.ordinary
  const totalPages = Math.max(1, Math.ceil(total / safePageSize))
  const safePage = Math.min(safeRequestedPage, totalPages)
  let cursor = (safePage - 1) * safePageSize
  let remaining = safePageSize

  function groupWindow(count: number): FriendCheckInPageGroup {
    if (cursor >= count) {
      cursor -= count
      return { offset: count, take: 0 }
    }

    const offset = cursor
    const take = Math.min(count - offset, remaining)
    cursor = 0
    remaining -= take
    return { offset, take }
  }

  return {
    page: safePage,
    pageSize: safePageSize,
    total,
    totalPages,
    hasMore: safePage < totalPages,
    own: groupWindow(counts.own),
    followed: groupWindow(counts.followed),
    ordinary: groupWindow(counts.ordinary),
  }
}
