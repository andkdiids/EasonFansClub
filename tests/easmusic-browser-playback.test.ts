import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import {
  appendBrowserListeningEvent,
  consumeBrowserListeningSegment,
  getBrowserListeningStorageKey,
  getBrowserRejectedListeningStorageKey,
  getNextBrowserQueueTrack,
  getPreviousBrowserQueueTrack,
  readBrowserListeningEvents,
  readBrowserRejectedListeningEvents,
  rebuildBrowserAudioElement,
  writeBrowserListeningEvents,
  writeBrowserRejectedListeningEvents,
  type BrowserListeningEvent,
  type BrowserListeningSegment,
} from '../lib/music-browser-playback'

class MemoryStorage {
  private readonly values = new Map<string, string>()

  getItem(key: string) {
    return this.values.get(key) ?? null
  }

  setItem(key: string, value: string) {
    this.values.set(key, value)
  }

  removeItem(key: string) {
    this.values.delete(key)
  }
}

class QuotaStorage extends MemoryStorage {
  override setItem() {
    throw new Error('quota')
  }
}

class FakeAudio extends EventTarget {
  preload = 'metadata'
  paused = false
  pauseCount = 0
  loadCount = 0
  src = 'https://same-origin.test/old.mp3'

  pause() {
    this.pauseCount += 1
    this.paused = true
  }

  removeAttribute(name: string) {
    if (name === 'src') this.src = ''
  }

  load() {
    this.loadCount += 1
  }
}

function event(eventId: string, seconds = 1): BrowserListeningEvent {
  return {
    eventId,
    source: 'ONLINE',
    seconds,
    startedAt: '2026-11-17T00:00:00.000Z',
    endedAt: '2026-11-17T00:00:01.000Z',
  }
}

test('provider records only authenticated ONLINE transport events and exposes seek/repeat controls', () => {
  const provider = readFileSync('components/music/MusicPlayerProvider.tsx', 'utf8')
  const miniPlayer = readFileSync('components/music/MusicMiniPlayer.tsx', 'utf8')
  assert.match(provider, /fetch\('\/api\/auth\/me'/)
  assert.match(provider, /performance\.now\(\)/)
  assert.match(provider, /fetch\('\/api\/music\/listening'/)
  assert.match(provider, /credentials: 'same-origin'/)
  assert.match(provider, /'X-ECFC-Listening-Owner': userId/)
  assert.match(provider, /body: JSON\.stringify\(\{ events: batch \}\)/)
  assert.match(provider, /BROWSER_LISTENING_MAX_UPLOAD_EVENTS/)
  assert.match(miniPlayer, /type="range"/)
  assert.match(miniPlayer, /onCycleRepeat/)
})

test('provider archives rejected events before removing them from pending storage', () => {
  const provider = readFileSync('components/music/MusicPlayerProvider.tsx', 'utf8')
  const archiveStart = provider.indexOf('rejectedArchiveReady = writeBrowserRejectedListeningEvents')
  const pendingStart = provider.indexOf('writeBrowserListeningEvents', archiveStart)
  assert.ok(archiveStart >= 0)
  assert.ok(pendingStart > archiveStart)
  assert.match(provider, /const persisted = storage \? writeBrowserListeningEvents\(storage, userId, remaining\) : false/)
  assert.match(provider, /listeningPendingRef\.current = persisted \? remaining : current/)
})

test('queue modes wrap lists, restart single tracks, and avoid the current shuffle item', () => {
  const queue = [{ id: 'a' }, { id: 'b' }, { id: 'c' }]
  assert.equal(getNextBrowserQueueTrack(queue, 'c', 'list')?.id, 'a')
  assert.equal(getNextBrowserQueueTrack(queue, 'b', 'single')?.id, 'b')
  assert.equal(getNextBrowserQueueTrack(queue, 'b', 'shuffle', () => 0)?.id, 'a')
  assert.equal(getPreviousBrowserQueueTrack(queue, 'a')?.id, 'c')
})

test('pending listening storage preserves more than one upload batch and projects only the five transport fields', () => {
  const storage = new MemoryStorage()
  const events = Array.from({ length: 31 }, (_, index) => event(`event-${index}`))
  assert.equal(writeBrowserListeningEvents(storage as unknown as Storage, 'user-a', events), true)
  const key = getBrowserListeningStorageKey('user-a')
  const raw = JSON.parse(storage.getItem(key) || '[]') as Record<string, unknown>[]
  raw[0].title = 'must not be replayed'
  storage.setItem(key, JSON.stringify(raw))
  const read = readBrowserListeningEvents(storage as unknown as Storage, 'user-a')
  assert.equal(read.length, 31)
  assert.deepEqual(Object.keys(read[0]).sort(), ['endedAt', 'eventId', 'seconds', 'source', 'startedAt'])
  assert.equal(appendBrowserListeningEvent(read, event('event-31')).length, 32)
  assert.deepEqual(readBrowserListeningEvents(storage as unknown as Storage, 'user-b'), [])
  assert.equal(writeBrowserRejectedListeningEvents(storage as unknown as Storage, 'user-a', [{ ...event('event-2'), reason: 'OVERLAPPING_INTERVAL' }]), true)
  assert.deepEqual(readBrowserRejectedListeningEvents(storage as unknown as Storage, 'user-a').map((item) => item.reason), ['OVERLAPPING_INTERVAL'])
  assert.equal(storage.getItem(getBrowserRejectedListeningStorageKey('user-b')), null)
})

test('storage quota failure is explicit and does not manufacture durable success', () => {
  const storage = new QuotaStorage()
  assert.equal(writeBrowserListeningEvents(storage as unknown as Storage, 'user-a', [event('quota')]), false)
  assert.equal(storage.getItem(getBrowserListeningStorageKey('user-a')), null)
})

test('a stalled timer discards unobserved time and reanchors the next observable segment', () => {
  const segment: BrowserListeningSegment = {
    userId: 'user-a',
    startedAtMs: 1_000,
    cursorAtMs: 1_000,
    cursorPerfMs: 10_000,
  }
  const result = consumeBrowserListeningSegment(segment, 190_000)
  assert.equal(result.events.length, 0)
  assert.equal(result.segment.cursorAtMs, 181_000)
  const resumed = consumeBrowserListeningSegment(result.segment, 195_000)
  assert.equal(resumed.events[0].seconds, 5)
  assert.equal(resumed.events[0].startedAt, new Date(181_000).toISOString())
  assert.equal(result.segment.cursorPerfMs, 190_000)
  assert.ok(result.events.every((item) => item.seconds <= 60))
})

test('rebuilding the source element disposes the old element before binding exactly one replacement', () => {
  const oldAudio = new FakeAudio()
  const bound: FakeAudio[] = []
  const disposed: FakeAudio[] = []
  const nextAudio = rebuildBrowserAudioElement(
    oldAudio,
    () => new FakeAudio(),
    (audio) => disposed.push(audio),
    (audio) => bound.push(audio),
  )
  assert.equal(oldAudio.pauseCount, 1)
  assert.equal(oldAudio.loadCount, 1)
  assert.equal(oldAudio.src, '')
  assert.deepEqual(disposed, [oldAudio])
  assert.deepEqual(bound, [nextAudio])
  assert.notEqual(nextAudio, oldAudio)
})
