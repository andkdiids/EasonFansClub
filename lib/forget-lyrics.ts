import type { GuessSongMode } from '@prisma/client'
import type { SessionUser } from '@/lib/auth'
import { getBeijingDateKey, shiftBeijingDateKey } from '@/lib/beijing-time'
import { publicImageVariantUrl } from '@/lib/image-variants'
import { resolveMusicPlayback } from '@/lib/music-playback'
import { prisma } from '@/lib/prisma'

/**
 * 「听听」的实际单人来源是 GuessSongSession。GuessSongMode 是该来源内的
 * 难度值，不是其它游戏的共享答案模式；未来新增值必须显式加入这里后，
 * 才能进入忘记歌词。
 */
export const TINGTING_SOURCE_SESSION_TYPE = 'GuessSongSession' as const
export const TINGTING_SOURCE_ROUTE = '/games/guess-song' as const
export const TINGTING_SESSION_MODES: readonly GuessSongMode[] = [
  'EASY',
  'ADVANCED',
  'HARD',
  'EXPERT',
  'ENDLESS',
]

export const FORGET_LYRICS_MAX_TODAY_DISPLAY = 5
export const FORGET_LYRICS_SKIPPED_OPTION = '__SKIPPED__'

export function parseForgetLyricsLimit(value: string | null) {
  if (value === null) return undefined
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed >= 0
    ? Math.min(FORGET_LYRICS_MAX_TODAY_DISPLAY, Math.floor(parsed))
    : undefined
}

export type ForgetLyricsRange = 'today' | '7d' | 'all'
export type ForgetLyricsSort = 'recent' | 'most'

export type ForgetLyricsAnswerEvent = {
  sourceSessionType: string
  gameMode: string
  songId: string | null
  isCorrect: boolean | null
  selectedOptionKey: string | null
  answeredAt: Date | null
}

export type ForgetLyricsAggregate = {
  songId: string
  wrongCount: number
  todayWrongCount: number
  wrongCountByDate: Record<string, number>
  firstWrongAt: Date
  lastWrongAt: Date
}

export type ForgetLyricsSong = {
  id: string
  title: string
  artist: string
  albumName: string
  coverUrl: string | null
  previewUrl: string
  previewDuration: number
  isFullPlayback: boolean
  wrongCount: number
  rangeWrongCount: number
  todayWrongCount: number
  firstWrongAt: string
  lastWrongAt: string
}

export type ForgetLyricsData = {
  range: ForgetLyricsRange
  sort: ForgetLyricsSort
  todayDate: string
  total: number
  items: ForgetLyricsSong[]
}

export function isTingTingSessionMode(value: string): value is GuessSongMode {
  return (TINGTING_SESSION_MODES as readonly string[]).includes(value)
}

/**
 * This is the only source predicate used by the aggregation path. It is
 * deliberately stricter than a global "wrong answer" hook: only a completed
 * server-side answer from the regular GuessSongSession can pass it.
 */
export function isForgetLyricsWrongAnswer(event: ForgetLyricsAnswerEvent): event is ForgetLyricsAnswerEvent & {
  songId: string
  isCorrect: false
  answeredAt: Date
} {
  return event.sourceSessionType === TINGTING_SOURCE_SESSION_TYPE
    && isTingTingSessionMode(event.gameMode)
    && event.isCorrect === false
    && event.selectedOptionKey !== FORGET_LYRICS_SKIPPED_OPTION
    && typeof event.songId === 'string'
    && event.songId.length > 0
    && event.answeredAt instanceof Date
    && !Number.isNaN(event.answeredAt.getTime())
}

function incrementDateCount(target: Record<string, number>, dateKey: string) {
  target[dateKey] = (target[dateKey] || 0) + 1
}

export function aggregateForgetLyricsEvents(events: readonly ForgetLyricsAnswerEvent[], todayDateKey = getBeijingDateKey()): ForgetLyricsAggregate[] {
  const bySong = new Map<string, ForgetLyricsAggregate>()

  for (const event of events) {
    if (!isForgetLyricsWrongAnswer(event)) continue
    const dateKey = getBeijingDateKey(event.answeredAt)
    const current = bySong.get(event.songId)
    if (!current) {
      bySong.set(event.songId, {
        songId: event.songId,
        wrongCount: 1,
        todayWrongCount: dateKey === todayDateKey ? 1 : 0,
        wrongCountByDate: { [dateKey]: 1 },
        firstWrongAt: event.answeredAt,
        lastWrongAt: event.answeredAt,
      })
      continue
    }

    current.wrongCount += 1
    if (dateKey === todayDateKey) current.todayWrongCount += 1
    incrementDateCount(current.wrongCountByDate, dateKey)
    if (event.answeredAt < current.firstWrongAt) current.firstWrongAt = event.answeredAt
    if (event.answeredAt > current.lastWrongAt) current.lastWrongAt = event.answeredAt
  }

  return [...bySong.values()]
}

function rangeStartDateKey(range: ForgetLyricsRange, todayDateKey: string) {
  return range === '7d' ? shiftBeijingDateKey(todayDateKey, -6) : range === 'today' ? todayDateKey : null
}

export function getForgetLyricsRangeWrongCount(
  aggregate: ForgetLyricsAggregate,
  range: ForgetLyricsRange,
  todayDateKey: string,
) {
  const start = rangeStartDateKey(range, todayDateKey)
  if (!start) return aggregate.wrongCount
  return Object.entries(aggregate.wrongCountByDate)
    .filter(([dateKey]) => dateKey >= start && dateKey <= todayDateKey)
    .reduce((total, [, count]) => total + count, 0)
}

function compareStableId(left: string, right: string) {
  return left === right ? 0 : left < right ? -1 : 1
}

function compareRecent(left: ForgetLyricsAggregate, right: ForgetLyricsAggregate) {
  const byTime = right.lastWrongAt.getTime() - left.lastWrongAt.getTime()
  return byTime || compareStableId(left.songId, right.songId)
}

function compareMost(left: ForgetLyricsAggregate, right: ForgetLyricsAggregate) {
  const byCount = right.wrongCount - left.wrongCount
  return byCount || compareRecent(left, right)
}

/** Homepage order: today's misses, then historical misses, then recency, ID. */
export function sortForgetLyricsHomeAggregates(aggregates: readonly ForgetLyricsAggregate[]) {
  return [...aggregates].sort((left, right) => {
    const byToday = right.todayWrongCount - left.todayWrongCount
    const byHistoricalCount = right.wrongCount - left.wrongCount
    return byToday || byHistoricalCount || compareRecent(left, right)
  })
}

export function selectForgetLyricsAggregates(
  aggregates: readonly ForgetLyricsAggregate[],
  range: ForgetLyricsRange,
  sort: ForgetLyricsSort,
  todayDateKey: string,
  limit?: number,
  home = false,
) {
  const selected = aggregates.filter((aggregate) => getForgetLyricsRangeWrongCount(aggregate, range, todayDateKey) > 0)
  const ordered = home
    ? sortForgetLyricsHomeAggregates(selected)
    : [...selected].sort(sort === 'most' ? compareMost : compareRecent)
  return typeof limit === 'number' ? ordered.slice(0, Math.max(0, limit)) : ordered
}

type ForgetLyricsEventRow = {
  answeredAt: Date | null
  isCorrect: boolean | null
  selectedOptionKey: string | null
  GuessSongSession: { mode: GuessSongMode }
  GuessSongQuestion: { musicSongId: string | null }
}

async function loadForgetLyricsAggregates(userId: string, todayDateKey: string) {
  // This query is intentionally tied to GuessSongSessionQuestion. It does not
  // read GuessSongDuelAnswer, MakeupChallenge, WantListenQuestion, or any
  // future shared answer table.
  const [rows, activeRows] = await Promise.all([
    prisma.guessSongSessionQuestion.findMany({
      where: {
        answeredAt: { not: null },
        isCorrect: false,
        selectedOptionKey: { not: FORGET_LYRICS_SKIPPED_OPTION },
        GuessSongSession: {
          userId,
          isValid: true,
          mode: { in: [...TINGTING_SESSION_MODES] },
        },
        GuessSongQuestion: { musicSongId: { not: null } },
      },
      select: {
        answeredAt: true,
        isCorrect: true,
        selectedOptionKey: true,
        GuessSongSession: { select: { mode: true } },
        GuessSongQuestion: { select: { musicSongId: true } },
      },
    }) as Promise<ForgetLyricsEventRow[]>,
    // Do not let a historical miss reveal the song of a currently unanswered
    // question in an active GuessSongSession.
    prisma.guessSongSessionQuestion.findMany({
      where: {
        answeredAt: null,
        GuessSongSession: {
          userId,
          isValid: true,
          status: { in: ['IN_PROGRESS', 'PAUSED'] },
          mode: { in: [...TINGTING_SESSION_MODES] },
        },
        GuessSongQuestion: { musicSongId: { not: null } },
      },
      select: { GuessSongQuestion: { select: { musicSongId: true } } },
    }),
  ])

  return {
    aggregates: aggregateForgetLyricsEvents(rows.map((row) => ({
      sourceSessionType: TINGTING_SOURCE_SESSION_TYPE,
      gameMode: row.GuessSongSession.mode,
      songId: row.GuessSongQuestion.musicSongId,
      isCorrect: row.isCorrect,
      selectedOptionKey: row.selectedOptionKey,
      answeredAt: row.answeredAt,
    })), todayDateKey),
    blockedSongIds: new Set(activeRows.flatMap((row) => row.GuessSongQuestion.musicSongId ? [row.GuessSongQuestion.musicSongId] : [])),
  }
}

export async function getForgetLyricsData(input: {
  userId: string
  viewer: Pick<SessionUser, 'role' | 'canPlayFullMusic'>
  range?: ForgetLyricsRange
  sort?: ForgetLyricsSort
  limit?: number
  home?: boolean
  now?: Date
}): Promise<ForgetLyricsData> {
  const range = input.range || 'today'
  const sort = input.sort || 'recent'
  const todayDate = getBeijingDateKey(input.now)
  const { aggregates, blockedSongIds } = await loadForgetLyricsAggregates(input.userId, todayDate)
  const visibleAggregates = aggregates.filter((aggregate) => !blockedSongIds.has(aggregate.songId))
  const selected = selectForgetLyricsAggregates(visibleAggregates, range, sort, todayDate, input.limit, input.home)
  if (!selected.length) return { range, sort, todayDate, total: 0, items: [] }

  const songs = await prisma.musicSong.findMany({
    where: {
      id: { in: selected.map((aggregate) => aggregate.songId) },
      MusicAlbum: { status: 'PUBLISHED' },
    },
    select: {
      id: true,
      title: true,
      artist: true,
      coverUrl: true,
      previewUrl: true,
      previewDuration: true,
      sourceAudioPath: true,
      sourceAudioDurationMs: true,
      MusicAlbum: { select: { name: true, artist: true, coverUrl: true } },
    },
  })
  const songsById = new Map(songs.map((song) => [song.id, song]))
  const items = selected.flatMap((aggregate) => {
    const song = songsById.get(aggregate.songId)
    if (!song) return []
    const playback = resolveMusicPlayback(song, input.viewer)
    return [{
      id: song.id,
      title: song.title,
      artist: song.artist || song.MusicAlbum.artist,
      albumName: song.MusicAlbum.name,
      coverUrl: publicImageVariantUrl(song.coverUrl || song.MusicAlbum.coverUrl, 'thumb-sm'),
      previewUrl: playback.previewUrl,
      previewDuration: playback.previewDuration,
      isFullPlayback: playback.isFullPlayback,
      wrongCount: aggregate.wrongCount,
      rangeWrongCount: getForgetLyricsRangeWrongCount(aggregate, range, todayDate),
      todayWrongCount: aggregate.todayWrongCount,
      firstWrongAt: aggregate.firstWrongAt.toISOString(),
      lastWrongAt: aggregate.lastWrongAt.toISOString(),
    }]
  })

  return { range, sort, todayDate, total: items.length, items }
}
