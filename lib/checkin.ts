export function startOfLocalDay(date = new Date()) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate())
}

export function startOfYesterday(date = new Date()) {
  const today = startOfLocalDay(date)
  return new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1)
}

export function isSameLocalDay(a?: Date | null, b = new Date()) {
  if (!a) return false
  return startOfLocalDay(a).getTime() === startOfLocalDay(b).getTime()
}
