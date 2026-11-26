/**
 * Pure Beijing-time period helpers for leaderboard settlement.
 *
 * Settlement runs every Monday 06:00 and on the 1st 06:00 (Asia/Shanghai) but
 * always settles the PREVIOUS full natural week/month:
 *   week  = [last Monday 00:00, this Monday 00:00)
 *   month = [first day of last month 00:00, first day of this month 00:00)
 *
 * All boundaries are anchored to Beijing wall-clock using a fixed +08:00
 * offset, so results never depend on the host machine's timezone.
 */

export type SettlementKind = 'weekly' | 'monthly'

export type SettlementPeriod = {
  kind: SettlementKind
  /** Stable, human-readable identity embedded in every idempotency key. */
  periodKey: string
  /** Beijing wall-clock key of the period start, e.g. 2026-11-23. */
  startDateKey: string
  /** Beijing wall-clock key of the exclusive end, e.g. 2026-11-30. */
  endDateKey: string
  /** Absolute instants (UTC) of the [start, end) window. */
  start: Date
  endExclusive: Date
}

const BEIJING_OFFSET_MS = 8 * 60 * 60 * 1000

/** A Beijing wall-clock date key (YYYY-MM-DD) → the UTC instant of its 00:00. */
export function beijingDayStart(dateKey: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) throw new Error(`INVALID_DATE_KEY:${dateKey}`)
  return new Date(`${dateKey}T00:00:00+08:00`)
}

function utcDayKey(instant: Date): string {
  // Shift to Beijing wall clock, then read UTC calendar parts.
  return new Date(instant.getTime() + BEIJING_OFFSET_MS).toISOString().slice(0, 10)
}

function addDays(dateKey: string, days: number): string {
  const shifted = new Date(`${dateKey}T00:00:00Z`)
  shifted.setUTCDate(shifted.getUTCDate() + days)
  return shifted.toISOString().slice(0, 10)
}

/**
 * The Monday 00:00 (Beijing) that starts the week containing `dateKey`.
 * JS getUTCDay: 0=Sun ... 1=Mon.
 */
export function beijingWeekStartKey(dateKey: string): string {
  const shifted = new Date(`${dateKey}T00:00:00Z`)
  const dow = shifted.getUTCDay()
  const daysFromMonday = (dow + 6) % 7
  return addDays(dateKey, -daysFromMonday)
}

/** First day of the Beijing month containing `dateKey`. */
export function beijingMonthStartKey(dateKey: string): string {
  return `${dateKey.slice(0, 7)}-01`
}

function previousMonthStartKey(dateKey: string): string {
  const shifted = new Date(`${dateKey.slice(0, 7)}-01T00:00:00Z`)
  shifted.setUTCMonth(shifted.getUTCMonth() - 1)
  return `${shifted.toISOString().slice(0, 7)}-01`
}

/**
 * Resolve the period to settle, given the moment the worker fires.
 * For a Monday 06:00 fire, `now` is Monday; the settled week is the one that
 * just ended. For a 1st 06:00 fire, the settled month is last month.
 */
export function resolveSettlementPeriod(kind: SettlementKind, now: Date): SettlementPeriod {
  const todayKey = utcDayKey(now)
  if (kind === 'weekly') {
    const thisMonday = beijingWeekStartKey(todayKey)
    const lastMonday = addDays(thisMonday, -7)
    return {
      kind,
      periodKey: `week:${lastMonday}`,
      startDateKey: lastMonday,
      endDateKey: thisMonday,
      start: beijingDayStart(lastMonday),
      endExclusive: beijingDayStart(thisMonday),
    }
  }
  const thisMonthStart = beijingMonthStartKey(todayKey)
  const lastMonthStart = previousMonthStartKey(thisMonthStart)
  return {
    kind,
    periodKey: `month:${lastMonthStart.slice(0, 7)}`,
    startDateKey: lastMonthStart,
    endDateKey: thisMonthStart,
    start: beijingDayStart(lastMonthStart),
    endExclusive: beijingDayStart(thisMonthStart),
  }
}

/** True only when the period starts on/after the config go-live instant. */
export function isPeriodAfterGoLive(period: SettlementPeriod, enabledAt: string | null | undefined): boolean {
  if (!enabledAt) return false
  const goLive = new Date(enabledAt)
  if (Number.isNaN(goLive.getTime())) return false
  return period.start.getTime() >= goLive.getTime()
}

/** Human label used in notification copy, e.g. "2026-11-23 当周". */
export function periodLabel(period: SettlementPeriod): string {
  return period.kind === 'weekly'
    ? `${period.startDateKey} 当周`
    : `${period.startDateKey.slice(0, 7)} 当月`
}
