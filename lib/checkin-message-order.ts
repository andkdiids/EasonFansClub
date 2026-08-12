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
