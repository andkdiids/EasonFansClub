import type { GuessSongPeriodType, WantListenMode } from '@prisma/client'
import { BEIJING_TIME_ZONE } from '@/lib/beijing-time'
import { getGuessSongPeriod } from '@/lib/guess-song-period'
import { getGuessSongLeaderboard } from '@/lib/guess-song-leaderboard'
import { getWantListenLeaderboard } from '@/lib/want-listen-leaderboard'
import { getWantListenPeriod } from '@/lib/want-listen-period'
import {
  getEntertainmentLeaderboardDefinition,
  type EntertainmentLeaderboardDefinition,
  type EntertainmentLeaderboardPeriod,
} from '@/lib/entertainment-leaderboard-registry'
import type { EquippedBadgeView } from '@/lib/badge-types'
import {
  GameRankingRangeError,
  resolveGameRankingRange,
  type GameRankingRange,
  type GameRankingRangeKey,
} from '@/lib/game-ranking-range'

export class EntertainmentLeaderboardError extends Error {
  readonly status: number
  readonly code: string

  constructor(message: string, status = 400, code = 'INVALID_LEADERBOARD_REQUEST') {
    super(message)
    this.name = 'EntertainmentLeaderboardError'
    this.status = status
    this.code = code
  }
}

export type EntertainmentLeaderboardRow = {
  rank: number
  user: {
    id: string
    uid: number
    nickname: string
    displayName: string
    avatarUrl: string | null
    equippedBadge?: EquippedBadgeView | null
  }
  primaryValue: number
  primaryLabel: string
  secondary: Array<{ value: number | string; label: string }>
  achievedAt: string
}

export type EntertainmentLeaderboardResult = {
  status: 'ready' | 'empty' | 'unavailable'
  gameKey: string
  gameName: string
  route: string
  mode: string | null
  period: EntertainmentLeaderboardPeriod | null
  periodLabel: string | null
  periodKey: string | null
  rangeKey: GameRankingRangeKey | null
  rangeDate: string | null
  rangeLabel: string | null
  cacheKey: string | null
  rows: EntertainmentLeaderboardRow[]
  unavailableReason?: string
}

const BUSINESS_TIME_ZONE = BEIJING_TIME_ZONE

function formatBusinessDate(value: Date) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: BUSINESS_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(value)
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]))
  return `${values.year}.${values.month}.${values.day}`
}

export function formatLeaderboardRange(start: Date | null, endExclusive: Date | null) {
  if (!start || !endExclusive) return '历史累计'
  const inclusiveEnd = new Date(endExclusive.getTime() - 1)
  const startLabel = formatBusinessDate(start)
  const endLabel = formatBusinessDate(inclusiveEnd)
  return startLabel === endLabel ? startLabel : `${startLabel} — ${endLabel}`
}

function periodDefinition(definition: EntertainmentLeaderboardDefinition, period: EntertainmentLeaderboardPeriod) {
  return definition.periods.find((item) => item.key === period) || null
}

function resolvePeriod(definition: EntertainmentLeaderboardDefinition, value: unknown) {
  if (!definition.periods.length) return null
  const requested = typeof value === 'string' && periodDefinition(definition, value as EntertainmentLeaderboardPeriod)
    ? value as EntertainmentLeaderboardPeriod
    : definition.defaultPeriod
  if (!requested) throw new EntertainmentLeaderboardError('该游戏暂未开放排行榜', 404, 'LEADERBOARD_UNAVAILABLE')
  const selected = periodDefinition(definition, requested)
  if (!selected) throw new EntertainmentLeaderboardError('请选择有效排行榜周期')
  return { key: requested, label: selected.label }
}

function resolveMode(definition: EntertainmentLeaderboardDefinition, value: unknown) {
  if (!definition.modes) {
    if (value !== undefined && value !== null && value !== '') {
      throw new EntertainmentLeaderboardError('该游戏不支持排行榜子模式')
    }
    return null
  }
  if (typeof value === 'string' && definition.modes.some((item) => item.key === value)) return value
  if (definition.defaultMode) return definition.defaultMode
  throw new EntertainmentLeaderboardError('请选择有效排行榜模式')
}

function resolvedRange(definition: EntertainmentLeaderboardDefinition, period: EntertainmentLeaderboardPeriod, now: Date) {
  if (definition.source === 'want-listen') {
    const range = getWantListenPeriod(period as 'DAY' | 'WEEK' | 'MONTH' | 'ALL', now)
    return { start: range.start, endExclusive: range.endExclusive }
  }
  if (definition.source === 'guess-song') {
    const range = getGuessSongPeriod(period as GuessSongPeriodType | 'YEAR', now)
    return { start: range.start, endExclusive: range.end }
  }
  return { start: null, endExclusive: null }
}

function wantListenRows(rows: Awaited<ReturnType<typeof getWantListenLeaderboard>>['rows']): EntertainmentLeaderboardRow[] {
  return rows.map((row) => ({
    rank: row.rank,
    user: {
      id: row.user.id,
      uid: row.user.uid,
      nickname: row.user.nickname,
      displayName: row.user.displayName,
      avatarUrl: row.user.avatarUrl,
      equippedBadge: row.user.equippedBadge,
    },
    primaryValue: row.score,
    primaryLabel: '分数',
    secondary: [
      { value: row.correctCount, label: '答对' },
      { value: row.maxStreak ?? '—', label: '最高连击' },
    ],
    achievedAt: row.achievedAt,
  }))
}

function guessSongRows(rows: Awaited<ReturnType<typeof getGuessSongLeaderboard>>['rows']): EntertainmentLeaderboardRow[] {
  return rows.map((row) => ({
    rank: row.rank,
    user: {
      id: row.userId,
      uid: row.uid,
      nickname: row.nickname,
      displayName: row.nickname,
      avatarUrl: row.avatarUrl,
      equippedBadge: row.equippedBadge,
    },
    primaryValue: row.score,
    primaryLabel: '最高分',
    secondary: [
      { value: row.correctCount, label: '答对' },
      { value: row.maxStreak, label: '最高连击' },
    ],
    achievedAt: row.achievedAt,
  }))
}

function unavailableResult(definition: EntertainmentLeaderboardDefinition): EntertainmentLeaderboardResult {
  return {
    status: 'unavailable',
    gameKey: definition.gameKey,
    gameName: definition.name,
    route: definition.route,
    mode: null,
    period: null,
    periodLabel: null,
    periodKey: null,
    rangeKey: null,
    rangeDate: null,
    rangeLabel: null,
    cacheKey: null,
    rows: [],
    unavailableReason: '该游戏暂未开放排行榜',
  }
}

/**
 * The single server adapter used by the entertainment home and existing game
 * leaderboard services. Unsupported games still return a stable unavailable
 * state, so one missing leaderboard cannot blank the entire hall.
 */
export async function getEntertainmentLeaderboard(input: {
  gameKey: unknown
  mode?: unknown
  period?: unknown
  range?: unknown
  date?: unknown
  userId: string
  limit?: number
  now?: Date
}): Promise<EntertainmentLeaderboardResult> {
  const definition = getEntertainmentLeaderboardDefinition(input.gameKey)
  if (!definition) throw new EntertainmentLeaderboardError('请选择有效的娱乐天空游戏')

  const mode = resolveMode(definition, input.mode)
  if (!definition.source || definition.ranges.length === 0) return unavailableResult(definition)

  const now = input.now || new Date()
  const hasUnifiedRange = input.range !== undefined && input.range !== null && input.range !== ''
  let unifiedRange: GameRankingRange | null = null
  if (hasUnifiedRange) {
    try {
      unifiedRange = resolveGameRankingRange({ range: input.range, date: input.date, now })
    } catch (error) {
      if (error instanceof GameRankingRangeError) throw new EntertainmentLeaderboardError(error.message, error.status, error.code)
      throw error
    }
  }
  const period = unifiedRange
    ? null
    : resolvePeriod(definition, input.period)
  if (!period && !unifiedRange) return unavailableResult(definition)

  const range = unifiedRange
    ? { start: unifiedRange.startAt, endExclusive: unifiedRange.endAt }
    : resolvedRange(definition, period!.key, now)
  const resultPeriod = unifiedRange
    ? unifiedRange.key === 'date' ? 'DAY' : unifiedRange.key === 'this-month' || unifiedRange.key === 'last-month' ? 'MONTH' : 'WEEK'
    : period!.key
  const resultPeriodLabel = unifiedRange?.label || period?.label || null
  if (definition.source === 'want-listen') {
    const result = await getWantListenLeaderboard({
      mode: definition.sourceMode as WantListenMode,
      period: unifiedRange ? undefined : period!.key,
      range: unifiedRange?.key,
      date: unifiedRange?.date || undefined,
      userId: input.userId,
      limit: input.limit || 10,
      now,
    })
    const rows = wantListenRows(result.rows)
    return {
      status: rows.length ? 'ready' : 'empty',
      gameKey: definition.gameKey,
      gameName: definition.name,
      route: definition.route,
      mode: null,
      period: resultPeriod,
      periodLabel: resultPeriodLabel,
      periodKey: result.periodKey,
      rangeLabel: formatLeaderboardRange(range.start, range.endExclusive),
      rangeKey: result.rangeKey,
      rangeDate: result.rangeDate,
      cacheKey: result.cacheKey,
      rows,
    }
  }

  const result = await getGuessSongLeaderboard({
    userId: input.userId,
    periodType: resultPeriod as GuessSongPeriodType | 'YEAR',
    mode: mode as 'EASY' | 'ADVANCED' | 'HARD' | 'EXPERT',
    range: unifiedRange?.key,
    date: unifiedRange?.date || undefined,
    now,
  })
  const rows = guessSongRows(result.rows)
  return {
    status: rows.length ? 'ready' : 'empty',
    gameKey: definition.gameKey,
    gameName: definition.name,
    route: definition.route,
    mode,
    period: resultPeriod,
    periodLabel: resultPeriodLabel,
    periodKey: result.periodKey,
    rangeLabel: formatLeaderboardRange(range.start, range.endExclusive),
    rangeKey: result.rangeKey,
    rangeDate: result.rangeDate,
    cacheKey: result.cacheKey,
    rows,
  }
}
