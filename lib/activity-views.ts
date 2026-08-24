import { createHash } from 'node:crypto'

export const ACTIVITY_VIEW_WINDOW_MS = 20 * 60 * 1000
export const ACTIVITY_VIEW_HISTORY_COOKIE = 'efc_activity_view_history'
export const ACTIVITY_VIEWER_COOKIE = 'efc_activity_viewer'

const MAX_HISTORY_ENTRIES = 50

export type ActivityViewHistory = Record<string, number>

export function createActivityViewKey(activityId: string, viewerIdentity: string) {
  return createHash('sha256').update(`${viewerIdentity}:${activityId}`).digest('base64url')
}

export function parseActivityViewHistory(value: string | undefined, now = Date.now()): ActivityViewHistory {
  if (!value) return {}
  try {
    const parsed: unknown = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'))
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    return Object.fromEntries(Object.entries(parsed).filter((entry): entry is [string, number] => (
      typeof entry[1] === 'number' && Number.isFinite(entry[1]) && now - entry[1] < ACTIVITY_VIEW_WINDOW_MS
    )))
  } catch {
    return {}
  }
}

export function shouldCountActivityView(history: ActivityViewHistory, key: string, now = Date.now()) {
  const previous = history[key]
  return typeof previous !== 'number' || now - previous >= ACTIVITY_VIEW_WINDOW_MS
}

export function recordActivityView(history: ActivityViewHistory, key: string, now = Date.now()) {
  return Object.fromEntries(
    [...Object.entries(history), [key, now] as const]
      .filter(([, timestamp]) => now - timestamp < ACTIVITY_VIEW_WINDOW_MS)
      .sort((left, right) => right[1] - left[1])
      .slice(0, MAX_HISTORY_ENTRIES),
  )
}

export function serializeActivityViewHistory(history: ActivityViewHistory) {
  return Buffer.from(JSON.stringify(history), 'utf8').toString('base64url')
}
