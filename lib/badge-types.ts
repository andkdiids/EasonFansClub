export type BadgeVisibility = 'PUBLIC' | 'HIDDEN' | 'SECRET'
export type BadgeRarity = 'COMMON' | 'RARE' | 'EPIC' | 'LEGENDARY' | 'LIMITED'
export type BadgeGrantType = 'AUTO' | 'MANUAL' | 'EVENT'
export type BadgeEffectType = 'NONE' | 'SHINE' | 'GLOW' | 'SPARKLE'
export type BadgeNicknameEffect = 'NONE' | 'COLOR' | 'GOLD' | 'GRADIENT' | 'GLOW'
export type BadgeAvailabilityStatus = 'PERMANENT' | 'UPCOMING' | 'AVAILABLE' | 'ENDED'

export type BadgeSeriesView = {
  id: string
  code: string
  name: string
  description?: string | null
  sortOrder: number
  isEnabled?: boolean
}

export type BadgeProgressView = {
  current: number
  target: number
  percentage: number
  operator: 'GTE' | 'LTE' | 'EQ'
  progressUnsupported?: boolean
}

export type BadgeOwnershipStatsView = {
  ownerCount: number
  totalUsers: number
  rate: number
  display: string
}

export type BadgeShowcaseItemView = {
  slot: number
  badge: BadgeView
}

export type BadgeSeriesCompletionView = {
  series: BadgeSeriesView
  collected: number
  total: number
  percentage: number
  completed: boolean
  reward: BadgeView | null
}

export type EquippedBadgeView = {
  id: string
  code?: string
  name: string
  imageUrl: string | null
  effectType: BadgeEffectType
  nicknameEffect: BadgeNicknameEffect
  nicknameColor: string | null
  nicknameGradientStart: string | null
  nicknameGradientEnd: string | null
  rarity?: BadgeRarity
  obtainedAt?: string | null
  description?: string | null
  acquisitionDescription?: string | null
  isWearable?: boolean
  isEnabled?: boolean
  series?: BadgeSeriesView | null
  tierGroupCode?: string | null
  tierLevel?: number | null
  isHighestTier?: boolean
}

export type BadgeView = Omit<EquippedBadgeView, 'rarity' | 'obtainedAt'> & {
  rarity: BadgeRarity
  description: string | null
  acquisitionDescription: string | null
  visibility: BadgeVisibility
  grantType: BadgeGrantType
  isWearable: boolean
  isEnabled: boolean
  sortOrder: number
  status: 'OBTAINED' | 'NOT_OBTAINED' | 'HIDDEN'
  obtainedAt: string | null
  isEquipped: boolean
  series?: BadgeSeriesView | null
  tierGroupCode?: string | null
  tierLevel?: number | null
  isHighestTier?: boolean
  availabilityStatus?: BadgeAvailabilityStatus
  availableFrom?: string | null
  availableUntil?: string | null
  progress?: BadgeProgressView | null
  ownershipStats?: BadgeOwnershipStatsView | null
}

export type BadgeCollectionView = {
  target: { id: string; uid: number }
  isSelf: boolean
  equippedBadgeId: string | null
  obtainedCount: number
  visibleTotal: number
  publicObtainedCount?: number
  publicTotal?: number
  hiddenObtainedCount?: number
  hiddenTotal?: number
  completionPercentage?: number
  items: BadgeView[]
  showcase?: BadgeShowcaseItemView[]
  recent?: BadgeView[]
  seriesCompletions?: BadgeSeriesCompletionView[]
}

export type BadgeGallerySeriesView = {
  series: BadgeSeriesView
  collected: number
  total: number
  percentage: number
  completed: boolean
  reward: BadgeView | null
}

/**
 * The bounded, privacy-filtered DTO used by the public badge exhibition hall.
 * It intentionally contains BadgeView fields only; BadgeRule is never exposed.
 */
export type BadgeGalleryView = {
  isAuthenticated: boolean
  items: BadgeView[]
  total: number
  obtainedCount: number
  collectibleTotal: number
  collectibleObtainedCount: number
  completionPercentage: number
  series: BadgeGallerySeriesView[]
}

export const BADGE_VISIBILITIES: BadgeVisibility[] = ['PUBLIC', 'HIDDEN', 'SECRET']
export const BADGE_RARITIES: BadgeRarity[] = ['COMMON', 'RARE', 'EPIC', 'LEGENDARY', 'LIMITED']
export const BADGE_GRANT_TYPES: BadgeGrantType[] = ['AUTO', 'MANUAL', 'EVENT']
export const BADGE_EFFECT_TYPES: BadgeEffectType[] = ['NONE', 'SHINE', 'GLOW', 'SPARKLE']
export const BADGE_NICKNAME_EFFECTS: BadgeNicknameEffect[] = ['NONE', 'COLOR', 'GOLD', 'GRADIENT', 'GLOW']

export const BADGE_RARITY_LABELS: Record<BadgeRarity, string> = {
  COMMON: '普通',
  RARE: '稀有',
  EPIC: '史诗',
  LEGENDARY: '传说',
  LIMITED: '限定',
}

export const BADGE_VISIBILITY_LABELS: Record<BadgeVisibility, string> = {
  PUBLIC: '公开',
  HIDDEN: '隐藏',
  SECRET: '秘密',
}

export const BADGE_GRANT_TYPE_LABELS: Record<BadgeGrantType, string> = {
  AUTO: '自动',
  MANUAL: '手动',
  EVENT: '活动',
}

export const BADGE_EFFECT_TYPE_LABELS: Record<BadgeEffectType, string> = {
  NONE: '静态',
  SHINE: '扫光',
  GLOW: '呼吸光',
  SPARKLE: '闪点',
}

export const BADGE_NICKNAME_EFFECT_LABELS: Record<BadgeNicknameEffect, string> = {
  NONE: '无',
  COLOR: '单色',
  GOLD: '浅金',
  GRADIENT: '渐变',
  GLOW: '轻微发光',
}

export const BADGE_COLOR_PATTERN = /^#[0-9a-f]{6}$/i

export function normalizeBadgeColor(value: unknown) {
  if (typeof value !== 'string') return null
  const color = value.trim().toLowerCase()
  return BADGE_COLOR_PATTERN.test(color) ? color : null
}
