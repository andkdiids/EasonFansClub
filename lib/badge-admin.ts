import type { BadgeCategory, BadgeEffectType, BadgeGrantType, BadgeNicknameEffect, BadgeRarity, BadgeVisibility, Prisma } from '@prisma/client'
import { sanitizeText } from '@/lib/security'
import { normalizeBadgeColor } from '@/lib/badge-types'
import { toStoredMediaUrl } from '@/lib/media-url'

const CODE_PATTERN = /^[a-z0-9][a-z0-9_-]{1,63}$/
const CATEGORIES = new Set(['SYSTEM', 'BIRTHDAY', 'CONCERT'])
const VISIBILITIES = new Set(['PUBLIC', 'HIDDEN', 'SECRET'])
const RARITIES = new Set(['COMMON', 'RARE', 'EPIC', 'LEGENDARY', 'LIMITED'])
const GRANT_TYPES = new Set(['AUTO', 'MANUAL', 'EVENT'])
const EFFECT_TYPES = new Set(['NONE', 'SHINE', 'GLOW', 'SPARKLE'])
const NICKNAME_EFFECTS = new Set(['NONE', 'COLOR', 'GOLD', 'GRADIENT', 'GLOW'])

type BadgeInput = Record<string, unknown>

function optionalText(body: BadgeInput, key: string, maxLength: number) {
  if (!(key in body)) return undefined
  const value = sanitizeText(body[key], maxLength)
  return value || null
}

export function parseBadgeDefinition(body: BadgeInput, partial = false) {
  const data: Partial<Prisma.BadgeUncheckedCreateInput> = {}

  if (!partial || 'name' in body) {
    const name = sanitizeText(body.name, 80)
    if (!name) return { error: '请填写勋章名称' }
    data.name = name
  }

  if (!partial || 'code' in body) {
    const code = sanitizeText(body.code, 64).toLowerCase()
    if (!CODE_PATTERN.test(code)) return { error: 'code 只能使用 2～64 位小写字母、数字、短横线或下划线' }
    data.code = code
    if (!partial && !('slug' in body)) data.slug = code
  }

  if (!partial || 'slug' in body) {
    const slug = sanitizeText('slug' in body ? body.slug : data.code, 191).toLowerCase()
    if (!slug) return { error: '请填写有效标识' }
    data.slug = slug
  }

  if (!partial || 'description' in body) data.description = optionalText(body, 'description', 500) ?? null
  if (!partial || 'acquisitionDescription' in body) data.acquisitionDescription = optionalText(body, 'acquisitionDescription', 500) ?? null

  const imageInput = 'imageUrl' in body ? body.imageUrl : body.iconUrl
  if (!partial || imageInput !== undefined) {
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

  if (!partial || 'effectType' in body) {
    const effectType = typeof body.effectType === 'string' ? body.effectType.toUpperCase() : 'NONE'
    if (!EFFECT_TYPES.has(effectType)) return { error: '勋章动画效果无效' }
    data.effectType = effectType as BadgeEffectType
  }

  if (!partial || 'nicknameEffect' in body) {
    const nicknameEffect = typeof body.nicknameEffect === 'string' ? body.nicknameEffect.toUpperCase() : 'NONE'
    if (!NICKNAME_EFFECTS.has(nicknameEffect)) return { error: '昵称效果无效' }
    data.nicknameEffect = nicknameEffect as BadgeNicknameEffect

    const color = normalizeBadgeColor(body.nicknameColor)
    const start = normalizeBadgeColor(body.nicknameGradientStart)
    const end = normalizeBadgeColor(body.nicknameGradientEnd)
    if (nicknameEffect === 'COLOR' && !color) return { error: '单色昵称效果需要填写 #RRGGBB 颜色' }
    if (nicknameEffect === 'GRADIENT' && (!start || !end)) return { error: '渐变昵称效果需要填写起止 #RRGGBB 颜色' }
    data.nicknameColor = nicknameEffect === 'COLOR' ? color : null
    data.nicknameGradientStart = nicknameEffect === 'GRADIENT' ? start : null
    data.nicknameGradientEnd = nicknameEffect === 'GRADIENT' ? end : null
  } else {
    if ('nicknameColor' in body) {
      const color = normalizeBadgeColor(body.nicknameColor)
      if (body.nicknameColor && !color) return { error: '昵称颜色必须是 #RRGGBB 格式' }
      data.nicknameColor = color
    }
    if ('nicknameGradientStart' in body) {
      const start = normalizeBadgeColor(body.nicknameGradientStart)
      if (body.nicknameGradientStart && !start) return { error: '渐变起始颜色必须是 #RRGGBB 格式' }
      data.nicknameGradientStart = start
    }
    if ('nicknameGradientEnd' in body) {
      const end = normalizeBadgeColor(body.nicknameGradientEnd)
      if (body.nicknameGradientEnd && !end) return { error: '渐变结束颜色必须是 #RRGGBB 格式' }
      data.nicknameGradientEnd = end
    }
  }

  if (!partial || 'sortOrder' in body) {
    const sortOrder = Number(body.sortOrder ?? 0)
    if (!Number.isInteger(sortOrder) || sortOrder < -100000 || sortOrder > 100000) return { error: '排序必须是有效整数' }
    data.sortOrder = sortOrder
  }

  if ('musicTourId' in body) {
    data.musicTourId = typeof body.musicTourId === 'string' && body.musicTourId.trim() ? body.musicTourId.trim() : null
  }

  return { data }
}
