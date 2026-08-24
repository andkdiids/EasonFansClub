export const FRIEND_LIST_RETURN_STATE_KEY = 'friends:list:return-state'
export const FRIEND_LIST_RETURN_STATE_TTL_MS = 5 * 60 * 1000

export type FriendListReturnState = {
  friendId: string
  scrollTop: number
  scrollY: number
  viewportOffset: number | null
  query: string
  createdAt: number
}

function finiteOr(value: unknown, fallback: number) {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function nonNegative(value: unknown, fallback: number) {
  return Math.max(0, finiteOr(value, fallback))
}

export function createFriendListReturnState(input: {
  friendId: string
  scrollTop: number
  scrollY: number
  viewportOffset?: number | null
  query?: string
  createdAt?: number
}): FriendListReturnState {
  const viewportOffset = input.viewportOffset === null || input.viewportOffset === undefined
    ? null
    : finiteOr(input.viewportOffset, 0)
  return {
    friendId: input.friendId,
    scrollTop: nonNegative(input.scrollTop, 0),
    scrollY: nonNegative(input.scrollY, 0),
    viewportOffset,
    query: typeof input.query === 'string' ? input.query : '',
    createdAt: nonNegative(input.createdAt, Date.now()),
  }
}

export function parseFriendListReturnState(raw: string | null, now = Date.now()): FriendListReturnState | null {
  if (!raw) return null
  try {
    const value: unknown = JSON.parse(raw)
    if (!value || typeof value !== 'object') return null
    const candidate = value as Partial<FriendListReturnState>
    if (typeof candidate.friendId !== 'string' || !candidate.friendId.trim()) return null
    if (typeof candidate.createdAt !== 'number' || !Number.isFinite(candidate.createdAt)) return null
    if (candidate.createdAt > now || now - candidate.createdAt > FRIEND_LIST_RETURN_STATE_TTL_MS) return null
    if (typeof candidate.scrollTop !== 'number' || !Number.isFinite(candidate.scrollTop)) return null
    if (typeof candidate.scrollY !== 'number' || !Number.isFinite(candidate.scrollY)) return null
    if (candidate.viewportOffset !== null && candidate.viewportOffset !== undefined
      && (typeof candidate.viewportOffset !== 'number' || !Number.isFinite(candidate.viewportOffset))) return null
    return createFriendListReturnState({
      friendId: candidate.friendId,
      scrollTop: candidate.scrollTop,
      scrollY: candidate.scrollY,
      viewportOffset: candidate.viewportOffset ?? null,
      query: candidate.query,
      createdAt: candidate.createdAt,
    })
  } catch {
    return null
  }
}

export function calculateFriendListRestoredScrollTop(input: {
  currentScrollTop: number
  fallbackScrollTop: number
  maxScrollTop: number
  containerTop: number
  friendTop: number | null
  savedViewportOffset: number | null
}) {
  const maxScrollTop = Math.max(0, finiteOr(input.maxScrollTop, 0))
  const fallback = Math.min(maxScrollTop, nonNegative(input.fallbackScrollTop, 0))
  if (input.friendTop === null || input.savedViewportOffset === null) return fallback
  const currentScrollTop = nonNegative(input.currentScrollTop, 0)
  const next = currentScrollTop + finiteOr(input.friendTop, 0) - finiteOr(input.containerTop, 0) - input.savedViewportOffset
  return Math.min(maxScrollTop, Math.max(0, next))
}
