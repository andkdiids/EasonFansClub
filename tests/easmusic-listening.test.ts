import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import {
  MusicListeningError,
  normalizeMusicListeningEvents,
  MUSIC_LISTENING_MAX_EVENTS,
  MUSIC_LISTENING_MAX_EVENT_SECONDS,
} from '../lib/music-listening'

const source = (path: string) => readFileSync(path, 'utf8').replace(/\r\n/g, '\n')

const now = new Date('2026-11-17T03:00:00.000Z')
const validEvent = {
  eventId: 'local:device-1:segment-1',
  source: 'LOCAL',
  seconds: 30,
  startedAt: '2026-11-17T02:59:00.000Z',
  endedAt: '2026-11-17T02:59:30.000Z',
}

function expectError(action: () => unknown, code: string) {
  let error: unknown
  try {
    action()
  } catch (caught) {
    error = caught
  }
  assert.ok(error)
  const typedError = error as MusicListeningError
  assert.equal(typedError.name, 'MusicListeningError')
  assert.equal(typedError.code, code)
}

test('听歌统计只接受有效区间，并按 eventId 对同内容批次去重', () => {
  const events = normalizeMusicListeningEvents([validEvent, { ...validEvent }], now)
  assert.equal(events.length, 1)
  assert.equal(events[0].eventId, validEvent.eventId)
  assert.equal(events[0].source, 'LOCAL')
  assert.equal(events[0].seconds, 30)
  assert.equal(events[0].startedAt.toISOString(), validEvent.startedAt)
  assert.equal(events[0].endedAt.toISOString(), validEvent.endedAt)
})

test('LOCAL 同步拒绝任意曲名、路径及未声明 metadata', () => {
  for (const key of ['title', 'path', 'sourceUrl', 'songId', 'trackId', 'deviceId']) {
    expectError(() => normalizeMusicListeningEvents([{ ...validEvent, [key]: 'must-not-upload' }], now), 'LOCAL_METADATA_FORBIDDEN')
  }
  expectError(() => normalizeMusicListeningEvents([{
    ...validEvent,
    source: 'ONLINE',
    title: 'must-not-upload',
  }], now), 'INVALID_EVENT_FIELDS')
})

test('听歌统计拒绝重复 ID 内容冲突、保留重叠事件供服务端部分接收、拒绝未来区间', () => {
  expectError(() => normalizeMusicListeningEvents([
    validEvent,
    { ...validEvent, seconds: 29 },
  ], now), 'IDEMPOTENCY_CONFLICT')

  const overlapping = normalizeMusicListeningEvents([
    validEvent,
    {
      ...validEvent,
      eventId: 'local:device-1:segment-2',
      startedAt: '2026-11-17T02:59:20.000Z',
      endedAt: '2026-11-17T02:59:50.000Z',
    },
  ], now)
  assert.equal(overlapping.length, 2)

  expectError(() => normalizeMusicListeningEvents([{
    ...validEvent,
    startedAt: '2026-11-17T03:05:30.000Z',
    endedAt: '2026-11-17T03:06:00.000Z',
  }], now), 'FUTURE_INTERVAL')
})

test('听歌统计 API 只暴露认证后的最小事件字段和汇总结果', () => {
  const route = source('app/api/music/listening/route.ts')
  assert.match(route, /requireRequestUser\(request\)/)
  assert.match(route, /normalizeMusicListeningEvents\(body\?\.events\)/)
  assert.match(route, /acknowledgedEventIds/)
  assert.match(route, /rejectedEventIds/)
  assert.match(route, /rejectedEvents/)
  assert.match(route, /stats:/)
  assert.match(route, /x-ecfc-listening-owner/)
  assert.match(route, /LISTENING_OWNER_REQUIRED/)
  assert.match(route, /LISTENING_OWNER_MISMATCH/)
  assert.match(route, /expectedOwner !== guard\.user\.id/)
  const helper = source('lib/music-listening.ts')
  assert.match(helper, /todaySeconds/)
  assert.match(helper, /onlineSeconds/)
  assert.match(helper, /localSeconds/)
  assert.doesNotMatch(route, /sourceAudioPath|title|artist|album|filePath/)

  assert.match(helper, /tx\.\$queryRaw/)
  assert.match(helper, /FOR UPDATE/)
  assert.match(helper, /userId, eventId: \{ in: eventIds \}/)
  assert.match(helper, /overlaps\(/)
  assert.match(helper, /rejectedEventIds/)
  assert.match(helper, /reason: 'OVERLAPPING_INTERVAL'/)
  assert.match(helper, /MUSIC_LISTENING_MAX_EVENTS = 30/)
  assert.match(helper, /MUSIC_LISTENING_MAX_EVENT_SECONDS = 60/)
})

test('听歌统计保护批次和单事件的服务端上限', () => {
  assert.equal(MUSIC_LISTENING_MAX_EVENTS, 30)
  assert.equal(MUSIC_LISTENING_MAX_EVENT_SECONDS, 60)
  const tooMany = Array.from({ length: MUSIC_LISTENING_MAX_EVENTS + 1 }, (_, index) => ({
    ...validEvent,
    eventId: `event-${index}`,
  }))
  expectError(() => normalizeMusicListeningEvents(tooMany, now), 'TOO_MANY_EVENTS')
  expectError(() => normalizeMusicListeningEvents([{
    ...validEvent,
    seconds: MUSIC_LISTENING_MAX_EVENT_SECONDS + 1,
  }], now), 'INVALID_DURATION')
})
