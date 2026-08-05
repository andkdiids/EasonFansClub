import { getShanghaiDateKey } from '@/lib/checkin'

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
  const date = new Date(`${value}T00:00:00+08:00`)
  if (Number.isNaN(date.getTime())) return null
  const [year, month, day] = value.split('-').map(Number)
  if (month < 1 || month > 12 || day < 1 || day > 31 || year < 1900 || year > 2200) return null
  const check = new Date(Date.UTC(year, month - 1, day))
  if (check.getUTCFullYear() !== year || check.getUTCMonth() + 1 !== month || check.getUTCDate() !== day) return null
  return { date, month, day, value }
}

export function getTodayMonthDay(now = new Date()) {
  const [, month, day] = getShanghaiDateKey(now).split('-').map(Number)
  return { month, day }
}

export function isTodayEventType(value: unknown): value is TodayEventTypeValue {
  return typeof value === 'string' && todayEventTypes.includes(value as TodayEventTypeValue)
}

export function isTodayEventSource(value: unknown): value is TodayEventSourceValue {
  return value === 'AUTO' || value === 'ADMIN'
}
