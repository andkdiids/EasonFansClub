import { parseCalendarDate, toCalendarDateKey, type CalendarDateParts } from '@/lib/calendar-date'

export const todayEventTypes = ['ALBUM', 'CONCERT', 'SONG', 'CAREER', 'AWARD', 'CUSTOM', 'BIRTHDAY', 'DEBUT', 'ROOKIE_CONTEST', 'ALBUM_RELEASE', 'OTHER'] as const
export type TodayEventTypeValue = typeof todayEventTypes[number]

export const todayEventFormTypes = ['ALBUM', 'CONCERT', 'SONG', 'CAREER', 'AWARD', 'CUSTOM'] as const

export const todayEventTypeLabels: Record<TodayEventTypeValue, string> = {
  ALBUM: '专辑发行',
  CONCERT: '演唱会',
  SONG: '歌曲发行',
  CAREER: '事业节点',
  AWARD: '获奖',
  CUSTOM: '自定义',
  BIRTHDAY: '生日',
  DEBUT: '出道',
  ROOKIE_CONTEST: '新秀比赛',
  ALBUM_RELEASE: '专辑发行',
  OTHER: '其他',
}

export const todayEventSourceLabels = {
  AUTO: '自动生成',
  ADMIN: '后台添加',
} as const

export type TodayEventSourceValue = keyof typeof todayEventSourceLabels

export function parseTodayDate(value: unknown) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null
  const [year, month, day] = value.split('-').map(Number)
  if (month < 1 || month > 12 || day < 1 || day > 31 || year < 1900 || year > 2200) return null
  const check = new Date(Date.UTC(year, month - 1, day))
  if (check.getUTCFullYear() !== year || check.getUTCMonth() + 1 !== month || check.getUTCDate() !== day) return null
  // Prisma 的 @db.Date 仍接收 JS Date；使用 UTC 零点让 MySQL DATE 保留输入的日历日期。
  const date = new Date(Date.UTC(year, month - 1, day))
  return { date, month, day, value }
}

export function getTodayMonthDay(now = new Date()) {
  const [, month, day] = toCalendarDateKey(now).split('-').map(Number)
  return { month, day }
}

/**
 * 兼容修复前写入的 TodayEvent：date 可能落后一天，但 month/day 仍是用户选择的日期。
 * 不修改历史数据，只在读取时恢复其原本的日历日期。
 */
export function getTodayEventDateParts(value: Date, month: number, day: number): CalendarDateParts {
  const stored = parseCalendarDate(value)
  if (stored.month === month && stored.day === day) return stored

  const storedOrdinal = Date.UTC(stored.year, stored.month - 1, stored.day)
  for (const year of [stored.year - 1, stored.year, stored.year + 1]) {
    const targetOrdinal = Date.UTC(year, month - 1, day)
    if (targetOrdinal - storedOrdinal === 86_400_000) {
      const key = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
      return { key, year, month, day }
    }
  }

  const key = `${stored.year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
  return { key, year: stored.year, month, day }
}

export function getTodayEventDateKey(value: Date, month: number, day: number) {
  return getTodayEventDateParts(value, month, day).key
}

export function isTodayEventType(value: unknown): value is TodayEventTypeValue {
  return typeof value === 'string' && todayEventTypes.includes(value as TodayEventTypeValue)
}

export function isTodayEventSource(value: unknown): value is TodayEventSourceValue {
  return value === 'AUTO' || value === 'ADMIN'
}
