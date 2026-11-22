import { isValidMemoirSchedule } from '@/lib/annual-memoir-policy'

export const memoirTimeFields = {
  previewAt: '预告开始', reservationOpensAt: '预约开始', reservationClosesAt: '预约截止',
  statisticsStartAt: '统计开始', statisticsEndAt: '统计截止', reportOpensAt: '报告开放',
  notificationAt: '开放通知', endsAt: '活动结束', settlementAt: '年度勋章结算',
} as const

export function parseMemoirAdminInput(value: unknown) {
  if (!value || typeof value !== 'object') return null
  const input = value as Record<string, unknown>
  function date(key: keyof typeof memoirTimeFields) {
    const text = input[key]
    if (typeof text !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d(?::\d\d)?$/.test(text)) return new Date(NaN)
    const iso = text.length === 16 ? text + ':00' : text
    const result = new Date(iso + '+08:00')
    return Number.isFinite(result.getTime()) && toMemoirShanghaiInput(result) === iso ? result : new Date(NaN)
  }
  const schedule = {
    previewAt: date('previewAt'), reservationOpensAt: date('reservationOpensAt'), reservationClosesAt: date('reservationClosesAt'),
    statisticsStartAt: date('statisticsStartAt'), statisticsEndAt: date('statisticsEndAt'), reportOpensAt: date('reportOpensAt'),
    notificationAt: date('notificationAt'), endsAt: date('endsAt'), settlementAt: date('settlementAt'),
  }
  const points = input.reservationPoints
  if (!isValidMemoirSchedule(schedule) || typeof input.enabled !== 'boolean' ||
    typeof points !== 'number' || !Number.isInteger(points) || points < 0 || points > 2_147_483_647) return null
  const badge = (key: string) => typeof input[key] === 'string' ? input[key].trim() || null : null
  return { ...schedule, enabled: input.enabled, ...(typeof input.showInActivityCenter === 'boolean' ? { showInActivityCenter: input.showInActivityCenter } : {}), reservationPoints: points, reservationBadgeId: badge('reservationBadgeId'), annualBadgeId: badge('annualBadgeId') }
}

export function toMemoirShanghaiInput(value: Date | string) {
  return new Date(new Date(value).getTime() + 8 * 3600_000).toISOString().slice(0, 19)
}
