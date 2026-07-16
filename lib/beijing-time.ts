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

export function formatBeijingDateTime(value: string | number | Date = new Date()) {
  return beijingDateTimeFormatter.format(new Date(value))
}

export function formatBeijingMonthDayTime(value: string | number | Date) {
  return beijingMonthDayTimeFormatter.format(new Date(value))
}
