import { getBeijingDateKey } from '@/lib/beijing-time'
import type { WantListenPeriodType } from '@prisma/client'

const DAY_MS = 86_400_000

export function getWantListenPeriod(periodType: WantListenPeriodType, value = new Date()) {
  if (periodType === 'ALL') return { periodKey: 'ALL', start: null, end: null }

  const dateKey = getBeijingDateKey(value)
  const dayStart = new Date(`${dateKey}T00:00:00+08:00`)
  if (periodType === 'DAY') {
    return { periodKey: dateKey, start: dayStart, end: new Date(dayStart.getTime() + DAY_MS) }
  }

  const weekday = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Shanghai', weekday: 'short' }).format(dayStart)
  const weekdayIndex = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(weekday)
  const daysSinceMonday = (weekdayIndex + 6) % 7
  const start = new Date(dayStart.getTime() - daysSinceMonday * DAY_MS)
  return { periodKey: getBeijingDateKey(start), start, end: new Date(start.getTime() + 7 * DAY_MS) }
}

export function parseWantListenPeriod(value: unknown): WantListenPeriodType {
  return value === 'TODAY' || value === 'DAY' ? 'DAY' : value === 'ALL' ? 'ALL' : 'WEEK'
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
