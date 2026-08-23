import { getBeijingDateKey } from '@/lib/beijing-time'

const DATE_KEY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/

export type CheckInHistoryMonthRecord = {
  id: string
  dateKey: string
  mood: string | null
  moodType?: string | null
  moodEmoji?: string | null
  moodText?: string | null
  hasMessage: boolean
  type?: 'NORMAL' | 'MAKEUP_FREE_QUIZ' | 'MAKEUP_PAID' | 'MAKEUP_ADMIN'
}

export type CheckInHistoryDetail = {
  id: string
  dateKey: string
  mood: string | null
  moodType?: string | null
  moodEmoji?: string | null
  moodText?: string | null
  message: string | null
  createdAt: string
  points: number
  exp: number
  streakDay: number
  type?: 'NORMAL' | 'MAKEUP_FREE_QUIZ' | 'MAKEUP_PAID' | 'MAKEUP_ADMIN'
  madeUpAt?: string | null
  makeupCost?: number | null
}

export type CheckInCalendarCell = {
  key: string
  year: number
  month: number
  day: number
  isCurrentMonth: boolean
}

export function padCheckInMonth(value: number) {
  return String(value).padStart(2, '0')
}

export function getCheckInMonthKey(year: number, month: number) {
  return `${year}-${padCheckInMonth(month)}`
}

export function parseCheckInDateKey(value: string | null | undefined) {
  if (!value) return null
  const match = value.match(DATE_KEY_PATTERN)
  if (!match) return null
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return null
  const check = new Date(Date.UTC(year, month - 1, day))
  if (check.getUTCFullYear() !== year || check.getUTCMonth() + 1 !== month || check.getUTCDate() !== day) return null
  return { key: value, year, month, day }
}

export function parseCheckInMonth(value: string | null | undefined) {
  if (!value) return null
  const match = value.match(/^(\d{4})-(\d{2})$/)
  if (!match) return null
  const year = Number(match[1])
  const month = Number(match[2])
  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) return null
  return { year, month }
}

export function getCurrentCheckInMonth(now = new Date()) {
  const dateKey = getBeijingDateKey(now)
  const parsed = parseCheckInDateKey(dateKey)
  if (!parsed) throw new RangeError('无法解析北京时间日期')
  return { year: parsed.year, month: parsed.month, dateKey: parsed.key }
}

export function getCheckInMonthBounds(year: number, month: number) {
  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) {
    throw new RangeError('无效的挂号记录月份')
  }
  const nextYear = month === 12 ? year + 1 : year
  const nextMonth = month === 12 ? 1 : month + 1
  return {
    startKey: `${year}-${padCheckInMonth(month)}-01`,
    endKey: `${nextYear}-${padCheckInMonth(nextMonth)}-01`,
  }
}

export function shiftCheckInMonth(year: number, month: number, offset: number) {
  const index = year * 12 + (month - 1) + Math.trunc(offset)
  const nextYear = Math.floor(index / 12)
  const nextMonth = ((index % 12) + 12) % 12 + 1
  return { year: nextYear, month: nextMonth }
}

export function compareCheckInMonths(left: { year: number; month: number }, right: { year: number; month: number }) {
  return left.year * 12 + left.month - (right.year * 12 + right.month)
}

function dateKeyFromUtcDate(date: Date) {
  return `${date.getUTCFullYear()}-${padCheckInMonth(date.getUTCMonth() + 1)}-${String(date.getUTCDate()).padStart(2, '0')}`
}

export function getCheckInCalendarCells(year: number, month: number): CheckInCalendarCell[] {
  const firstDay = new Date(Date.UTC(year, month - 1, 1))
  const firstWeekday = firstDay.getUTCDay()
  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(Date.UTC(year, month - 1, 1 - firstWeekday + index))
    return {
      key: dateKeyFromUtcDate(date),
      year: date.getUTCFullYear(),
      month: date.getUTCMonth() + 1,
      day: date.getUTCDate(),
      isCurrentMonth: date.getUTCFullYear() === year && date.getUTCMonth() + 1 === month,
    }
  })
}
