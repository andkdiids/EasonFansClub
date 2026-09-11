export const ASPIRIN_CLINIC_MODULE = 'ASPIRIN_CLINIC' as const
export const ASPIRIN_DAILY_CONSULTATIONS = 5
export const ASPIRIN_MIN_LENGTH = 21
export const ASPIRIN_MAX_REPEAT_RATE = 0.7
export const ASPIRIN_INITIAL_STREAK_DAYS = 2
export const ASPIRIN_INACTIVE_AFTER_DAYS = 2
export const ASPIRIN_REVOKE_AFTER_DAYS = 7

export type AspirinRuleConfig = {
  module: typeof ASPIRIN_CLINIC_MODULE
  minLength: number
  maxRepeatRate: number
  initialStreakDays: number
}

function positiveInteger(value: unknown) {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : null
}

function repeatRate(value: unknown) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null
  // Admin payloads use a decimal. Accepting a whole percentage here keeps
  // old hand-authored rule JSON readable without changing its stored meaning.
  const normalized = value > 1 && value <= 100 ? value / 100 : value
  return normalized >= 0 && normalized < 1 ? normalized : null
}

/** Parse the stable, non-localized module configuration stored in BadgeRule.configJson. */
export function getAspirinRuleConfig(value: unknown): AspirinRuleConfig | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const raw = value as Record<string, unknown>
  const moduleCode = typeof raw.module === 'string' ? raw.module.trim().toUpperCase() : ''
  const minLength = positiveInteger(raw.minLength)
  const maxRepeatRate = repeatRate(raw.maxRepeatRate)
  const initialStreakDays = positiveInteger(raw.initialStreakDays)
  if (moduleCode !== ASPIRIN_CLINIC_MODULE || !minLength || maxRepeatRate === null || !initialStreakDays) return null
  return { module: ASPIRIN_CLINIC_MODULE, minLength, maxRepeatRate, initialStreakDays }
}

export function validateAspirinRuleConfig(value: unknown) {
  const config = getAspirinRuleConfig(value)
  return config ? { config } : { error: '阿士匹灵规则配置无效：请确认模块、字数、重复率和连续天数' }
}

export function describeAspirinRule(threshold: number | null, value: unknown) {
  const config = getAspirinRuleConfig(value)
  const daily = Number.isSafeInteger(threshold) && threshold !== null && threshold > 0 ? threshold : ASPIRIN_DAILY_CONSULTATIONS
  if (!config) return `连续完成 ${daily} 个不同病例的有效问诊后获得。`
  return `连续 ${config.initialStreakDays} 天，每天在阿士匹灵门诊部完成 ${daily} 个不同病例的有效问诊；每条至少 ${config.minLength} 字且字符重复率低于 ${Math.round(config.maxRepeatRate * 100)}%。`
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
