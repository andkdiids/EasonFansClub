import { activityStatusValues, activityTypeValues, activityVerificationModeValues, parseActivityDateInput, type ActivityStatusValue, type ActivityTypeValue, type ActivityVerificationModeValue } from '@/lib/activity'
import { parseActivityImageInput } from '@/lib/activity-image-url'
import { sanitizeText } from '@/lib/security'

export type ActivityEditableValues = {
  title: string
  subtitle: string | null
  description: string
  type: ActivityTypeValue
  status: ActivityStatusValue
  coverUrl: string | null
  bannerUrl: string | null
  locationName: string | null
  locationAddress: string | null
  onlineUrl: string | null
  registrationFee: number
  feeDescription: string | null
  linkedMaterialId: string | null
  startsAt: Date | null
  endsAt: Date | null
  registrationStartAt: Date | null
  registrationEndAt: Date | null
  verificationMode: ActivityVerificationModeValue
  signupLimit: number | null
  organizer: string | null
  contactInfo: string | null
  isFeatured: boolean
  isPinned: boolean
  sortOrder: number
}

type ActivityValidationResult =
  | { valid: true; value: ActivityEditableValues }
  | { valid: false; message: string }

function recordValue(body: Record<string, unknown>, key: string, fallback: unknown) {
  return Object.prototype.hasOwnProperty.call(body, key) ? body[key] : fallback
}

function nullableText(value: unknown, maxLength: number) {
  const result = sanitizeText(value, maxLength)
  return result || null
}

function parseNullableDate(value: unknown, fieldLabel: string): { value: Date | null; message?: string } {
  if (value === undefined || value === null || value === '') return { value: null }
  const parsed = parseActivityDateInput(value)
  return parsed ? { value: parsed } : { value: null, message: `${fieldLabel}格式不正确，请使用北京时间 YYYY-MM-DD HH:mm` }
}

function parseNullableInteger(value: unknown, fieldLabel: string, minimum = 0) {
  if (value === undefined || value === null || value === '') return { value: null as number | null }
  const parsed = typeof value === 'number' ? value : Number(value)
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > 2_000_000_000) return { value: null as number | null, message: `${fieldLabel}必须是有效的整数` }
  return { value: parsed }
}

function parseBoolean(value: unknown, fallback: boolean) {
  if (value === undefined) return fallback
  if (typeof value === 'boolean') return value
  return value === 'true' || value === '1' || value === 1
}

function parseUrl(value: unknown, fieldLabel: string, maxLength = 500): { value: string | null; message?: string } {
  const result = nullableText(value, maxLength)
  if (!result) return { value: null }
  try {
    const parsed = new URL(result)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') throw new Error('INVALID_PROTOCOL')
    return { value: parsed.toString() }
  } catch {
    return { value: null, message: `${fieldLabel}必须是 http(s) 链接` }
  }
}

function parseImage(value: unknown, fieldLabel: string, existingValue?: string | null) {
  const result = parseActivityImageInput(value, existingValue)
  return result.valid
    ? { value: result.value }
    : { value: null, message: `${fieldLabel}无效，请使用活动图片上传入口` }
}

export function normalizeActivityInput(bodyValue: unknown, existing?: ActivityEditableValues): ActivityValidationResult {
  const body = bodyValue && typeof bodyValue === 'object' && !Array.isArray(bodyValue) ? bodyValue as Record<string, unknown> : {}
  const title = sanitizeText(recordValue(body, 'title', existing?.title ?? ''), 160)
  const subtitle = nullableText(recordValue(body, 'subtitle', existing?.subtitle ?? null), 300)
  const description = sanitizeText(recordValue(body, 'description', existing?.description ?? ''), 20_000)
  const typeValue = recordValue(body, 'type', existing?.type ?? 'OTHER')
  const type = typeof typeValue === 'string' && activityTypeValues.includes(typeValue as ActivityTypeValue)
    ? typeValue as ActivityTypeValue
    : null
  if (!type) return { valid: false, message: typeValue === undefined || typeValue === null || typeValue === '' ? '请选择活动类型' : '活动类型不正确' }

  const statusValue = recordValue(body, 'status', existing?.status ?? 'DRAFT')
  const status = typeof statusValue === 'string' && activityStatusValues.includes(statusValue as ActivityStatusValue)
    ? statusValue as ActivityStatusValue
    : null
  if (!status) return { valid: false, message: '活动状态不正确' }

  const verificationModeValue = recordValue(body, 'verificationMode', existing?.verificationMode ?? 'NONE')
  const verificationMode = typeof verificationModeValue === 'string' && activityVerificationModeValues.includes(verificationModeValue as ActivityVerificationModeValue)
    ? verificationModeValue as ActivityVerificationModeValue
    : null
  if (!verificationMode) return { valid: false, message: '活动核销方式不正确' }

  const cover = parseImage(recordValue(body, 'coverUrl', existing?.coverUrl), '封面图片', existing?.coverUrl)
  if (cover.message) return { valid: false, message: cover.message }
  const banner = parseImage(recordValue(body, 'bannerUrl', existing?.bannerUrl), '横幅图片', existing?.bannerUrl)
  if (banner.message) return { valid: false, message: banner.message }

  const starts = parseNullableDate(recordValue(body, 'startsAt', existing?.startsAt), '开始时间')
  if (starts.message) return { valid: false, message: starts.message }
  const ends = parseNullableDate(recordValue(body, 'endsAt', existing?.endsAt), '结束时间')
  if (ends.message) return { valid: false, message: ends.message }
  const registrationStart = parseNullableDate(recordValue(body, 'registrationStartAt', existing?.registrationStartAt), '报名开始时间')
  if (registrationStart.message) return { valid: false, message: registrationStart.message }
  const registrationEnd = parseNullableDate(recordValue(body, 'registrationEndAt', existing?.registrationEndAt), '报名结束时间')
  if (registrationEnd.message) return { valid: false, message: registrationEnd.message }

  const signupLimit = parseNullableInteger(recordValue(body, 'signupLimit', existing?.signupLimit), '报名名额')
  if (signupLimit.message) return { valid: false, message: signupLimit.message }
  const sortOrder = parseNullableInteger(recordValue(body, 'sortOrder', existing?.sortOrder ?? 0), '排序值')
  if (sortOrder.message) return { valid: false, message: sortOrder.message }

  const onlineUrl = parseUrl(recordValue(body, 'onlineUrl', existing?.onlineUrl), '线上活动链接')
  if (onlineUrl.message) return { valid: false, message: onlineUrl.message }
  const registrationFee = parseNullableInteger(recordValue(body, 'registrationFee', existing?.registrationFee ?? 0), '报名挂号费', 0)
  if (registrationFee.message) return { valid: false, message: registrationFee.message }

  const value: ActivityEditableValues = {
    title,
    subtitle,
    description,
    type,
    status,
    coverUrl: cover.value,
    bannerUrl: banner.value,
    locationName: nullableText(recordValue(body, 'locationName', existing?.locationName), 300),
    locationAddress: nullableText(recordValue(body, 'locationAddress', existing?.locationAddress), 500),
    onlineUrl: onlineUrl.value,
    registrationFee: registrationFee.value ?? 0,
    feeDescription: nullableText(recordValue(body, 'feeDescription', existing?.feeDescription), 2_000),
    linkedMaterialId: nullableText(recordValue(body, 'linkedMaterialId', existing?.linkedMaterialId), 191),
    startsAt: starts.value ?? (recordValue(body, 'startsAt', undefined) === undefined ? existing?.startsAt ?? null : null),
    endsAt: ends.value ?? (recordValue(body, 'endsAt', undefined) === undefined ? existing?.endsAt ?? null : null),
    registrationStartAt: registrationStart.value ?? (recordValue(body, 'registrationStartAt', undefined) === undefined ? existing?.registrationStartAt ?? null : null),
    registrationEndAt: registrationEnd.value ?? (recordValue(body, 'registrationEndAt', undefined) === undefined ? existing?.registrationEndAt ?? null : null),
    verificationMode,
    signupLimit: signupLimit.value,
    organizer: nullableText(recordValue(body, 'organizer', existing?.organizer), 160),
    contactInfo: nullableText(recordValue(body, 'contactInfo', existing?.contactInfo), 500),
    isFeatured: parseBoolean(recordValue(body, 'isFeatured', existing?.isFeatured ?? false), existing?.isFeatured ?? false),
    isPinned: parseBoolean(recordValue(body, 'isPinned', existing?.isPinned ?? false), existing?.isPinned ?? false),
    sortOrder: sortOrder.value ?? 0,
  }

  if (value.startsAt && value.endsAt && value.endsAt <= value.startsAt) return { valid: false, message: '结束时间必须晚于开始时间' }
  if (value.registrationStartAt && value.registrationEndAt && value.registrationEndAt <= value.registrationStartAt) return { valid: false, message: '报名结束时间必须晚于报名开始时间' }

  if (status === 'PUBLISHED') {
    if (!title) return { valid: false, message: '请填写活动标题' }
    if (!Object.prototype.hasOwnProperty.call(body, 'type') && !existing?.type) return { valid: false, message: '请选择活动类型' }
    if (!value.startsAt) return { valid: false, message: '请选择活动开始时间' }
    if (!value.endsAt) return { valid: false, message: '请选择活动结束时间' }
    if (!description) return { valid: false, message: '请填写活动说明' }
  }

  return { valid: true, value }
}
