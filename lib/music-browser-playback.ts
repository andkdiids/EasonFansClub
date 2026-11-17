export type BrowserRepeatMode = 'list' | 'single' | 'shuffle'

export type BrowserQueueTrack = {
  id: string
}

export type BrowserListeningEvent = {
  eventId: string
  source: 'ONLINE'
  seconds: number
  startedAt: string
  endedAt: string
}

export type BrowserRejectedListeningEvent = BrowserListeningEvent & {
  reason: string
}

export type BrowserListeningSegment = {
  userId: string
  startedAtMs: number
  cursorAtMs: number
  cursorPerfMs: number
}

export const BROWSER_LISTENING_MAX_SECONDS = 60
export const BROWSER_LISTENING_MAX_UPLOAD_EVENTS = 30
export const BROWSER_LISTENING_STORAGE_PREFIX = 'easmusic:listening-pending:'
export const BROWSER_LISTENING_REJECTED_STORAGE_PREFIX = 'easmusic:listening-rejected:'

export function createBrowserAudioElement() {
  const audio = new Audio()
  audio.preload = 'metadata'
  return audio
}

/**
 * A MediaElementSourceNode permanently owns the media element it was created
 * from. Reusing that element for an un-analyzable cross-origin URL can mute
 * playback, so callers must dispose the old analysis before binding the new
 * element.
 */
export function rebuildBrowserAudioElement<T extends {
  preload: string
  pause: () => void
  removeAttribute: (name: string) => void
  load: () => void
}>(
  current: T,
  create: () => T,
  dispose: (element: T) => void,
  bind: (element: T) => void,
) {
  current.pause()
  current.removeAttribute('src')
  current.load()
  dispose(current)
  const next = create()
  next.preload = current.preload
  bind(next)
  return next
}

export function getNextBrowserQueueTrack<T extends BrowserQueueTrack>(
  queue: readonly T[],
  currentId: string,
  mode: BrowserRepeatMode,
  random = Math.random,
) {
  if (!queue.length) return null
  const currentIndex = queue.findIndex((item) => item.id === currentId)
  if (mode === 'single') return currentIndex >= 0 ? queue[currentIndex] : queue[0]
  if (mode === 'shuffle') {
    if (queue.length === 1) return queue[0]
    const candidates = queue.filter((item) => item.id !== currentId)
    return candidates[Math.min(candidates.length - 1, Math.floor(Math.max(0, Math.min(0.999999, random())) * candidates.length))] || queue[0]
  }
  if (currentIndex < 0) return queue[0]
  return queue[(currentIndex + 1) % queue.length]
}

export function getPreviousBrowserQueueTrack<T extends BrowserQueueTrack>(queue: readonly T[], currentId: string) {
  if (!queue.length) return null
  const currentIndex = queue.findIndex((item) => item.id === currentId)
  if (currentIndex < 0) return queue[queue.length - 1]
  return queue[(currentIndex - 1 + queue.length) % queue.length]
}

export function createBrowserListeningEventId(now = Date.now()) {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  return `web-${now.toString(36)}-${Math.random().toString(36).slice(2, 12)}`
}

export function getBrowserListeningStorageKey(userId: string) {
  return `${BROWSER_LISTENING_STORAGE_PREFIX}${encodeURIComponent(userId)}`
}

export function getBrowserRejectedListeningStorageKey(userId: string) {
  return `${BROWSER_LISTENING_REJECTED_STORAGE_PREFIX}${encodeURIComponent(userId)}`
}

export function readBrowserListeningEvents(storage: Storage | null, userId: string): BrowserListeningEvent[] {
  if (!storage) return []
  try {
    const parsed = JSON.parse(storage.getItem(getBrowserListeningStorageKey(userId)) || '[]') as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.flatMap((item): BrowserListeningEvent[] => {
      if (!item || typeof item !== 'object') return []
      const candidate = item as Record<string, unknown>
      const valid = typeof candidate.eventId === 'string'
        && candidate.eventId.length > 0
        && candidate.source === 'ONLINE'
        && Number.isSafeInteger(candidate.seconds)
        && Number(candidate.seconds) >= 1
        && Number(candidate.seconds) <= BROWSER_LISTENING_MAX_SECONDS
        && typeof candidate.startedAt === 'string'
        && typeof candidate.endedAt === 'string'
      if (!valid) return []
      return [{
        eventId: candidate.eventId as string,
        source: 'ONLINE',
        seconds: candidate.seconds as number,
        startedAt: candidate.startedAt as string,
        endedAt: candidate.endedAt as string,
      }]
    })
  } catch {
    return []
  }
}

export function writeBrowserListeningEvents(storage: Storage | null, userId: string, events: readonly BrowserListeningEvent[]) {
  if (!storage) return false
  try {
    if (!events.length) storage.removeItem(getBrowserListeningStorageKey(userId))
    else storage.setItem(getBrowserListeningStorageKey(userId), JSON.stringify(events))
    return true
  } catch {
    return false
  }
}

export function readBrowserRejectedListeningEvents(storage: Storage | null, userId: string): BrowserRejectedListeningEvent[] {
  if (!storage) return []
  try {
    const parsed = JSON.parse(storage.getItem(getBrowserRejectedListeningStorageKey(userId)) || '[]') as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.flatMap((item): BrowserRejectedListeningEvent[] => {
      if (!item || typeof item !== 'object') return []
      const candidate = item as Record<string, unknown>
      if (typeof candidate.reason !== 'string') return []
      const event = candidate as Record<string, unknown>
      if (typeof event.eventId !== 'string' || event.eventId.length === 0
        || event.source !== 'ONLINE'
        || !Number.isSafeInteger(event.seconds)
        || Number(event.seconds) < 1
        || Number(event.seconds) > BROWSER_LISTENING_MAX_SECONDS
        || typeof event.startedAt !== 'string'
        || typeof event.endedAt !== 'string') return []
      return [{
        eventId: event.eventId,
        source: 'ONLINE',
        seconds: event.seconds as number,
        startedAt: event.startedAt,
        endedAt: event.endedAt,
        reason: candidate.reason,
      }]
    })
  } catch {
    return []
  }
}

export function writeBrowserRejectedListeningEvents(storage: Storage | null, userId: string, events: readonly BrowserRejectedListeningEvent[]) {
  if (!storage) return false
  try {
    if (!events.length) storage.removeItem(getBrowserRejectedListeningStorageKey(userId))
    else storage.setItem(getBrowserRejectedListeningStorageKey(userId), JSON.stringify(events))
    return true
  } catch {
    return false
  }
}

export function removeBrowserAcknowledgedEvents(
  events: readonly BrowserListeningEvent[],
  acknowledgedEventIds: readonly string[],
  rejectedEventIds: readonly string[],
) {
  const consumed = new Set([...acknowledgedEventIds, ...rejectedEventIds])
  return events.filter((event) => !consumed.has(event.eventId))
}

export function appendBrowserListeningEvent(events: readonly BrowserListeningEvent[], event: BrowserListeningEvent) {
  if (events.some((item) => item.eventId === event.eventId)) return [...events]
  return [...events, event]
}

export function consumeBrowserListeningSegment(
  segment: BrowserListeningSegment,
  nowPerfMs: number,
  maxSeconds = BROWSER_LISTENING_MAX_SECONDS,
) {
  const elapsedMs = Math.max(0, nowPerfMs - segment.cursorPerfMs)
  // A long suspended timer is not evidence of continuous audible playback.
  if (elapsedMs > 15_000) return { events: [] as BrowserListeningEvent[], segment: { ...segment, cursorAtMs: segment.cursorAtMs + elapsedMs, cursorPerfMs: nowPerfMs } }
  const elapsedSeconds = Math.min(maxSeconds, Math.floor(elapsedMs / 1000))
  if (elapsedSeconds < 1) return { events: [] as BrowserListeningEvent[], segment }

  const events: BrowserListeningEvent[] = []
  let remainingSeconds = elapsedSeconds
  let cursorAtMs = segment.cursorAtMs
  while (remainingSeconds > 0) {
    const seconds = Math.min(maxSeconds, remainingSeconds)
    const startedAtMs = cursorAtMs
    const endedAtMs = startedAtMs + seconds * 1000
    events.push({
      eventId: createBrowserListeningEventId(startedAtMs),
      source: 'ONLINE',
      seconds,
      startedAt: new Date(startedAtMs).toISOString(),
      endedAt: new Date(endedAtMs).toISOString(),
    })
    cursorAtMs = endedAtMs
    remainingSeconds -= seconds
  }
  return {
    events,
    segment: {
      ...segment,
      cursorAtMs,
      cursorPerfMs: nowPerfMs,
    },
  }
}
