import { BEIJING_TIME_ZONE } from '@/lib/beijing-time'

const datePartsFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: BEIJING_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
})

export function formatBeijingDate(date = new Date()) {
  const parts = datePartsFormatter.formatToParts(date)
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]))
  return `${values.year}-${values.month}-${values.day}`
}

export const getShanghaiDateKey = formatBeijingDate

export function normalizeCheckinDateToShanghai(date = new Date()) {
  const parsed = parseBeijingDate(getShanghaiDateKey(date))

  if (parsed) return parsed

  return new Date('1974-07-27T00:00:00+08:00')
}

export function getShanghaiDayRange(date = new Date()) {
  const start = normalizeCheckinDateToShanghai(date)
  return { start, end: new Date(start.getTime() + 24 * 60 * 60 * 1000), dateKey: getShanghaiDateKey(date) }
}

export function shiftShanghaiDateKey(value: string, days: number) {
  const date = parseBeijingDate(value)
  if (!date) return value
  return getShanghaiDateKey(new Date(date.getTime() + days * 24 * 60 * 60 * 1000))
}

export function calculateCheckinStreaks(dateKeys: Iterable<string>, now = new Date()) {
  const uniqueKeys = new Set([...dateKeys].filter((value) => /^\d{4}-\d{2}-\d{2}$/.test(value)))
  const today = getShanghaiDateKey(now)
  
  const currentStart = uniqueKeys.has(today) ? today : shiftShanghaiDateKey(today, -1)
  let currentStreak = 0

for (
  let key = currentStart;
  uniqueKeys.has(key);
  key = shiftShanghaiDateKey(key, -1)
) {
  currentStreak += 1
}

  const sorted = [...uniqueKeys].sort()
  let longestStreak = 0
  let running = 0
  let previous: string | null = null
  sorted.forEach((key) => {
    running = previous && shiftShanghaiDateKey(previous, 1) === key ? running + 1 : 1
    longestStreak = Math.max(longestStreak, running)
    previous = key
  })
  return { currentStreak, longestStreak, totalDays: uniqueKeys.size }
}

export function parseBeijingDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null
  const date = new Date(`${value}T00:00:00+08:00`)
  return Number.isNaN(date.getTime()) ? null : date
}

export function startOfLocalDay(date = new Date()) {
  const key = formatBeijingDate(date)

  return new Date(`${key}T00:00:00+08:00`)
}

export function startOfYesterday(date = new Date()) {
  const today = startOfLocalDay(date)
  return new Date(today.getTime() - 24 * 60 * 60 * 1000)
}

export function isSameLocalDay(a?: Date | null, b = new Date()) {
  if (!a) return false
  return startOfLocalDay(a).getTime() === startOfLocalDay(b).getTime()
}
