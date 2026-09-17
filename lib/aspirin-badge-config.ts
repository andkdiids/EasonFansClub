export const ASPIRIN_CLINIC_MODULE = 'ASPIRIN_CLINIC' as const
export const ASPIRIN_DAILY_CONSULTATIONS = 5
export const ASPIRIN_MIN_LENGTH = 21
export const ASPIRIN_INITIAL_STREAK_DAYS = 2
export const ASPIRIN_INACTIVE_AFTER_DAYS = 2
export const ASPIRIN_REVOKE_AFTER_DAYS = 7

export type AspirinRuleConfig = {
  module: typeof ASPIRIN_CLINIC_MODULE
  minLength: number
  initialStreakDays: number
}

function positiveInteger(value: unknown) {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : null
}

/** Parse the stable, non-localized module configuration stored in BadgeRule.configJson. */
export function getAspirinRuleConfig(value: unknown): AspirinRuleConfig | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const raw = value as Record<string, unknown>
  const moduleCode = typeof raw.module === 'string' ? raw.module.trim().toUpperCase() : ''
  const minLength = positiveInteger(raw.minLength)
  const initialStreakDays = positiveInteger(raw.initialStreakDays)
  // Unknown legacy keys (including maxRepeatRate) are intentionally ignored.
  // They remain readable in old BadgeRule.configJson rows but never affect
  // acquisition, progress, streaks, or the generated rule description.
  if (moduleCode !== ASPIRIN_CLINIC_MODULE || !minLength || !initialStreakDays) return null
  return { module: ASPIRIN_CLINIC_MODULE, minLength, initialStreakDays }
}

export function validateAspirinRuleConfig(value: unknown) {
  const config = getAspirinRuleConfig(value)
  return config ? { config } : { error: '阿士匹灵规则配置无效：请确认模块、最低字数和连续天数' }
}

export function describeAspirinRule(threshold: number | null, value: unknown) {
  const config = getAspirinRuleConfig(value)
  const daily = Number.isSafeInteger(threshold) && threshold !== null && threshold > 0 ? threshold : ASPIRIN_DAILY_CONSULTATIONS
  if (!config) return `连续完成 ${daily} 位不同用户的病例问诊后获得。`
  return `连续 ${config.initialStreakDays} 天，每天在「各位医师点睇」（ASK_DOCTORS）分类完成 ${daily} 位不同用户的病例问诊；同一用户发布的多个病例，当天仅计 1 次；自己发布的病例不计入；每条至少 ${config.minLength} 字。`
}

/** Generic sustained settings are validated separately from the Aspirin rule config. */
export function validateSustainedQualificationSettings(value: {
  sustainedQualification?: unknown
  inactiveAfterDays?: unknown
  revokeAfterDays?: unknown
}) {
  if (value.sustainedQualification !== true) return { sustainedQualification: false as const, inactiveAfterDays: null, revokeAfterDays: null }
  const inactiveAfterDays = positiveInteger(value.inactiveAfterDays)
  const revokeAfterDays = positiveInteger(value.revokeAfterDays)
  if (!inactiveAfterDays || !revokeAfterDays || revokeAfterDays <= inactiveAfterDays) {
    return { error: '自动收回天数必须大于暂时失效天数' }
  }
  return { sustainedQualification: true as const, inactiveAfterDays, revokeAfterDays }
}
