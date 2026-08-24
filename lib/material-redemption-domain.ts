export type MaterialRedemptionSchedule = {
  exchangeStartAt: Date
  exchangeEndAt: Date
  redeemEndAt: Date
}

export const MATERIAL_REDEMPTION_CODE_PREFIX = 'ECFC-'
export const LEGACY_MATERIAL_REDEMPTION_CODE_PREFIX = 'EFC-'
const MATERIAL_REDEMPTION_CODE_SUFFIX_PATTERN = /^[A-Z0-9]{8,59}$/
const MATERIAL_REDEMPTION_TOKEN_PATTERN = /^[A-Za-z0-9_+=\/-]{4,128}$/
const MATERIAL_REDEMPTION_VERIFY_PATH = '/admin/material-redemptions/verify'
const MATERIAL_REDEMPTION_PUBLIC_HOSTS = new Set(['ecfc.fans', 'www.ecfc.fans'])
const MATERIAL_REDEMPTION_LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1'])

export type MaterialRedeemCodeParseResult = {
  input: string
  normalized: string
  prefix: typeof MATERIAL_REDEMPTION_CODE_PREFIX | typeof LEGACY_MATERIAL_REDEMPTION_CODE_PREFIX | null
  suffix: string
  candidates: [string, string]
}

export type MaterialRedemptionQrParseResult = {
  source: 'token' | 'url' | 'code'
  redeemToken?: string
  redeemCode?: string
}

export function normalizeMaterialRedeemCodeInput(value: unknown) {
  return typeof value === 'string' ? value.trim().replace(/\s+/g, '').toUpperCase() : ''
}

export function parseMaterialRedeemCode(value: unknown): MaterialRedeemCodeParseResult | null {
  const input = normalizeMaterialRedeemCodeInput(value)
  if (!input) return null

  let prefix: MaterialRedeemCodeParseResult['prefix'] = null
  let suffix = input
  if (input.startsWith(MATERIAL_REDEMPTION_CODE_PREFIX)) {
    prefix = MATERIAL_REDEMPTION_CODE_PREFIX
    suffix = input.slice(MATERIAL_REDEMPTION_CODE_PREFIX.length)
  } else if (input.startsWith(LEGACY_MATERIAL_REDEMPTION_CODE_PREFIX)) {
    prefix = LEGACY_MATERIAL_REDEMPTION_CODE_PREFIX
    suffix = input.slice(LEGACY_MATERIAL_REDEMPTION_CODE_PREFIX.length)
  } else if (input.includes('-')) {
    return null
  }

  if (!MATERIAL_REDEMPTION_CODE_SUFFIX_PATTERN.test(suffix)) return null
  const current = `${MATERIAL_REDEMPTION_CODE_PREFIX}${suffix}`
  const legacy = `${LEGACY_MATERIAL_REDEMPTION_CODE_PREFIX}${suffix}`
  const candidates: [string, string] = prefix === LEGACY_MATERIAL_REDEMPTION_CODE_PREFIX ? [legacy, current] : [current, legacy]
  return { input, normalized: candidates[0], prefix, suffix, candidates }
}

export function normalizeMaterialRedeemCode(value: unknown) {
  return parseMaterialRedeemCode(value)?.normalized || ''
}

export function isMaterialRedeemToken(value: unknown): value is string {
  return typeof value === 'string' && MATERIAL_REDEMPTION_TOKEN_PATTERN.test(value.trim())
}

function parseMaterialRedemptionQrToken(value: unknown): MaterialRedemptionQrParseResult | null {
  const token = typeof value === 'string' ? value.trim() : ''
  const code = parseMaterialRedeemCode(token)
  if (code && (code.prefix === MATERIAL_REDEMPTION_CODE_PREFIX || code.prefix === LEGACY_MATERIAL_REDEMPTION_CODE_PREFIX)) {
    return { source: 'code', redeemCode: code.normalized }
  }
  if (isMaterialRedeemToken(token)) return { source: 'token', redeemToken: token }
  return code ? { source: 'code', redeemCode: code.normalized } : null
}

function isAllowedMaterialRedemptionQrUrl(url: URL) {
  const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, '')
  if (MATERIAL_REDEMPTION_PUBLIC_HOSTS.has(hostname)) return url.protocol === 'https:' && url.port === ''
  if (MATERIAL_REDEMPTION_LOCAL_HOSTS.has(hostname)) return (url.protocol === 'http:' || url.protocol === 'https:') && (!url.port || url.port === '3000' || url.port === '8000')
  return false
}

export function parseMaterialRedemptionQr(value: unknown): MaterialRedemptionQrParseResult | null {
  const raw = typeof value === 'string' ? value.trim() : ''
  if (!raw) return null
  const direct = parseMaterialRedemptionQrToken(raw)
  if (direct) return direct

  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return null
  }
  if (!isAllowedMaterialRedemptionQrUrl(url) || url.username || url.password) return null
  if (url.pathname.replace(/\/+$/, '') !== MATERIAL_REDEMPTION_VERIFY_PATH) return null
  const tokens = url.searchParams.getAll('token')
  if (tokens.length !== 1) return null
  const parsed = parseMaterialRedemptionQrToken(tokens[0])
  return parsed ? { ...parsed, source: 'url' } : null
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
