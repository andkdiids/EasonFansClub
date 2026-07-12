const beijingTimeZone = 'Asia/Shanghai'
const datePartsFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: beijingTimeZone,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
})

export function formatBeijingDate(date = new Date()) {
  const parts = datePartsFormatter.formatToParts(date)
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]))
  return `${values.year}-${values.month}-${values.day}`
}

export function parseBeijingDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null
  const date = new Date(`${value}T00:00:00+08:00`)
  return Number.isNaN(date.getTime()) ? null : date
}

export function startOfLocalDay(date = new Date()) {
  return parseBeijingDate(formatBeijingDate(date)) || new Date()
}

export function startOfYesterday(date = new Date()) {
  const today = startOfLocalDay(date)
  return new Date(today.getTime() - 24 * 60 * 60 * 1000)
}

export function isSameLocalDay(a?: Date | null, b = new Date()) {
  if (!a) return false
  return startOfLocalDay(a).getTime() === startOfLocalDay(b).getTime()
}
