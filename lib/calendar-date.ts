import { getBeijingDateKey } from '@/lib/beijing-time'

const CALENDAR_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/

export type CalendarDateParts = {
  key: string
  year: number
  month: number
  day: number
}

function partsFromKey(key: string): CalendarDateParts {
  const match = key.match(CALENDAR_DATE_PATTERN)
  if (!match) throw new RangeError(`无效的日历日期：${key}`)

  const [, yearText, monthText, dayText] = match
  const year = Number(yearText)
  const month = Number(monthText)
  const day = Number(dayText)
  const check = new Date(Date.UTC(year, month - 1, day))
  if (check.getUTCFullYear() !== year || check.getUTCMonth() + 1 !== month || check.getUTCDate() !== day) {
    throw new RangeError(`无效的日历日期：${key}`)
  }

  return { key, year, month, day }
}

/**
 * 将纯日期或带时区的时间值统一转换成北京时间日历日期。
 * 纯日期字符串不会经过 Date/UTC 转换，避免 2026-08-11 被格式化成 8 月 10 日。
 */
export function toCalendarDateKey(value: string | Date) {
  if (typeof value === 'string' && CALENDAR_DATE_PATTERN.test(value)) return partsFromKey(value).key

  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) throw new RangeError('无效的日历日期值')
  return getBeijingDateKey(date)
}

export function parseCalendarDate(value: string | Date): CalendarDateParts {
  return partsFromKey(toCalendarDateKey(value))
}

export function formatCalendarDate(value: string | Date) {
  const { year, month, day } = parseCalendarDate(value)
  return `${year}年${String(month).padStart(2, '0')}月${String(day).padStart(2, '0')}日`
}
