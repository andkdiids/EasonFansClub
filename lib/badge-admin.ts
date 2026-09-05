import { Prisma, type BadgeCategory, type BadgeEffectType, type BadgeGrantType, type BadgeRarity, type BadgeValidityType, type BadgeVisibility } from '@prisma/client'
import { sanitizeText } from '@/lib/security'
import { BADGE_NICKNAME_SHINE_FALLBACK, normalizeBadgeColor } from '@/lib/badge-types'
import { toStoredMediaUrl } from '@/lib/media-url'
import { parseBadgeRuleInput, type ParsedBadgeRule } from '@/lib/badge-rules'
import { parseBadgeAvailabilityDate, validateBadgeAvailability } from '@/lib/badge-phase2'

const CATEGORIES = new Set(['SYSTEM', 'BIRTHDAY', 'CONCERT'])
const VISIBILITIES = new Set(['PUBLIC', 'HIDDEN', 'SECRET'])
const RARITIES = new Set(['COMMON', 'RARE', 'EPIC', 'LEGENDARY', 'LIMITED'])
const GRANT_TYPES = new Set(['AUTO', 'MANUAL', 'EVENT'])
const EFFECT_TYPES = new Set(['NONE', 'SHINE', 'GLOW', 'SPARKLE'])
const NICKNAME_EFFECTS = new Set(['NONE', 'COLOR', 'GOLD', 'GRADIENT', 'GLOW'])
const VALIDITY_TYPES = new Set(['PERMANENT', 'DAYS'])
const MAX_VALIDITY_DAYS = 1_000_000

type BadgeInput = Record<string, unknown>

function optionalText(body: BadgeInput, key: string, maxLength: number) {
  if (!(key in body)) return undefined
  const value = sanitizeText(body[key], maxLength)
  return value || null
}

export function parseBadgeDefinition(body: BadgeInput, partial = false) {
  const data: Partial<Prisma.BadgeUncheckedCreateInput> = {}
  let rule: ParsedBadgeRule | null | undefined

  if (!partial || 'name' in body) {
    const name = sanitizeText(body.name, 80)
    if (!name) return { error: '请填写勋章名称' }
    data.name = name
  }

  // code/slug are immutable internal identifiers. Creation routes generate
  // them server-side; update routes deliberately ignore client attempts.

  if (!partial || 'description' in body) data.description = optionalText(body, 'description', 500) ?? null
  if (!partial || 'acquisitionDescription' in body) data.acquisitionDescription = optionalText(body, 'acquisitionDescription', 500) ?? null
  if ('acquisitionDescriptionCustomized' in body) {
    if (typeof body.acquisitionDescriptionCustomized !== 'boolean') return { error: '自定义获取文案标记无效' }
    data.acquisitionDescriptionCustomized = body.acquisitionDescriptionCustomized
  }

  if ('rule' in body) {
    const parsedRule = parseBadgeRuleInput(body.rule)
    if (parsedRule.error) return { error: parsedRule.error }
    rule = parsedRule.rule
  }

  const imageInput = 'imageUrl' in body ? body.imageUrl : body.iconUrl
  if (imageInput !== undefined) {
    if (imageInput === null || imageInput === '') data.iconUrl = null
    else if (typeof imageInput !== 'string' || imageInput.trim().length > 1000) return { error: '图片地址无效，请先完成 PNG 上传' }
    else data.iconUrl = toStoredMediaUrl(imageInput.trim()) || null
  }

  if (!partial || 'category' in body) {
    const category = typeof body.category === 'string' ? body.category.toUpperCase() : 'SYSTEM'
    if (!CATEGORIES.has(category)) return { error: '勋章分类无效' }
    data.category = category as BadgeCategory
  }

  if (!partial || 'visibility' in body) {
    const visibility = typeof body.visibility === 'string' ? body.visibility.toUpperCase() : 'PUBLIC'
    if (!VISIBILITIES.has(visibility)) return { error: '勋章可见性无效' }
    data.visibility = visibility as BadgeVisibility
  }

  if (!partial || 'rarity' in body) {
    const rarity = typeof body.rarity === 'string' ? body.rarity.toUpperCase() : 'COMMON'
    if (!RARITIES.has(rarity)) return { error: '勋章稀有度无效' }
    data.rarity = rarity as BadgeRarity
  }

  if (!partial || 'grantType' in body) {
    const grantType = typeof body.grantType === 'string' ? body.grantType.toUpperCase() : 'MANUAL'
    if (!GRANT_TYPES.has(grantType)) return { error: '发放类型无效' }
    data.grantType = grantType as BadgeGrantType
    data.isAutoGrant = grantType === 'AUTO'
  }

  if (!partial || 'isWearable' in body) data.isWearable = body.isWearable !== false
  if (!partial || 'isEnabled' in body) {
    data.isEnabled = body.isEnabled !== false
    data.isActive = data.isEnabled
  }

  if (!partial || 'announceOnGrant' in body) {
    if (body.announceOnGrant !== undefined && typeof body.announceOnGrant !== 'boolean') return { error: '勋章动态开关无效' }
    data.announceOnGrant = body.announceOnGrant === true
  }
  if (!partial || 'countsTowardSeriesCompletion' in body) {
    if (body.countsTowardSeriesCompletion !== undefined && typeof body.countsTowardSeriesCompletion !== 'boolean') return { error: '系列完成度开关无效' }
    data.countsTowardSeriesCompletion = body.countsTowardSeriesCompletion !== false
  }

  if (!partial || 'validityType' in body || 'validityDays' in body) {
    const requestedType = typeof body.validityType === 'string'
      ? body.validityType.toUpperCase()
      : !partial
        ? body.validityDays !== null && body.validityDays !== undefined ? 'DAYS' : 'PERMANENT'
        : ('validityDays' in body && body.validityDays !== null && body.validityDays !== undefined) ? 'DAYS' : undefined
    if (requestedType !== undefined && !VALIDITY_TYPES.has(requestedType)) return { error: '勋章有效期类型无效' }
    if (requestedType === 'PERMANENT') {
      data.validityType = 'PERMANENT' as BadgeValidityType
      data.validityDays = null
    } else if (requestedType === 'DAYS') {
      const rawDays = body.validityDays
      const validityDays = typeof rawDays === 'number'
        ? rawDays
        : typeof rawDays === 'string' && /^\d+$/.test(rawDays.trim())
          ? Number(rawDays.trim())
          : Number.NaN
      if (!Number.isSafeInteger(validityDays) || validityDays <= 0 || validityDays > MAX_VALIDITY_DAYS) return { error: `有效天数必须是 1 到 ${MAX_VALIDITY_DAYS} 的正整数` }
      data.validityType = 'DAYS' as BadgeValidityType
      data.validityDays = validityDays
    } else if ('validityDays' in body) {
      const rawDays = body.validityDays
      if (rawDays !== null && rawDays !== undefined) {
        const validityDays = typeof rawDays === 'number'
          ? rawDays
          : typeof rawDays === 'string' && /^\d+$/.test(rawDays.trim())
            ? Number(rawDays.trim())
            : Number.NaN
        if (!Number.isSafeInteger(validityDays) || validityDays <= 0 || validityDays > MAX_VALIDITY_DAYS) return { error: `有效天数必须是 1 到 ${MAX_VALIDITY_DAYS} 的正整数` }
      }
      data.validityDays = rawDays === null || rawDays === undefined ? null : Number(rawDays)
    }
  }

  if (!partial || 'effectType' in body) {
    const effectType = typeof body.effectType === 'string' ? body.effectType.toUpperCase() : 'NONE'
    if (!EFFECT_TYPES.has(effectType)) return { error: '勋章动画效果无效' }
    data.effectType = effectType as BadgeEffectType
  }

  if (!partial || 'nicknameEffect' in body) {
    const requestedNicknameEffect = typeof body.nicknameEffect === 'string' ? body.nicknameEffect.toUpperCase() : 'NONE'
    if (!NICKNAME_EFFECTS.has(requestedNicknameEffect)) return { error: '昵称闪光设置无效' }
    const nicknameShineEnabled = requestedNicknameEffect !== 'NONE'
    const color = normalizeBadgeColor(body.nicknameColor)
    if (nicknameShineEnabled && body.nicknameColor && !color) return { error: '昵称闪光颜色必须是 #RRGGBB 格式' }
    // Keep the legacy enum values accepted at the API boundary, but persist the
    // new two-part meaning: enabled + one shine color. Gradient endpoints are
    // intentionally ignored and remain available only for old stored records.
    data.nicknameEffect = nicknameShineEnabled ? 'COLOR' : 'NONE'
    data.nicknameColor = nicknameShineEnabled ? color || BADGE_NICKNAME_SHINE_FALLBACK : null
  } else {
    if ('nicknameColor' in body) {
      const color = normalizeBadgeColor(body.nicknameColor)
      if (body.nicknameColor && !color) return { error: '昵称闪光颜色必须是 #RRGGBB 格式' }
      data.nicknameColor = color
    }
  }

  if (!partial || 'sortOrder' in body) {
    const sortOrder = Number(body.sortOrder ?? 0)
    if (!Number.isInteger(sortOrder) || sortOrder < -100000 || sortOrder > 100000) return { error: '排序必须是有效整数' }
    data.sortOrder = sortOrder
  }

  if (!partial || 'seriesId' in body) {
    data.seriesId = typeof body.seriesId === 'string' && body.seriesId.trim() ? body.seriesId.trim().slice(0, 191) : null
  }

  if (!partial || 'tierLevel' in body || 'tierEnabled' in body) {
    if ('tierEnabled' in body && typeof body.tierEnabled !== 'boolean') return { error: '分级勋章设置无效' }
    if (body.tierEnabled === false) data.tierLevel = null
    else if (body.tierLevel === undefined || body.tierLevel === null || body.tierLevel === '') {
      if (body.tierEnabled === true) return { error: '成长型分级勋章必须选择等级' }
      data.tierLevel = null
    } else {
      const tierLevel = typeof body.tierLevel === 'number' ? body.tierLevel : typeof body.tierLevel === 'string' && /^\d+$/.test(body.tierLevel.trim()) ? Number(body.tierLevel.trim()) : Number.NaN
      if (!Number.isSafeInteger(tierLevel) || tierLevel < 1 || tierLevel > 99) return { error: '等级必须是 1 到 99 的整数' }
      data.tierLevel = tierLevel
    }
    if (body.tierEnabled === true && !data.seriesId && body.legacyTier !== true) return { error: '成长型分级勋章必须选择成长系列' }
  }

  const availabilityFields = ['availableFrom', 'availableUntil'] as const
  for (const field of availabilityFields) {
    if (!partial || field in body) {
      const parsedDate = parseBadgeAvailabilityDate(body[field], field === 'availableFrom' ? '限定开始时间' : '限定结束时间')
      if (parsedDate.error) return { error: parsedDate.error }
      data[field] = parsedDate.value
    }
  }
  if (data.availableFrom !== undefined && data.availableUntil !== undefined) {
    const availabilityError = validateBadgeAvailability(data.availableFrom as Date | null, data.availableUntil as Date | null)
    if (availabilityError) return { error: availabilityError }
  }

  if ('musicTourId' in body) {
    data.musicTourId = typeof body.musicTourId === 'string' && body.musicTourId.trim() ? body.musicTourId.trim() : null
  }

  if (rule && data.grantType && data.grantType !== 'AUTO') return { error: '手动或事件勋章不能配置自动获取规则' }
  if (!partial && data.grantType === 'AUTO' && !rule) return { error: '自动授予勋章必须配置获取条件' }

  return { data, rule }
}

/** Convert Prisma duplicate metadata into an administrator-safe Chinese message. */
export function getBadgeDuplicateMessage(error: unknown, context: { name?: string; tierLevel?: number | null } = {}) {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') return null
  const target = Array.isArray(error.meta?.target)
    ? error.meta.target.map(String)
    : typeof error.meta?.target === 'string' ? [error.meta.target] : []
  if (target.includes('tierGroupCode') || target.includes('tierLevel') || target.includes('Badge_tierGroupCode_tierLevel_key')) {
    return `该成长系列已经存在「${context.tierLevel || ''}级」勋章，请选择其他等级`
  }
  if (target.includes('name') || target.includes('Badge_name_key')) return context.name ? `已存在同名勋章「${context.name}」` : '已存在同名勋章'
  if (target.includes('slug') || target.includes('Badge_slug_key')) return '页面标识发生冲突，请重新保存'
  if (target.includes('code') || target.includes('Badge_code_key')) return '系统标识发生冲突，请重新保存'
  return '勋章保存失败：已有相同的唯一标识'
}
