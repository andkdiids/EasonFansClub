import { BEIJING_TIME_ZONE, getBeijingDateKey } from '@/lib/beijing-time'

const DAY_MS = 86_400_000

export const GAME_RANKING_RANGE_KEYS = ['this-week', 'last-week', 'this-month', 'last-month', 'date'] as const
export type GameRankingRangeKey = (typeof GAME_RANKING_RANGE_KEYS)[number]

export type GameRankingRange = {
  key: GameRankingRangeKey
  /** Single-day alias retained for legacy callers and URLs. */
  date: string | null
  startDate: string | null
  endDate: string | null
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
  { key: 'last-week', label: '上周' },
  { key: 'this-month', label: '本月' },
  { key: 'last-month', label: '上月' },
  { key: 'date', label: '日期' },
]

export class GameRankingRangeError extends Error {
  readonly status = 400
  readonly code: 'INVALID_RANGE' | 'INVALID_DATE' | 'INVALID_DATE_RANGE' | 'FUTURE_DATE'

  constructor(
    message: string,
    code: 'INVALID_RANGE' | 'INVALID_DATE' | 'INVALID_DATE_RANGE' | 'FUTURE_DATE' = 'INVALID_RANGE',
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
  startDate: string | null = null,
  endDate: string | null = null,
): GameRankingRange {
  return {
    key,
    date,
    startDate,
    endDate,
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

/** Reads the new inclusive range query, while preserving legacy single-date links. */
export function readGameRankingRangeDates(params: URLSearchParams, fallbackDate?: string) {
  const startDate = params.get('startDate')
  const endDate = params.get('endDate')
  if (startDate !== null || endDate !== null) return { startDate, endDate }
  const legacyDate = params.get('date')
  if (legacyDate) return { startDate: legacyDate, endDate: legacyDate }
  return { startDate: fallbackDate || null, endDate: fallbackDate || null }
}

/** Updates the shared query fields and writes `date=` as a legacy alias for single days. */
export function writeGameRankingRangeDates(
  params: URLSearchParams,
  range: GameRankingRangeKey | null,
  startDate: string | null,
  endDate: string | null,
) {
  if (range === 'date' && startDate && endDate) {
    params.set('startDate', startDate)
    params.set('endDate', endDate)
    if (startDate === endDate) params.set('date', startDate)
    else params.delete('date')
    return
  }
  params.delete('date')
  params.delete('startDate')
  params.delete('endDate')
}

/** Accepts the wire values and the uppercase values used by server callers. */
export function parseGameRankingRangeKey(value: unknown): GameRankingRangeKey | null {
  if (isGameRankingRangeKey(value)) return value
  if (value === 'THIS_WEEK') return 'this-week'
  if (value === 'LAST_WEEK') return 'last-week'
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
  startDate?: unknown
  endDate?: unknown
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
    const hasStartDate = input.startDate !== undefined && input.startDate !== null && input.startDate !== ''
    const hasEndDate = input.endDate !== undefined && input.endDate !== null && input.endDate !== ''
    let startDate: unknown
    let endDate: unknown
    if (hasStartDate || hasEndDate) {
      if (!hasStartDate || !hasEndDate) {
        throw new GameRankingRangeError('请选择完整的开始和结束日期。', 'INVALID_DATE_RANGE')
      }
      startDate = input.startDate
      endDate = input.endDate
    } else {
      // Backward compatibility: historical `date=YYYY-MM-DD` URLs remain single-day queries.
      startDate = input.date
      endDate = input.date
    }
    const start = requireDateKey(startDate, todayKey)
    const end = requireDateKey(endDate, todayKey)
    if (start.dateKey > end.dateKey) {
      throw new GameRankingRangeError('结束日期不能早于开始日期。', 'INVALID_DATE_RANGE')
    }
    const singleDate = start.dateKey === end.dateKey ? start.dateKey : null
    const periodKey = singleDate || `${start.dateKey}..${end.dateKey}`
    const label = singleDate
      ? singleDate.replaceAll('-', '/')
      : `${start.dateKey.replaceAll('-', '/')} — ${end.dateKey.replaceAll('-', '/')}`
    return buildRange('date', start.startAt, addDays(end.startAt, 1), periodKey, singleDate, label, start.dateKey, end.dateKey)
  }

  if (key === 'this-week') {
    const startAt = getWeekStart(todayKey)
    const periodKey = getBeijingDateKey(startAt)
    return buildRange('this-week', startAt, addDays(startAt, 7), periodKey, null, '本周')
  }

  if (key === 'last-week') {
    const endAt = getWeekStart(todayKey)
    const startAt = addDays(endAt, -7)
    const startDate = getBeijingDateKey(startAt)
    const endDate = getBeijingDateKey(addDays(endAt, -1))
    return buildRange('last-week', startAt, endAt, startDate, null, '上周', startDate, endDate)
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
    startDate: range.startDate,
    endDate: range.endDate,
    periodKey: range.periodKey,
    label: range.label,
    cacheKey: range.cacheKey,
    startAt: range.startAt.toISOString(),
    endAt: range.endAt.toISOString(),
  }
}

/** Uses the same Shanghai Monday-based calendar week as the existing 本周 range. */
function getWeekStart(dateKey: string) {
  const dayStart = dateKeyToShanghaiStart(dateKey)
  const weekday = new Intl.DateTimeFormat('en-US', {
    timeZone: BEIJING_TIME_ZONE,
    weekday: 'short',
  }).format(dayStart)
  const weekdayIndex = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(weekday)
  return addDays(dayStart, -((weekdayIndex + 6) % 7))
}
