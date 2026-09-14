import type { Prisma } from '@prisma/client'
import { publicImageUrl } from '@/lib/images'
import { prisma } from '@/lib/prisma'
import { resolveBadgeAcquisitionDescription } from '@/lib/badge-acquisition'
import { badgeAvailabilityWhere } from '@/lib/badge-phase2'
import { generateBadgeAcquisitionDescription, type SupportedBadgeRuleType } from '@/lib/badge-rules'
import { currentUserBadgeWhere } from '@/lib/badge-validity'

/** The admin-managed opt-in is the only source of Salon badge classification. */
export const SALON_BADGE_CLASSIFICATION = {
  available: true,
  field: 'Badge.salonAssignable',
  reason: '由 Badge.salonAssignable 明确控制。',
} as const

export type SalonBadgeCatalogItem = {
  id: string
  name: string
  iconUrl: string | null
  rarity: string | null
  description: string | null
  acquisitionDescription: string | null
  owned: boolean
}

export function salonBadgeClassificationMessage() {
  return SALON_BADGE_CLASSIFICATION.reason
}

const salonBadgeSelect = {
  id: true,
  name: true,
  iconUrl: true,
  rarity: true,
  description: true,
  acquisitionDescription: true,
  acquisitionDescriptionCustomized: true,
  sortOrder: true,
  BadgeRule: { select: { ruleType: true, threshold: true, configJson: true } },
} as const

type DbSalonBadge = Prisma.BadgeGetPayload<{ select: typeof salonBadgeSelect }>

function resolveSalonAcquisitionDescription(badge: DbSalonBadge) {
  const generatedDescription = badge.BadgeRule
    ? generateBadgeAcquisitionDescription(badge.BadgeRule.ruleType as SupportedBadgeRuleType, badge.BadgeRule.threshold, badge.BadgeRule.configJson)
    : null
  return resolveBadgeAcquisitionDescription({
    storedDescription: badge.acquisitionDescription,
    generatedDescription,
  })
}

/** Return the currently enabled, explicitly Salon-dispatchable badge catalog. */
export async function listSalonAssignableBadges(userId: string, now = new Date()): Promise<SalonBadgeCatalogItem[]> {
  const badges = await prisma.badge.findMany({
    where: {
      salonAssignable: true,
      isEnabled: true,
      isActive: true,
      ...badgeAvailabilityWhere(now),
    },
    orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
    select: salonBadgeSelect,
  })
  const ownedIds = badges.length
    ? new Set((await prisma.userBadge.findMany({
        where: { userId, badgeId: { in: badges.map((badge) => badge.id) }, ...currentUserBadgeWhere(now) },
        select: { badgeId: true },
      })).map((row) => row.badgeId))
    : new Set<string>()

  return badges.map((badge) => ({
    id: badge.id,
    name: badge.name,
    iconUrl: publicImageUrl(badge.iconUrl),
    rarity: badge.rarity,
    description: badge.description,
    acquisitionDescription: resolveSalonAcquisitionDescription(badge),
    owned: ownedIds.has(badge.id),
  }))
}

/** Server-side guard used immediately before a Salon dispatch. */
export async function findSalonAssignableBadge(badgeId: string, now = new Date()) {
  return prisma.badge.findFirst({
    where: {
      id: badgeId,
      salonAssignable: true,
      isEnabled: true,
      isActive: true,
      ...badgeAvailabilityWhere(now),
    },
    select: { id: true, name: true },
  })
}
