import type { GuessSongPeriodType } from '@prisma/client'
import { getBeijingDateKey } from '@/lib/beijing-time'

const DAY_MS = 86_400_000

function beijingDayStart(value: Date) {
  return new Date(`${getBeijingDateKey(value)}T00:00:00+08:00`)
}

export function getGuessSongPeriod(
  periodType: GuessSongPeriodType,
  value = new Date(),
) {
  const dayStart = beijingDayStart(value)
  if (periodType === 'MONTH') {
    const dateKey = getBeijingDateKey(dayStart)
    const start = new Date(`${dateKey.slice(0, 7)}-01T00:00:00+08:00`)
    const [year, month] = dateKey.split('-').map(Number)
    const nextMonth = month === 12
      ? new Date(`${year + 1}-01-01T00:00:00+08:00`)
      : new Date(`${year}-${String(month + 1).padStart(2, '0')}-01T00:00:00+08:00`)
    return {
      periodKey: dateKey.slice(0, 7),
      start,
      end: nextMonth,
    }
  }

  const weekday = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Shanghai',
    weekday: 'short',
  }).format(dayStart)
  const weekdayIndex = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(weekday)
  const daysSinceMonday = (weekdayIndex + 6) % 7
  const start = new Date(dayStart.getTime() - daysSinceMonday * DAY_MS)
  return {
    periodKey: getBeijingDateKey(start),
    start,
    end: new Date(start.getTime() + 7 * DAY_MS),
  }
}

export function compareGuessSongScores(
  left: {
    score: number
    correctCount: number
    maxStreak: number
    totalPlayCount: number
    achievedAt: Date
  },
  right: {
    score: number
    correctCount: number
    maxStreak: number
    totalPlayCount: number
    achievedAt: Date
  },
) {
  return (
    right.score - left.score
    || right.correctCount - left.correctCount
    || right.maxStreak - left.maxStreak
    || left.totalPlayCount - right.totalPlayCount
    || left.achievedAt.getTime() - right.achievedAt.getTime()
  )
}

export function isGuessSongScoreBetter(
  candidate: Parameters<typeof compareGuessSongScores>[0],
  current: Parameters<typeof compareGuessSongScores>[1],
) {
  return compareGuessSongScores(candidate, current) < 0
}
