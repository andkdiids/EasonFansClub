/**
 * The current Badge schema has no Salon-specific category or rule type.
 * Keep this capability explicit so the shortcut never guesses from a badge
 * name, the generic CONCERT category, or arbitrary rule JSON.
 */
export const SALON_BADGE_CLASSIFICATION = {
  available: false,
  reason: '当前 Badge schema/rule 没有可靠的沙龙勋章分类，暂不列出勋章。',
} as const

export type SalonBadgeCatalogItem = {
  id: string
  name: string
  iconUrl: string | null
  rarity: string | null
  owned: boolean
}

export function salonBadgeClassificationMessage() {
  return SALON_BADGE_CLASSIFICATION.reason
}
