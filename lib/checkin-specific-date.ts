import { parseBeijingDate } from '@/lib/checkin'

const CHECKIN_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/

export type CheckinOnDateRuleConfig = {
  dates: string[]
}

function isDateKey(value: unknown): value is string {
  return typeof value === 'string' && CHECKIN_DATE_PATTERN.test(value) && parseBeijingDate(value) !== null
}

/**
 * Normalize the administrator-owned JSON shape for CHECKIN_ON_DATE.
 * Dates are stored as canonical Shanghai business-date keys so the evaluator
 * never needs to interpret a client timezone or a JavaScript Date string.
 */
export function normalizeCheckinOnDateRuleConfig(value: unknown): CheckinOnDateRuleConfig | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const rawDates = (value as Record<string, unknown>).dates
  if (!Array.isArray(rawDates) || rawDates.length === 0) return null
  if (rawDates.some((date) => !isDateKey(date))) return null
  const dates = [...new Set(rawDates as string[])].sort()
  return dates.length ? { dates } : null
}

export function formatCheckinOnDateRuleDescription(config: CheckinOnDateRuleConfig | null) {
  if (!config?.dates.length) return '在指定日期完成正常挂号后获得；补签不计入。'
  const labels = config.dates.map((dateKey) => {
    const [year, month, day] = dateKey.split('-').map(Number)
    return `${year}年${month}月${day}日`
  })
  return `在${labels.join('、')}中的任一指定日期完成正常挂号后获得；补签不计入。`
}

/**
 * This predicate deliberately accepts persisted check-in facts rather than a
 * client-supplied date. The normal check-in API writes type/isMakeUp and the
 * Shanghai business date server-side before emitting the badge event.
 */
export function isNormalCheckinOnConfiguredDate(input: {
  currentUserId: string
  checkinUserId: string
  checkinDateKey: string
  checkinType: string
  isMakeUp: boolean
  configuredDates: readonly string[]
}) {
  return input.currentUserId === input.checkinUserId
    && input.checkinType === 'NORMAL'
    && input.isMakeUp === false
    && input.configuredDates.includes(input.checkinDateKey)
}
