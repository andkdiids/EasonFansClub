import type { GuessSongMode, GuessSongPeriodType } from '@prisma/client'
import { getBeijingDateKey } from '@/lib/beijing-time'
import { toPublicGuessSongMode } from '@/lib/guess-song-config'

const DAY_MS = 86_400_000

function beijingDayStart(value: Date) {
  return new Date(`${getBeijingDateKey(value)}T00:00:00+08:00`)
}

export function getGuessSongPeriod(
  periodType: GuessSongPeriodType | 'YEAR',
  value = new Date(),
) {
  const dayStart = beijingDayStart(value)
  if (periodType === 'YEAR') {
    const year = Number(getBeijingDateKey(dayStart).slice(0, 4))
    const start = new Date(`${year}-01-01T00:00:00+08:00`)
    return {
      periodKey: String(year),
      start,
      end: new Date(`${year + 1}-01-01T00:00:00+08:00`),
    }
  }
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

type GuessSongRankableRow = {
  userId: string
  mode?: GuessSongMode
  score: number
  correctCount: number
  maxStreak: number
  totalPlayCount: number
  achievedAt: Date
}

/**
 * Canonicalizes legacy ENDLESS rows, then selects one best row per user.
 *
 * EASY reads include physical EASY and ENDLESS records for backward
 * compatibility. This function must run on the complete candidate set before
 * a caller applies its public TopN limit.
 */
export function selectBestGuessSongRows<T extends GuessSongRankableRow>(rows: readonly T[]) {
  const bestByUser = new Map<string, T>()
  for (const row of rows) {
    const candidate = row.mode === 'ENDLESS'
      ? { ...row, mode: toPublicGuessSongMode(row.mode) as GuessSongMode } as T
      : row
    const current = bestByUser.get(candidate.userId)
    if (!current || compareGuessSongScores(candidate, current) < 0) bestByUser.set(candidate.userId, candidate)
  }
  return [...bestByUser.values()].sort(compareGuessSongScores)
}

export function isGuessSongScoreBetter(
  candidate: Parameters<typeof compareGuessSongScores>[0],
  current: Parameters<typeof compareGuessSongScores>[1],
) {
  return compareGuessSongScores(candidate, current) < 0
}
