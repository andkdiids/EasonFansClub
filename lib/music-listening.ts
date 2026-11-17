import type { Prisma } from '@prisma/client'
import { getShanghaiDayRange } from '@/lib/checkin'
import { prisma } from '@/lib/prisma'

export const MUSIC_LISTENING_SOURCES = ['ONLINE', 'LOCAL'] as const
export type MusicListeningSource = (typeof MUSIC_LISTENING_SOURCES)[number]

export const MUSIC_LISTENING_MAX_EVENTS = 30
export const MUSIC_LISTENING_MAX_EVENT_SECONDS = 60
export const MUSIC_LISTENING_MAX_CLOCK_SKEW_MS = 5 * 60 * 1000

const EVENT_ID_PATTERN = /^[A-Za-z0-9:_-]{1,191}$/

export type MusicListeningEvent = {
  eventId: string
  source: MusicListeningSource
  seconds: number
  startedAt: Date
  endedAt: Date
}

export type MusicListeningStats = {
  todaySeconds: number
  totalSeconds: number
  onlineSeconds: number
  localSeconds: number
}

export type MusicListeningRejection = {
  eventId: string
  reason: 'OVERLAPPING_INTERVAL'
}

export class MusicListeningError extends Error {
  readonly code: string
  readonly status: number

  constructor(code: string, message: string, status = 400) {
    super(message)
    this.name = 'MusicListeningError'
    this.code = code
    this.status = status
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function parseDate(value: unknown) {
  if (typeof value !== 'string' || !value.trim()) return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

function parseSeconds(value: unknown) {
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) return null
  return value
}

function parseSource(value: unknown): MusicListeningSource | null {
  return value === 'ONLINE' || value === 'LOCAL' ? value : null
}

function hasUnexpectedFields(event: Record<string, unknown>) {
  const allowedKeys = new Set(['eventId', 'source', 'seconds', 'startedAt', 'endedAt'])
  return Object.keys(event).some((key) => !allowedKeys.has(key))
}

export function normalizeMusicListeningEvents(value: unknown, now = new Date()): MusicListeningEvent[] {
  if (!Array.isArray(value)) throw new MusicListeningError('INVALID_EVENTS', '听歌统计事件格式无效')
  if (value.length > MUSIC_LISTENING_MAX_EVENTS) {
    throw new MusicListeningError('TOO_MANY_EVENTS', `每次最多同步 ${MUSIC_LISTENING_MAX_EVENTS} 条听歌统计`)
  }

  const normalized = new Map<string, MusicListeningEvent>()
  for (const raw of value) {
    if (!isRecord(raw)) throw new MusicListeningError('INVALID_EVENT', '听歌统计事件格式无效')
    const eventId = typeof raw.eventId === 'string' ? raw.eventId.trim() : ''
    const source = parseSource(raw.source)
    const seconds = parseSeconds(raw.seconds)
    const startedAt = parseDate(raw.startedAt)
    const endedAt = parseDate(raw.endedAt)
    if (!EVENT_ID_PATTERN.test(eventId)) throw new MusicListeningError('INVALID_EVENT_ID', '听歌统计幂等 ID 无效')
    if (!source) throw new MusicListeningError('INVALID_SOURCE', '听歌统计来源无效')
    if (!seconds || seconds < 1 || seconds > MUSIC_LISTENING_MAX_EVENT_SECONDS) {
      throw new MusicListeningError('INVALID_DURATION', '听歌统计时长无效')
    }
    if (!startedAt || !endedAt || endedAt <= startedAt) {
      throw new MusicListeningError('INVALID_INTERVAL', '听歌统计区间无效')
    }
    if (hasUnexpectedFields(raw)) {
      throw new MusicListeningError(
        source === 'LOCAL' ? 'LOCAL_METADATA_FORBIDDEN' : 'INVALID_EVENT_FIELDS',
        source === 'LOCAL' ? '本地听歌同步不得提交歌曲或路径信息' : '听歌统计事件包含未声明字段',
      )
    }

    const intervalSeconds = Math.floor((endedAt.getTime() - startedAt.getTime()) / 1000)
    if (intervalSeconds < 1 || intervalSeconds > MUSIC_LISTENING_MAX_EVENT_SECONDS || seconds > intervalSeconds) {
      throw new MusicListeningError('INVALID_INTERVAL', '听歌统计时长必须落在有效区间内')
    }
    if (endedAt.getTime() > now.getTime() + MUSIC_LISTENING_MAX_CLOCK_SKEW_MS) {
      throw new MusicListeningError('FUTURE_INTERVAL', '听歌统计区间不能明显晚于当前时间')
    }

    const event: MusicListeningEvent = { eventId, source, seconds, startedAt, endedAt }
    const previous = normalized.get(eventId)
    if (previous) {
      if (
        previous.source !== event.source
        || previous.seconds !== event.seconds
        || previous.startedAt.getTime() !== event.startedAt.getTime()
        || previous.endedAt.getTime() !== event.endedAt.getTime()
      ) throw new MusicListeningError('IDEMPOTENCY_CONFLICT', '同一听歌统计幂等 ID 的内容不一致', 409)
      continue
    }
    normalized.set(eventId, event)
  }

  return [...normalized.values()].sort((a, b) => a.startedAt.getTime() - b.startedAt.getTime())
}

type ExistingListeningRecord = {
  id: string
  eventId: string | null
  source: MusicListeningSource
  durationSeconds: number
  startedAt: Date | null
  endedAt: Date | null
}

function sameRecord(event: MusicListeningEvent, existing: ExistingListeningRecord) {
  return existing.eventId === event.eventId
    && existing.source === event.source
    && existing.durationSeconds === event.seconds
    && existing.startedAt?.getTime() === event.startedAt.getTime()
    && existing.endedAt?.getTime() === event.endedAt.getTime()
}

function overlaps(a: { startedAt: Date; endedAt: Date }, b: { startedAt: Date; endedAt: Date }) {
  return a.startedAt < b.endedAt && a.endedAt > b.startedAt
}

type ListeningTransaction = Prisma.TransactionClient

async function recordEventsInTransaction(tx: ListeningTransaction, userId: string, events: MusicListeningEvent[]) {
  await tx.$queryRaw`SELECT \`id\` FROM \`User\` WHERE \`id\` = ${userId} FOR UPDATE`
  if (!events.length) return { acknowledgedEventIds: [] as string[], rejectedEventIds: [] as string[], rejectedEvents: [] as MusicListeningRejection[] }

  const eventIds = events.map((event) => event.eventId)
  const existing = await tx.musicPlayRecord.findMany({
    where: { userId, eventId: { in: eventIds } },
    select: { id: true, eventId: true, source: true, durationSeconds: true, startedAt: true, endedAt: true },
  }) as ExistingListeningRecord[]
  const existingByEventId = new Map(existing.filter((row) => row.eventId).map((row) => [row.eventId as string, row]))

  const minStart = events.reduce((earliest, event) => event.startedAt < earliest ? event.startedAt : earliest, events[0].startedAt)
  const maxEnd = events.reduce((latest, event) => event.endedAt > latest ? event.endedAt : latest, events[0].endedAt)
  const overlappingRows = await tx.musicPlayRecord.findMany({
    where: {
      userId,
      startedAt: { lt: maxEnd },
      endedAt: { gt: minStart },
    },
    select: { id: true, eventId: true, source: true, durationSeconds: true, startedAt: true, endedAt: true },
  }) as ExistingListeningRecord[]

  const acknowledgedEventIds: string[] = []
  const rejectedEventIds: string[] = []
  const rejectedEvents: MusicListeningRejection[] = []
  const pending: MusicListeningEvent[] = []
  for (const event of events) {
    const prior = existingByEventId.get(event.eventId)
    if (prior) {
      if (!sameRecord(event, prior)) throw new MusicListeningError('IDEMPOTENCY_CONFLICT', '同一听歌统计幂等 ID 的内容不一致', 409)
      acknowledgedEventIds.push(event.eventId)
      continue
    }
    if (overlappingRows.some((row) => row.startedAt && row.endedAt && overlaps(event, { startedAt: row.startedAt, endedAt: row.endedAt }))) {
      rejectedEventIds.push(event.eventId)
      rejectedEvents.push({ eventId: event.eventId, reason: 'OVERLAPPING_INTERVAL' })
      continue
    }
    if (pending.some((row) => overlaps(event, row))) {
      rejectedEventIds.push(event.eventId)
      rejectedEvents.push({ eventId: event.eventId, reason: 'OVERLAPPING_INTERVAL' })
      continue
    }
    pending.push(event)
    acknowledgedEventIds.push(event.eventId)
  }

  for (const event of pending) {
    await tx.musicPlayRecord.create({
      data: {
        durationSeconds: event.seconds,
        playedAt: event.endedAt,
        source: event.source,
        eventId: event.eventId,
        startedAt: event.startedAt,
        endedAt: event.endedAt,
        userId,
      },
      select: { id: true },
    })
  }

  return { acknowledgedEventIds, rejectedEventIds, rejectedEvents }
}

export async function recordMusicListeningEvents(userId: string, events: MusicListeningEvent[]) {
  const result = await prisma.$transaction((tx) => recordEventsInTransaction(tx, userId, events))
  return { ...result, stats: await getMusicListeningStats(userId) }
}

export async function getMusicListeningStats(userId: string, now = new Date()) {
  const { start, end } = getShanghaiDayRange(now)
  const [total, bySource, todayIntervals, todayLegacy] = await Promise.all([
    prisma.musicPlayRecord.aggregate({ where: { userId }, _sum: { durationSeconds: true } }),
    prisma.musicPlayRecord.groupBy({ by: ['source'], where: { userId }, _sum: { durationSeconds: true } }),
    prisma.musicPlayRecord.findMany({
      where: {
        userId,
        startedAt: { not: null, lt: end },
        endedAt: { not: null, gt: start },
      },
      select: { durationSeconds: true, startedAt: true, endedAt: true },
    }),
    prisma.musicPlayRecord.groupBy({
      by: ['source'],
      where: { userId, startedAt: null, endedAt: null, playedAt: { gte: start, lt: end } },
      _sum: { durationSeconds: true },
    }),
  ])
  const intervalTodaySeconds = todayIntervals.reduce((sum, row) => {
    if (!row.startedAt || !row.endedAt) return sum
    const overlapStart = Math.max(start.getTime(), row.startedAt.getTime())
    const overlapEnd = Math.min(end.getTime(), row.endedAt.getTime())
    const overlapSeconds = Math.max(0, Math.floor((overlapEnd - overlapStart) / 1000))
    return sum + Math.min(row.durationSeconds, overlapSeconds)
  }, 0)
  const legacyTodaySeconds = todayLegacy.reduce((sum, row) => sum + (row._sum.durationSeconds || 0), 0)
  const sourceSeconds = (rows: typeof bySource, source: MusicListeningSource) => rows.find((row) => row.source === source)?._sum.durationSeconds || 0
  return {
    todaySeconds: intervalTodaySeconds + legacyTodaySeconds,
    totalSeconds: total._sum.durationSeconds || 0,
    onlineSeconds: sourceSeconds(bySource, 'ONLINE'),
    localSeconds: sourceSeconds(bySource, 'LOCAL'),
  }
}
