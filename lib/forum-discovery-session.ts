// Client-side cache coordination for the Xiaochenshu forum discovery feed.
//
// The /forum feed (ForumDiscoveryHome) restores each board's rows from a
// sessionStorage snapshot (forum-discovery-session:<path>?<query>) for up to
// DISCOVERY_SESSION_MAX_AGE_MS and, while a snapshot is fresh, does not touch
// the network. After a post is moved to another board (分区/板块) those stale
// snapshots are exactly what keep the old board listing alive.
//
// This module is the single coordination point:
//   - notifyForumDiscoveryFeedChanged() evicts every affected snapshot and
//     notifies any mounted feed instance so it refreshes right away.
//   - The pure helpers are shared with tests.

export const FORUM_DISCOVERY_SESSION_PREFIX = 'forum-discovery-session:'
export const FORUM_DISCOVERY_FEED_CHANGED_EVENT = 'ecfc:forum-discovery-feed-changed'

export type ForumDiscoveryFeedChangeDetail = {
  postId: string
  /** Old board slug (null/undefined when unknown). */
  boardFrom?: string | null
  /** New board slug (null/undefined when unknown). */
  boardTo?: string | null
}

export type SessionStorageLike = Pick<Storage, 'length' | 'key' | 'getItem' | 'removeItem'>

/** Extract the `board` query param out of a forum discovery session key. */
export function forumFeedSessionBoardParam(sessionKey: string): string | null {
  const separator = sessionKey.indexOf('?')
  if (separator < 0) return null
  try {
    return new URLSearchParams(sessionKey.slice(separator + 1)).get('board')
  } catch {
    return null
  }
}

/**
 * Whether a stored feed session must be dropped after a post moved boards.
 * Board-less sessions (latest / 全部 / recommend) can contain the post, and
 * both the old and the new board sessions are affected.
 */
export function shouldEvictForumFeedSession(
  boardParam: string | null,
  boardFrom?: string | null,
  boardTo?: string | null,
): boolean {
  const noBoard = boardParam === null || boardParam === '' || boardParam === 'all'
  if (noBoard) return true
  if (boardFrom && boardFrom === boardParam) return true
  if (boardTo && boardTo === boardParam) return true
  return false
}

/**
 * Remove stale forum feed snapshots whose board scope may contain the moved
 * post. Runs regardless of whether a feed component is currently mounted so a
 * later back-navigation can never restore the old board row.
 */
export function evictForumDiscoveryFeedSessions(
  detail: ForumDiscoveryFeedChangeDetail,
  storage: SessionStorageLike,
): number {
  // Collect keys before deleting: sessionStorage is an indexed list and
  // deleting while iterating by index silently skips entries.
  const keys: string[] = []
  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index)
    if (key) keys.push(key)
  }
  let removed = 0
  for (const key of keys) {
    if (!key.startsWith(FORUM_DISCOVERY_SESSION_PREFIX)) continue
    const boardParam = forumFeedSessionBoardParam(key)
    if (!shouldEvictForumFeedSession(boardParam, detail.boardFrom, detail.boardTo)) continue
    storage.removeItem(key)
    removed += 1
  }
  return removed
}

function defaultSessionStorage(): SessionStorageLike | null {
  if (typeof window === 'undefined' || !window.sessionStorage) return null
  return window.sessionStorage
}

/**
 * Called by the post editor after a successful save that moved the post to
 * another board. Evicts affected feed snapshots and pings live feed instances.
 */
export function notifyForumDiscoveryFeedChanged(detail: ForumDiscoveryFeedChangeDetail): void {
  const storage = defaultSessionStorage()
  if (storage) evictForumDiscoveryFeedSessions(detail, storage)
  if (typeof window === 'undefined' || !window.dispatchEvent) return
  window.dispatchEvent(new CustomEvent<ForumDiscoveryFeedChangeDetail>(FORUM_DISCOVERY_FEED_CHANGED_EVENT, { detail }))
}

/** Whether a currently shown feed (its URL board param) may contain the moved post. */
export function forumFeedAffectedByChange(
  currentBoardParam: string,
  detail: ForumDiscoveryFeedChangeDetail,
): boolean {
  const noBoard = currentBoardParam === '' || currentBoardParam === 'all'
  if (noBoard) return true
  if (detail.boardFrom && detail.boardFrom === currentBoardParam) return true
  if (detail.boardTo && detail.boardTo === currentBoardParam) return true
  return false
}
