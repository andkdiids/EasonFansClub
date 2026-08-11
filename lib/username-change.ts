export type UsernameChangeAvailability = {
  lastChangedAt: Date | null
  nextAllowedAt: Date | null
  canChange: boolean
}

/**
 * Add one calendar month while keeping the original day when that day exists.
 * For example, January 31 becomes February 28/29 instead of overflowing into
 * March. The stored timestamp remains an instant, so UTC components are used
 * consistently regardless of the server's local timezone.
 */
export function addCalendarMonth(date: Date) {
  const next = new Date(date.getTime())
  const originalDay = next.getUTCDate()

  next.setUTCDate(1)
  next.setUTCMonth(next.getUTCMonth() + 1)

  const lastDayOfTargetMonth = new Date(Date.UTC(next.getUTCFullYear(), next.getUTCMonth() + 1, 0)).getUTCDate()
  next.setUTCDate(Math.min(originalDay, lastDayOfTargetMonth))
  return next
}

export function getUsernameChangeAvailability(lastChangedAt: Date | null | undefined, now = new Date()): UsernameChangeAvailability {
  if (!lastChangedAt) {
    return {
      lastChangedAt: null,
      nextAllowedAt: null,
      canChange: true,
    }
  }

  const nextAllowedAt = addCalendarMonth(lastChangedAt)
  return {
    lastChangedAt,
    nextAllowedAt,
    canChange: now.getTime() >= nextAllowedAt.getTime(),
  }
}
