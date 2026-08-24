import { getShanghaiDateKey, shiftShanghaiDateKey } from '@/lib/checkin'
import { getEligibleMakeupDates } from '@/lib/checkin-makeup'

export const ADMIN_MAKEUP_DEFAULT_RANGE_DAYS = 90
export const ADMIN_MAKEUP_RANGE_OPTIONS = [30, 90, 180] as const

export type AdminMakeupRangeDays = (typeof ADMIN_MAKEUP_RANGE_OPTIONS)[number]

export type AdminMakeupWindow = {
  startDateKey: string
  endDateKey: string
  todayKey: string
  registrationDateKey: string
  rangeDays: AdminMakeupRangeDays
}

export type AdminCheckInRecord = {
  checkinDateKey: string
  type: string
  streakDay: number
}

export type AdminRecentCheckIn = AdminCheckInRecord & {
  status: 'CHECKED_IN' | 'MISSING'
}

export function normalizeAdminMakeupRangeDays(value: unknown): AdminMakeupRangeDays {
  const numeric = typeof value === 'number' ? value : Number(value)
  return ADMIN_MAKEUP_RANGE_OPTIONS.includes(numeric as AdminMakeupRangeDays)
    ? numeric as AdminMakeupRangeDays
    : ADMIN_MAKEUP_DEFAULT_RANGE_DAYS
}

export function getAdminMakeupWindow(input: {
  todayKey: string
  createdAt: Date
  rangeDays?: unknown
}): AdminMakeupWindow {
  const rangeDays = normalizeAdminMakeupRangeDays(input.rangeDays)
  const registrationDateKey = getShanghaiDateKey(input.createdAt)
  const rangeStartKey = shiftShanghaiDateKey(input.todayKey, -(rangeDays - 1))
  const startDateKey = registrationDateKey > rangeStartKey ? registrationDateKey : rangeStartKey
  return {
    startDateKey,
    endDateKey: input.todayKey,
    todayKey: input.todayKey,
    registrationDateKey,
    rangeDays,
  }
}

export function listPastDateKeys(startDateKey: string, todayKey: string) {
  const dates: string[] = []
  for (let dateKey = startDateKey; dateKey < todayKey; dateKey = shiftShanghaiDateKey(dateKey, 1)) {
    dates.push(dateKey)
    if (dates.length > 366) break
  }
  return dates
}

export function buildAdminEligibleMissingDates(input: {
  startDateKey: string
  todayKey: string
  checkinDateKeys: Iterable<string>
}) {
  return getEligibleMakeupDates({
    startDateKey: input.startDateKey,
    todayKey: input.todayKey,
    checkedInDateKeys: input.checkinDateKeys,
    makeupOperationTimes: [],
    scope: 'ADMIN',
    now: new Date(`${input.todayKey}T12:00:00+08:00`),
  }).map((item) => item.dateKey)
}

export function buildAdminRecentCheckIns(input: {
  startDateKey: string
  todayKey: string
  records: AdminCheckInRecord[]
  days?: number
}): AdminRecentCheckIn[] {
  const records = new Map(input.records.map((record) => [record.checkinDateKey, record]))
  const recentStart = input.days && input.days > 0
    ? (shiftShanghaiDateKey(input.todayKey, -(input.days - 1)) > input.startDateKey
      ? shiftShanghaiDateKey(input.todayKey, -(input.days - 1))
      : input.startDateKey)
    : input.startDateKey
  return listPastDateKeys(recentStart, input.todayKey)
    .reverse()
    .map((dateKey) => {
      const record = records.get(dateKey)
      return record
        ? { ...record, status: 'CHECKED_IN' as const }
        : { checkinDateKey: dateKey, type: 'MISSING', streakDay: 0, status: 'MISSING' as const }
    })
}
