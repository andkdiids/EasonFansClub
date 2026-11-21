export type MemoirSchedule = {
  previewAt: Date
  reservationOpensAt: Date
  reservationClosesAt: Date
  statisticsStartAt: Date
  statisticsEndAt: Date
  reportOpensAt: Date
  notificationAt: Date
  endsAt: Date
  settlementAt: Date
}

export function isValidMemoirSchedule(schedule: MemoirSchedule) {
  const s = schedule
  return Object.values(s).every((date) => Number.isFinite(date.getTime())) &&
    s.previewAt <= s.reservationOpensAt &&
    s.reservationOpensAt < s.reservationClosesAt &&
    s.reservationClosesAt <= s.reportOpensAt &&
    s.statisticsStartAt < s.statisticsEndAt &&
    s.statisticsEndAt <= s.reportOpensAt &&
    s.reportOpensAt <= s.notificationAt &&
    s.notificationAt < s.endsAt &&
    s.endsAt <= s.settlementAt
}

export function getMemoirAvailability(input: {
  configuredAndPublished: boolean
  schedule: MemoirSchedule
  now: Date
  hasSnapshot: boolean
}) {
  const { configuredAndPublished, schedule, now, hasSnapshot } = input
  const visible = configuredAndPublished && isValidMemoirSchedule(schedule) && now >= schedule.previewAt
  const active = visible && now < schedule.endsAt
  return {
    visible,
    canReserve: active && now >= schedule.reservationOpensAt && now < schedule.reservationClosesAt,
    canGenerate: active && now >= schedule.reportOpensAt && !hasSnapshot,
    canViewSnapshot: hasSnapshot,
    canSubmitShare: active && hasSnapshot && now >= schedule.reportOpensAt,
    canNotify: active && now >= schedule.notificationAt,
    canSettle: visible && now >= schedule.settlementAt,
  }
}
