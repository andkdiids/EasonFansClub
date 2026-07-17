import { createHash } from 'node:crypto'

export const POST_VIEW_WINDOW_MS = 20 * 60 * 1000
export const POST_VIEW_HISTORY_COOKIE = 'efc_post_view_history'
export const POST_VIEWER_COOKIE = 'efc_viewer'
const MAX_HISTORY_ENTRIES = 50

export type PostViewHistory = Record<string, number>

export function createPostViewKey(postId: string, viewerIdentity: string) {
  return createHash('sha256').update(`${viewerIdentity}:${postId}`).digest('base64url')
}

export function parsePostViewHistory(value: string | undefined, now = Date.now()): PostViewHistory {
  if (!value) return {}
  try {
    const parsed: unknown = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'))
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    return Object.fromEntries(Object.entries(parsed).filter((entry): entry is [string, number] => (
      typeof entry[1] === 'number' && Number.isFinite(entry[1]) && now - entry[1] < POST_VIEW_WINDOW_MS
    )))
  } catch {
    return {}
  }
}

export function shouldCountPostView(history: PostViewHistory, key: string, now = Date.now()) {
  const previous = history[key]
  return typeof previous !== 'number' || now - previous >= POST_VIEW_WINDOW_MS
}

export function recordPostView(history: PostViewHistory, key: string, now = Date.now()) {
  return Object.fromEntries(
    [...Object.entries(history), [key, now] as const]
      .filter(([, timestamp]) => now - timestamp < POST_VIEW_WINDOW_MS)
      .sort((left, right) => right[1] - left[1])
      .slice(0, MAX_HISTORY_ENTRIES),
  )
}

export function serializePostViewHistory(history: PostViewHistory) {
  return Buffer.from(JSON.stringify(history), 'utf8').toString('base64url')
}
