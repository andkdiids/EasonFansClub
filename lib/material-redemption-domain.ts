export type MaterialRedemptionSchedule = {
  exchangeStartAt: Date
  exchangeEndAt: Date
  redeemEndAt: Date
}

export type MaterialRedemptionStatusValue = 'DRAFT' | 'PUBLISHED' | 'PAUSED' | 'ENDED' | 'ARCHIVED'

export type MaterialExchangeState =
  | 'DRAFT'
  | 'UPCOMING'
  | 'ACTIVE'
  | 'PAUSED'
  | 'ENDED'
  | 'ARCHIVED'

export const materialRedemptionStatusLabels: Record<MaterialRedemptionStatusValue, string> = {
  DRAFT: '草稿',
  PUBLISHED: '已发布',
  PAUSED: '已暂停',
  ENDED: '已结束',
  ARCHIVED: '已归档',
}

export const materialExchangeStateLabels: Record<MaterialExchangeState, string> = {
  DRAFT: '草稿',
  UPCOMING: '即将开始',
  ACTIVE: '兑换中',
  PAUSED: '已暂停',
  ENDED: '兑换结束',
  ARCHIVED: '已归档',
}

export function validateMaterialRedemptionSchedule(schedule: MaterialRedemptionSchedule) {
  if (!(schedule.exchangeStartAt instanceof Date) || Number.isNaN(schedule.exchangeStartAt.getTime())) return '兑换开始时间无效'
  if (!(schedule.exchangeEndAt instanceof Date) || Number.isNaN(schedule.exchangeEndAt.getTime())) return '兑换结束时间无效'
  if (!(schedule.redeemEndAt instanceof Date) || Number.isNaN(schedule.redeemEndAt.getTime())) return '核销截止时间无效'
  if (schedule.exchangeStartAt >= schedule.exchangeEndAt) return '兑换开始时间必须早于兑换结束时间'
  if (schedule.exchangeEndAt > schedule.redeemEndAt) return '兑换结束时间不能晚于核销截止时间'
  return null
}

export function getMaterialExchangeState(
  status: MaterialRedemptionStatusValue,
  schedule: MaterialRedemptionSchedule,
  now = new Date(),
): MaterialExchangeState {
  if (status === 'DRAFT') return 'DRAFT'
  if (status === 'ARCHIVED') return 'ARCHIVED'
  if (status === 'PAUSED') return 'PAUSED'
  if (status === 'ENDED') return 'ENDED'
  if (now < schedule.exchangeStartAt) return 'UPCOMING'
  if (now <= schedule.exchangeEndAt) return 'ACTIVE'
  return 'ENDED'
}

export function canExchangeMaterial(
  status: MaterialRedemptionStatusValue,
  schedule: MaterialRedemptionSchedule,
  now = new Date(),
) {
  return status === 'PUBLISHED'
    && now >= schedule.exchangeStartAt
    && now <= schedule.exchangeEndAt
}

export function canRedeemMaterial(
  status: MaterialRedemptionStatusValue,
  redeemEndAt: Date,
  now = new Date(),
) {
  return (status === 'PUBLISHED' || status === 'PAUSED' || status === 'ENDED') && now <= redeemEndAt
}

export function parsePositiveInteger(value: unknown, fallback = 0) {
  const parsed = typeof value === 'number' ? value : Number(String(value ?? ''))
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : fallback
}

export function parseDateInput(value: unknown) {
  if (value instanceof Date) return value
  if (typeof value !== 'string' || !value.trim()) return null
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

export function isMaterialRedemptionRuleType(value: unknown): value is 'NONE' | 'REGISTER_DAYS' | 'CHECKIN_TOTAL' | 'CHECKIN_STREAK' | 'HAS_BADGE' | 'ATTENDED_CONCERT' | 'SPECIFIC_USER' {
  return value === 'NONE'
    || value === 'REGISTER_DAYS'
    || value === 'CHECKIN_TOTAL'
    || value === 'CHECKIN_STREAK'
    || value === 'HAS_BADGE'
    || value === 'ATTENDED_CONCERT'
    || value === 'SPECIFIC_USER'
}

export function isMaterialRedemptionRuleOperator(value: unknown): value is 'GTE' | 'EQ' | 'LTE' {
  return value === 'GTE' || value === 'EQ' || value === 'LTE'
}

export function compareMaterialRuleValue(actual: number, operator: 'GTE' | 'EQ' | 'LTE', expected: number) {
  if (operator === 'EQ') return actual === expected
  if (operator === 'LTE') return actual <= expected
  return actual >= expected
}
