export const memoirTimeFields = {
  previewAt: '预告及预约开始', reservationClosesAt: '预约截止',
  reportOpensAt: '年度报告开放', notificationAt: '开放通知', endsAt: '活动结束',
} as const

export function toMemoirShanghaiInput(value: Date | string) {
  return new Date(new Date(value).getTime() + 8 * 3600_000).toISOString().slice(0, 19)
}

export function memoirStatisticsWindow(year: number, reportOpensAt: Date) {
  const day = toMemoirShanghaiInput(reportOpensAt).slice(0, 10)
  return {
    statisticsStartAt: new Date(year + '-01-01T00:00:00+08:00'),
    statisticsEndAt: new Date(day + 'T00:00:00+08:00'),
  }
}

export function validateMemoirAdminInput(value: unknown, year = 2026) {
  const input = value && typeof value === 'object' ? value as Record<string, unknown> : {}
  const error = (field: string, message: string) => ({ ok: false as const, field, message })
  const times = {} as Record<keyof typeof memoirTimeFields, Date>
  for (const key of Object.keys(memoirTimeFields) as (keyof typeof memoirTimeFields)[]) {
    const text = input[key]
    if (typeof text !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d(?::\d\d)?$/.test(text)) return error(key, '请填写' + memoirTimeFields[key] + '（北京时间）。')
    const iso = text.length === 16 ? text + ':00' : text
    const date = new Date(iso + '+08:00')
    if (!Number.isFinite(date.getTime()) || toMemoirShanghaiInput(date) !== iso || Number(iso.slice(0, 4)) !== year) {
      return error(key, memoirTimeFields[key] + '必须是 ' + year + ' 年内的有效北京时间。')
    }
    times[key] = date
  }

  const { previewAt, reservationClosesAt, reportOpensAt, notificationAt, endsAt } = times
  if (previewAt > reservationClosesAt) return error('reservationClosesAt', '预约截止不能早于预告及预约开始。')
  if (reservationClosesAt >= reportOpensAt) return error('reportOpensAt', '年度报告开放必须晚于预约截止。')
  if (reportOpensAt > notificationAt) return error('notificationAt', '开放通知不能早于年度报告开放。')
  if (notificationAt > endsAt) return error('endsAt', '活动结束不能早于开放通知。')
  const statistics = memoirStatisticsWindow(year, reportOpensAt)
  if (statistics.statisticsStartAt >= statistics.statisticsEndAt) return error('reportOpensAt', '年度报告开放日期必须晚于当年 1 月 1 日。')

  const points = input.reservationPoints
  if (typeof points !== 'number' || !Number.isInteger(points) || points < 0 || points > 2_147_483_647) {
    return error('memoirPoints', '预约挂号费必须是有效的非负整数。')
  }
  if (typeof input.enabled !== 'boolean') return error('memoirEnabled', '请确认年度活动状态。')
  const badge = (key: string) => typeof input[key] === 'string' ? input[key].trim() || null : null
  return { ok: true as const, data: { ...times, ...statistics, reservationOpensAt: previewAt, settlementAt: endsAt,
    enabled: input.enabled, ...(typeof input.showInActivityCenter === 'boolean' ? { showInActivityCenter: input.showInActivityCenter } : {}),
    reservationPoints: points, reservationBadgeId: badge('reservationBadgeId'), annualBadgeId: badge('annualBadgeId') } }
}
