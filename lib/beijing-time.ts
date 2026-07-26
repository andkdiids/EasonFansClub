export const BEIJING_TIME_ZONE = 'Asia/Shanghai'

const beijingDateTimeFormatter = new Intl.DateTimeFormat('zh-CN', {
  timeZone: BEIJING_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
})

const beijingMonthDayTimeFormatter = new Intl.DateTimeFormat('zh-CN', {
  timeZone: BEIJING_TIME_ZONE,
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
})

const beijingDateTimeMinuteFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: BEIJING_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
})

const beijingDateFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: BEIJING_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
})

export function formatBeijingDateTime(value: string | number | Date = new Date()) {
  return beijingDateTimeFormatter.format(new Date(value))
}

export function formatBeijingMonthDayTime(value: string | number | Date) {
  return beijingMonthDayTimeFormatter.format(new Date(value))
}

export function formatBeijingDateTimeMinute(value: string | number | Date) {
  const parts = beijingDateTimeMinuteFormatter.formatToParts(new Date(value))
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]))
  return `${values.year}-${values.month}-${values.day} ${values.hour}:${values.minute}`
}

export function getBeijingDateKey(value: string | number | Date = new Date()) {
  const parts = beijingDateFormatter.formatToParts(new Date(value))
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]))
  return `${values.year}-${values.month}-${values.day}`
}

export function shiftBeijingDateKey(dateKey: string, days: number) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) return dateKey
  const date = new Date(`${dateKey}T00:00:00+08:00`)
  if (Number.isNaN(date.getTime())) return dateKey
  return getBeijingDateKey(new Date(date.getTime() + days * 86_400_000))
}
