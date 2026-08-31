import { getBeijingDateKey } from '@/lib/beijing-time'
import type { WantListenPeriodType } from '@prisma/client'

const DAY_MS = 86_400_000

/**
 * MONTH is deliberately a read-time period. WantListenLeaderboardEntry keeps
 * its existing DAY/WEEK/ALL Prisma enum and the monthly board is resolved
 * from the timestamped session history, so adding the board does not require
 * a schema change or a write-time backfill.
 */
export type WantListenLeaderboardPeriodType = WantListenPeriodType | 'MONTH'

export class WantListenPeriodError extends Error {
  readonly status = 400
  readonly code = 'INVALID_PERIOD'

  constructor() {
    super('请选择有效的想听排行榜周期')
    this.name = 'WantListenPeriodError'
  }
}

export function getWantListenPeriod(periodType: WantListenLeaderboardPeriodType, value = new Date()) {
  if (periodType === 'ALL') return { periodKey: 'ALL', start: null, end: null, endExclusive: null }

  const dateKey = getBeijingDateKey(value)
  const dayStart = new Date(`${dateKey}T00:00:00+08:00`)
  if (periodType === 'DAY') {
    const end = new Date(dayStart.getTime() + DAY_MS)
    return { periodKey: dateKey, start: dayStart, end, endExclusive: end }
  }
  if (periodType === 'MONTH') {
    const [year, month] = dateKey.split('-').map(Number)
    const start = new Date(`${dateKey.slice(0, 7)}-01T00:00:00+08:00`)
    const end = month === 12
      ? new Date(`${year + 1}-01-01T00:00:00+08:00`)
      : new Date(`${year}-${String(month + 1).padStart(2, '0')}-01T00:00:00+08:00`)
    return { periodKey: dateKey.slice(0, 7), start, end, endExclusive: end }
  }
  if (periodType !== 'WEEK') throw new WantListenPeriodError()

  const weekday = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Shanghai', weekday: 'short' }).format(dayStart)
  const weekdayIndex = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(weekday)
  const daysSinceMonday = (weekdayIndex + 6) % 7
  const start = new Date(dayStart.getTime() - daysSinceMonday * DAY_MS)
  const end = new Date(start.getTime() + 7 * DAY_MS)
  return { periodKey: getBeijingDateKey(start), start, end, endExclusive: end }
}

export function parseWantListenPeriod(value: unknown): WantListenPeriodType {
  if (value === undefined || value === null || value === '' || value === 'WEEK') return 'WEEK'
  if (value === 'TODAY' || value === 'DAY') return 'DAY'
  if (value === 'ALL') return 'ALL'
  throw new WantListenPeriodError()
}

/** Public game leaderboard parser, including the read-time natural month. */
export function parseWantListenLeaderboardPeriod(value: unknown): WantListenLeaderboardPeriodType {
  if (value === 'MONTH') return 'MONTH'
  return parseWantListenPeriod(value)
}

export function compareWantListenScores(
  left: { score: number; correctCount: number; maxStreak: number; completionTimeMs: number; achievedAt: Date },
  right: { score: number; correctCount: number; maxStreak: number; completionTimeMs: number; achievedAt: Date },
) {
  return right.score - left.score
    || right.correctCount - left.correctCount
    || right.maxStreak - left.maxStreak
    || left.completionTimeMs - right.completionTimeMs
    || left.achievedAt.getTime() - right.achievedAt.getTime()
}

export function isWantListenScoreBetter(
  candidate: Parameters<typeof compareWantListenScores>[0],
  current: Parameters<typeof compareWantListenScores>[1],
) {
  return compareWantListenScores(candidate, current) < 0
}
