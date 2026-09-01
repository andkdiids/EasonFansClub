import { BEIJING_TIME_ZONE, getBeijingDateKey } from '@/lib/beijing-time'

const DAY_MS = 86_400_000

export const GAME_RANKING_RANGE_KEYS = ['this-week', 'this-month', 'last-month', 'date'] as const
export type GameRankingRangeKey = (typeof GAME_RANKING_RANGE_KEYS)[number]

export type GameRankingRange = {
  key: GameRankingRangeKey
  /** DATE only. Presets keep their date in periodKey. */
  date: string | null
  /** The business range is left-closed and right-open. */
  startAt: Date
  endAt: Date
  periodKey: string
  label: string
  cacheKey: string
}

export type GameRankingRangeOption = {
  key: GameRankingRangeKey
  label: string
}

export const GAME_RANKING_RANGE_OPTIONS: readonly GameRankingRangeOption[] = [
  { key: 'this-week', label: '本周' },
  { key: 'this-month', label: '本月' },
  { key: 'last-month', label: '上月' },
  { key: 'date', label: '日期' },
]

export class GameRankingRangeError extends Error {
  readonly status = 400
  readonly code: 'INVALID_RANGE' | 'INVALID_DATE' | 'FUTURE_DATE'

  constructor(
    message: string,
    code: 'INVALID_RANGE' | 'INVALID_DATE' | 'FUTURE_DATE' = 'INVALID_RANGE',
  ) {
    super(message)
    this.name = 'GameRankingRangeError'
    this.code = code
  }
}

function dateKeyToShanghaiStart(dateKey: string) {
  return new Date(`${dateKey}T00:00:00+08:00`)
}

function dateKeyParts(dateKey: string) {
  const [year, month, day] = dateKey.split('-').map(Number)
  return { year, month, day }
}

function isValidDateKey(dateKey: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) return false
  const { year, month, day } = dateKeyParts(dateKey)
  if (year < 1 || month < 1 || month > 12 || day < 1) return false
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate()
  return day <= daysInMonth
}

function requireDateKey(value: unknown, todayKey: string) {
  if (typeof value !== 'string' || !isValidDateKey(value)) {
    throw new GameRankingRangeError('日期格式无效，请选择 YYYY-MM-DD。', 'INVALID_DATE')
  }
  // The fixed +08:00 conversion is safe here because the business timezone
  // has no DST transitions and keeps the SQL boundary deterministic.
  const startAt = dateKeyToShanghaiStart(value)
  if (Number.isNaN(startAt.getTime()) || getBeijingDateKey(startAt) !== value) {
    throw new GameRankingRangeError('日期格式无效，请选择 YYYY-MM-DD。', 'INVALID_DATE')
  }
  if (value > todayKey) {
    throw new GameRankingRangeError('不能选择未来日期。', 'FUTURE_DATE')
  }
  return { dateKey: value, startAt }
}

function addDays(startAt: Date, days: number) {
  return new Date(startAt.getTime() + days * DAY_MS)
}

function monthStart(year: number, month: number) {
  return dateKeyToShanghaiStart(`${year}-${String(month).padStart(2, '0')}-01`)
}

function nextMonthStart(year: number, month: number) {
  return month === 12 ? monthStart(year + 1, 1) : monthStart(year, month + 1)
}

function buildRange(
  key: GameRankingRangeKey,
  startAt: Date,
  endAt: Date,
  periodKey: string,
  date: string | null,
  label: string,
): GameRankingRange {
  return {
    key,
    date,
    startAt,
    endAt,
    periodKey,
    label,
    cacheKey: `${key}:${periodKey}`,
  }
}

export function isGameRankingRangeKey(value: unknown): value is GameRankingRangeKey {
  return typeof value === 'string' && (GAME_RANKING_RANGE_KEYS as readonly string[]).includes(value)
}

/** Accepts the wire values and the uppercase values used by server callers. */
export function parseGameRankingRangeKey(value: unknown): GameRankingRangeKey | null {
  if (isGameRankingRangeKey(value)) return value
  if (value === 'THIS_WEEK') return 'this-week'
  if (value === 'THIS_MONTH') return 'this-month'
  if (value === 'LAST_MONTH') return 'last-month'
  if (value === 'DATE') return 'date'
  return null
}

export function getGameRankingTodayKey(now = new Date()) {
  return getBeijingDateKey(now)
}

/**
 * Resolve all public game-ranking windows on the server in Asia/Shanghai.
 * Preset ranges intentionally use complete calendar boundaries, preserving
 * the existing Monday-based week semantics and avoiding client clock drift.
 * `endAt` is exclusive for every range.
 */
export function resolveGameRankingRange(input: {
  range?: unknown
  date?: unknown
  now?: Date
} = {}): GameRankingRange {
  const now = input.now || new Date()
  if (Number.isNaN(now.getTime())) throw new GameRankingRangeError('排行榜时间无效。')
  const key = input.range === undefined || input.range === null || input.range === ''
    ? 'this-week'
    : parseGameRankingRangeKey(input.range)
  if (!key) throw new GameRankingRangeError('请选择有效排行榜时间范围。')

  const todayKey = getGameRankingTodayKey(now)
  const { year, month } = dateKeyParts(todayKey)

  if (key === 'date') {
    const selected = requireDateKey(input.date, todayKey)
    return buildRange('date', selected.startAt, addDays(selected.startAt, 1), selected.dateKey, selected.dateKey, selected.dateKey)
  }

  if (key === 'this-week') {
    const dayStart = dateKeyToShanghaiStart(todayKey)
    const weekday = new Intl.DateTimeFormat('en-US', {
      timeZone: BEIJING_TIME_ZONE,
      weekday: 'short',
    }).format(dayStart)
    const weekdayIndex = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(weekday)
    const daysSinceMonday = (weekdayIndex + 6) % 7
    const startAt = addDays(dayStart, -daysSinceMonday)
    const periodKey = getBeijingDateKey(startAt)
    return buildRange('this-week', startAt, addDays(startAt, 7), periodKey, null, '本周')
  }

  const thisMonthStart = monthStart(year, month)
  if (key === 'this-month') {
    return buildRange('this-month', thisMonthStart, nextMonthStart(year, month), `${year}-${String(month).padStart(2, '0')}`, null, '本月')
  }

  const previousMonth = month === 1 ? { year: year - 1, month: 12 } : { year, month: month - 1 }
  const startAt = monthStart(previousMonth.year, previousMonth.month)
  return buildRange(
    'last-month',
    startAt,
    thisMonthStart,
    `${previousMonth.year}-${String(previousMonth.month).padStart(2, '0')}`,
    null,
    '上月',
  )
}

export function serializeGameRankingRange(range: GameRankingRange) {
  return {
    key: range.key,
    date: range.date,
    periodKey: range.periodKey,
    label: range.label,
    cacheKey: range.cacheKey,
    startAt: range.startAt.toISOString(),
    endAt: range.endAt.toISOString(),
  }
}
