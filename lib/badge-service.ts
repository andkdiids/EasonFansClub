import { Prisma } from '@prisma/client'
import { createHash } from 'node:crypto'
import { toPublicMediaUrl } from '@/lib/media-url'
import { prisma } from '@/lib/prisma'
import type { BadgeCollectionView, BadgeGalleryView, BadgeHistoryView, BadgeShowcaseItemView, BadgeView, EquippedBadgeView } from '@/lib/badge-types'
import { calculateBadgeRuleProgress, canExposeLiveBadgeProgress, getBadgeAvailability, getBadgeOwnershipStats, getUserBadgeRuleProgress, type BadgeOwnershipStats } from '@/lib/badge-phase2'
import { getUserBadgeMetric } from '@/lib/badge-metrics'
import { resolveBadgeAcquisitionDescription } from '@/lib/badge-acquisition'
import { generateBadgeAcquisitionDescription, type SupportedBadgeRuleType } from '@/lib/badge-rules'
import { activeUserBadgeWhere, calculateBadgeExpiresAt, isUserBadgeActive, remainingBadgeDays } from '@/lib/badge-validity'

const BADGE_SELECT = {
  id: true,
  code: true,
  slug: true,
  name: true,
  description: true,
  acquisitionDescription: true,
  iconUrl: true,
  visibility: true,
  rarity: true,
  grantType: true,
  validityType: true,
  validityDays: true,
  isWearable: true,
  isEnabled: true,
  isActive: true,
  effectType: true,
  nicknameEffect: true,
  nicknameColor: true,
  nicknameGradientStart: true,
  nicknameGradientEnd: true,
  sortOrder: true,
  seriesId: true,
  tierGroupCode: true,
  tierLevel: true,
  availableFrom: true,
  availableUntil: true,
  announceOnGrant: true,
  countsTowardSeriesCompletion: true,
  Series: { select: { id: true, code: true, name: true, description: true, sortOrder: true, isEnabled: true } },
} as const

// High-frequency nickname/post/comment surfaces only need the equipped badge
// presentation fields. Keep unrelated series/tier metadata out of these
// bounded batch lookups; validity and dynamic acquisition are still required
// to decide whether the equipped badge can be shown.
const EQUIPPED_BADGE_SELECT = {
  id: true,
  code: true,
  name: true,
  iconUrl: true,
  effectType: true,
  nicknameEffect: true,
  nicknameColor: true,
  nicknameGradientStart: true,
  nicknameGradientEnd: true,
  rarity: true,
  description: true,
  acquisitionDescription: true,
  isWearable: true,
  isEnabled: true,
  isActive: true,
  validityType: true,
  validityDays: true,
  BadgeRule: { select: { ruleType: true, threshold: true, configJson: true } },
  PharmacyPrize: {
    where: { type: 'BADGE', enabled: true, Campaign: { status: { not: 'ENDED' } } },
    select: { id: true },
    take: 1,
  },
} as const

type DbBadge = Prisma.BadgeGetPayload<{ select: typeof BADGE_SELECT }>
const BADGE_COLLECTION_SELECT = {
  ...BADGE_SELECT,
  BadgeRule: { select: { id: true, ruleType: true, operator: true, threshold: true, configJson: true, isEnabled: true } },
  PharmacyPrize: {
    where: { type: 'BADGE', enabled: true, Campaign: { status: { not: 'ENDED' } } },
    select: { id: true },
    take: 1,
  },
} as const
type DbCollectionBadge = Prisma.BadgeGetPayload<{ select: typeof BADGE_COLLECTION_SELECT }>
const USER_BADGE_SELECT = {
  id: true,
  obtainedAt: true,
  awardedAt: true,
  grantedAt: true,
  expiresAt: true,
  expiredAt: true,
  revokedAt: true,
  status: true,
  sourceType: true,
  sourceId: true,
  grantReason: true,
  Badge: { select: BADGE_COLLECTION_SELECT },
} as const
type DbUserBadge = Prisma.UserBadgeGetPayload<{ select: typeof USER_BADGE_SELECT }>
const USER_EQUIPPED_BADGE_SELECT = {
  id: true,
  userId: true,
  badgeId: true,
  position: true,
  equippedAt: true,
  Badge: { select: EQUIPPED_BADGE_SELECT },
} as const
type DbUserEquippedBadge = Prisma.UserEquippedBadgeGetPayload<{ select: typeof USER_EQUIPPED_BADGE_SELECT }>
type DbEquippedOwnership = {
  userId: string
  badgeId: string
  obtainedAt: Date
  expiresAt: Date | null
  status: string
}

export type BadgeGrantAvailabilityMode = 'CURRENT' | 'HISTORICAL_WINDOW' | 'ADMIN_MANUAL'

export type GrantBadgeInput = {
  userId: string
  badgeId: string
  sourceType?: string | null
  sourceId?: string | null
  grantReason?: string | null
  actorId?: string | null
  obtainedAt?: Date
  /**
   * The default mode is the live eligibility path. Historical and admin
   * grants must opt in explicitly so a normal event evaluator can never
   * accidentally award an ended or upcoming badge.
   */
  availabilityMode?: BadgeGrantAvailabilityMode
  historicalWindow?: { from: Date; until: Date }
  /** Stable event/period/operation identity. It is namespaced by user+badge in the service. */
  grantKey?: string | null
  /** Used by a batch evaluator so Phase 3 effects can be emitted once. */
  deferPhase3Effects?: boolean
  /** Internal guard used while a chained BADGE_OWNERSHIP evaluation is running. */
  deferOwnershipRecheck?: boolean
}

export type BadgeOperationResult = {
  created: boolean
  alreadyOwned?: boolean
  /** True when this call added a new durable earning source to an existing aggregate. */
  sourceAttached?: boolean
  recordId: string
  userId: string
  badgeId: string
  badgeName: string
}

export class BadgeServiceError extends Error {
  code: 'USER_NOT_FOUND' | 'BADGE_NOT_FOUND' | 'BADGE_DISABLED' | 'BADGE_NOT_WEARABLE' | 'BADGE_NOT_AVAILABLE' | 'NOT_OWNED' | 'NOT_FOUND' | 'HAS_OWNERS' | 'INVALID_EQUIPPED_ORDER'

  constructor(code: BadgeServiceError['code'], message: string) {
    super(message)
    this.name = 'BadgeServiceError'
    this.code = code
  }
}

type BadgeAdminActionInput = {
  actorId: string
  action: string
  badgeId?: string
  targetUserId?: string
  detail?: Record<string, unknown>
}

/** Keep every administrative badge mutation auditable in the same transaction as the mutation. */
export async function writeBadgeAdminAction(tx: Prisma.TransactionClient, input: BadgeAdminActionInput) {
  await tx.adminActionLog.create({
    data: {
      adminId: input.actorId,
      action: input.action,
      targetUserId: input.targetUserId || input.actorId,
      detail: { ...(input.badgeId ? { badgeId: input.badgeId } : {}), ...(input.detail || {}) } as Prisma.InputJsonValue,
    },
  })
}

/** Serialize badge ownership/equipment mutations with admin state changes. */
export async function lockBadgeForMutation(tx: Prisma.TransactionClient, badgeId: string) {
  const rows = await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM \`Badge\` WHERE id = ${badgeId} FOR UPDATE`
  if (!rows.length) throw new BadgeServiceError('BADGE_NOT_FOUND', '勋章不存在')
}

function resolvedAcquisitionForBadge(badge: DbBadge | DbCollectionBadge | Prisma.BadgeGetPayload<{ select: typeof EQUIPPED_BADGE_SELECT }>) {
  const rule = 'BadgeRule' in badge ? badge.BadgeRule : null
  const generatedDescription = rule
    ? generateBadgeAcquisitionDescription(rule.ruleType as SupportedBadgeRuleType, rule.threshold, rule.configJson)
    : null
  return resolveBadgeAcquisitionDescription({
    storedDescription: badge.acquisitionDescription,
    generatedDescription,
    hasAngelGiftPrize: 'PharmacyPrize' in badge && badge.PharmacyPrize.length > 0,
  })
}

function publicBadge(badge: DbBadge | DbCollectionBadge): Omit<BadgeView, 'status' | 'obtainedAt' | 'isEquipped'> {
  return {
    id: badge.id,
    code: badge.code,
    name: badge.name,
    imageUrl: toPublicMediaUrl(badge.iconUrl),
    description: badge.description,
    acquisitionDescription: resolvedAcquisitionForBadge(badge),
    visibility: badge.visibility,
    rarity: badge.rarity,
    grantType: badge.grantType,
    validityType: badge.validityType,
    validityDays: badge.validityDays,
    isWearable: badge.isWearable,
    isEnabled: badge.isEnabled && badge.isActive,
    effectType: badge.effectType,
    nicknameEffect: badge.nicknameEffect,
    nicknameColor: badge.nicknameColor,
    nicknameGradientStart: badge.nicknameGradientStart,
    nicknameGradientEnd: badge.nicknameGradientEnd,
    sortOrder: badge.sortOrder,
    series: badge.Series ? {
      id: badge.Series.id,
      code: badge.Series.code,
      name: badge.Series.name,
      description: badge.Series.description,
      sortOrder: badge.Series.sortOrder,
      isEnabled: badge.Series.isEnabled,
    } : null,
    tierGroupCode: badge.tierGroupCode,
    tierLevel: badge.tierLevel,
    availabilityStatus: getBadgeAvailability(badge),
    availableFrom: badge.availableFrom?.toISOString() || null,
    availableUntil: badge.availableUntil?.toISOString() || null,
  }
}

function equippedBadgeView(row: DbUserEquippedBadge, ownership: DbEquippedOwnership): EquippedBadgeView {
  return {
    id: row.Badge.id,
    position: row.position,
    code: row.Badge.code,
    name: row.Badge.name,
    imageUrl: toPublicMediaUrl(row.Badge.iconUrl),
    effectType: row.Badge.effectType,
    nicknameEffect: row.Badge.nicknameEffect,
    nicknameColor: row.Badge.nicknameColor,
    nicknameGradientStart: row.Badge.nicknameGradientStart,
    nicknameGradientEnd: row.Badge.nicknameGradientEnd,
    rarity: row.Badge.rarity,
    obtainedAt: ownership.obtainedAt.toISOString(),
    expiresAt: ownership.expiresAt?.toISOString() || null,
    validityType: row.Badge.validityType,
    validityDays: row.Badge.validityDays,
    description: row.Badge.description,
    acquisitionDescription: resolvedAcquisitionForBadge(row.Badge),
    isWearable: row.Badge.isWearable,
    isEnabled: row.Badge.isEnabled && row.Badge.isActive,
  }
}

function obtainedBadgeView(record: DbUserBadge, isEquipped: boolean, ownershipStats?: BadgeOwnershipStats | null, isHighestTier = false, position?: number): BadgeView {
  const badge = publicBadge(record.Badge)
  // Keep the public source wording stable: 于「天使的礼物」执药获得.
  return {
    ...badge,
    acquisitionDescription: resolveBadgeAcquisitionDescription({
      storedDescription: badge.acquisitionDescription,
      hasAngelGiftPrize: 'PharmacyPrize' in record.Badge && record.Badge.PharmacyPrize.length > 0,
      obtainedFromAngelGift: record.sourceType === 'ANGEL_GIFT',
    }),
    status: 'OBTAINED',
    obtainedAt: record.obtainedAt.toISOString(),
    expiresAt: record.expiresAt?.toISOString() || null,
    validityType: record.Badge.validityType,
    validityDays: record.Badge.validityDays,
    remainingDays: remainingBadgeDays(record.expiresAt),
    isEquipped,
    ...(isEquipped && typeof position === 'number' ? { position } : {}),
    isHighestTier,
    ownershipStats: ownershipStats || null,
  }
}

function badgeHistoryView(record: DbUserBadge): BadgeHistoryView {
  const runtimeExpired = record.status === 'ACTIVE' && !isUserBadgeActive(record)
  const status = runtimeExpired ? 'EXPIRED' : record.status
  return {
    recordId: record.id,
    badge: publicBadge(record.Badge),
    awardedAt: record.awardedAt.toISOString(),
    obtainedAt: record.obtainedAt.toISOString(),
    expiresAt: record.expiresAt?.toISOString() || null,
    expiredAt: record.expiredAt?.toISOString() || (runtimeExpired ? record.expiresAt?.toISOString() || null : null),
    revokedAt: record.revokedAt?.toISOString() || null,
    status,
    sourceType: record.sourceType,
    grantReason: record.grantReason,
  }
}

function hiddenBadgeView(badge: DbBadge): BadgeView {
  return {
    id: badge.id,
    name: '???',
    imageUrl: null,
    description: null,
    acquisitionDescription: null,
    visibility: 'HIDDEN',
    rarity: 'COMMON',
    grantType: 'MANUAL',
    isWearable: false,
    isEnabled: badge.isEnabled && badge.isActive,
    effectType: 'NONE',
    nicknameEffect: 'NONE',
    nicknameColor: null,
    nicknameGradientStart: null,
    nicknameGradientEnd: null,
    sortOrder: badge.sortOrder,
    status: 'HIDDEN',
    obtainedAt: null,
    isEquipped: false,
    availabilityStatus: undefined,
    progress: null,
    ownershipStats: null,
  }
}

function sortBadgeViews(items: BadgeView[], equippedPositions: ReadonlyMap<string, number>) {
  return items.sort((left, right) => {
    const leftPosition = equippedPositions.get(left.id)
    const rightPosition = equippedPositions.get(right.id)
    if (leftPosition !== undefined || rightPosition !== undefined) {
      if (leftPosition === undefined) return 1
      if (rightPosition === undefined) return -1
      if (leftPosition !== rightPosition) return leftPosition - rightPosition
    }
    const rank = (item: BadgeView) => item.status === 'OBTAINED' ? 0 : item.progress ? 1 : item.status === 'HIDDEN' ? 3 : 2
    if (rank(left) !== rank(right)) return rank(left) - rank(right)
    if (left.sortOrder !== right.sortOrder) return left.sortOrder - right.sortOrder
    const leftTime = left.obtainedAt ? new Date(left.obtainedAt).getTime() : 0
    const rightTime = right.obtainedAt ? new Date(right.obtainedAt).getTime() : 0
    return rightTime - leftTime || left.name.localeCompare(right.name, 'zh-CN')
  })
}

function seriesView(series: NonNullable<DbCollectionBadge['Series']>) {
  return {
    id: series.id,
    code: series.code,
    name: series.name,
    description: series.description,
    sortOrder: series.sortOrder,
    isEnabled: series.isEnabled,
  }
}

async function buildShowcaseViews(
  userId: string,
  isSelf: boolean,
  recordByBadgeId: ReadonlyMap<string, DbUserBadge>,
): Promise<BadgeShowcaseItemView[]> {
  const rows = await prisma.userBadgeShowcase.findMany({
    where: {
      userId,
      Badge: {
        isEnabled: true,
        isActive: true,
        ...(isSelf ? {} : { visibility: { not: 'SECRET' as const } }),
      },
    },
    orderBy: [{ slot: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
    select: { slot: true, badgeId: true },
  })
  return rows.flatMap((row) => {
    const record = recordByBadgeId.get(row.badgeId)
    if (!record) return []
    return [{ slot: row.slot, badge: obtainedBadgeView(record, false) }]
  })
}

async function buildSeriesCompletionViews(
  badges: readonly DbCollectionBadge[],
  ownedIds: ReadonlySet<string>,
  itemByBadgeId: ReadonlyMap<string, BadgeView>,
) {
  const seriesIds = [...new Set(badges.map((badge) => badge.seriesId).filter((id): id is string => Boolean(id)))]
  if (!seriesIds.length) return []
  const seriesRows = await prisma.badgeSeries.findMany({
    where: { id: { in: seriesIds } },
    orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
    select: {
      id: true,
      code: true,
      name: true,
      description: true,
      sortOrder: true,
      isEnabled: true,
      CompletionRewardBadge: { select: BADGE_COLLECTION_SELECT },
    },
  })
  return seriesRows.flatMap((series) => {
    const candidates = badges.filter((badge) => badge.seriesId === series.id && badge.countsTowardSeriesCompletion && badge.isEnabled && badge.isActive && (badge.visibility !== 'SECRET' || ownedIds.has(badge.id)))
    if (!candidates.length) return []
    const collected = candidates.filter((badge) => ownedIds.has(badge.id)).length
    const rewardBadge = series.CompletionRewardBadge
    let reward: BadgeView | null = null
    if (rewardBadge) {
      const ownedReward = itemByBadgeId.get(rewardBadge.id)
      if (ownedReward) reward = ownedReward
      else if (rewardBadge.visibility === 'PUBLIC') reward = { ...publicBadge(rewardBadge), status: 'NOT_OBTAINED', obtainedAt: null, isEquipped: false, progress: null }
      else if (rewardBadge.visibility === 'HIDDEN') reward = hiddenBadgeView(rewardBadge)
    }
    const total = candidates.length
    return [{
      series: seriesView({ ...series, id: series.id }),
      collected,
      total,
      percentage: Math.floor((collected / total) * 100),
      completed: collected === total,
      reward,
    }]
  })
}

function getHighestOwnedTierByGroup(badges: readonly DbCollectionBadge[], ownedIds: ReadonlySet<string>) {
  const highest = new Map<string, number>()
  for (const badge of badges) {
    if (!ownedIds.has(badge.id) || !badge.tierGroupCode || !badge.tierLevel) continue
    const current = highest.get(badge.tierGroupCode) || 0
    if (badge.tierLevel > current) highest.set(badge.tierGroupCode, badge.tierLevel)
  }
  return highest
}

async function addProgressToUnownedBadges(userId: string, badges: readonly DbCollectionBadge[], items: BadgeView[]) {
  const candidates = badges.filter((badge) => canExposeLiveBadgeProgress(badge))
  if (!candidates.length) return
  const metrics = new Map<string, number>()
  const itemByBadgeId = new Map(items.map((item) => [item.id, item]))
  for (const badge of candidates) {
    const rule = badge.BadgeRule
    if (!rule) continue
    const type = rule.ruleType as Parameters<typeof getUserBadgeMetric>[1]
    if (!metrics.has(type)) metrics.set(type, await getUserBadgeMetric(userId, type))
    const item = itemByBadgeId.get(badge.id)
    if (item?.status === 'NOT_OBTAINED') item.progress = calculateBadgeRuleProgress(metrics.get(type) || 0, rule)
  }
}

export async function getBadgeCollection(userId: string, viewerId?: string | null): Promise<BadgeCollectionView | null> {
  const target = await prisma.user.findFirst({
    where: { id: userId, status: 'ACTIVE', isDeleted: false, Profile: { isNot: null } },
    select: {
      id: true,
      uid: true,
    },
  })
  if (!target) return null

  const isSelf = viewerId === userId
  const now = new Date()
  const [equippedBadges, records, historyRecords, allBadges] = await Promise.all([
    getEquippedBadgesForUser(userId),
    prisma.userBadge.findMany({
      where: { userId, ...activeUserBadgeWhere(now), ...(isSelf ? {} : { isHidden: false }) },
      orderBy: [{ awardedAt: 'desc' }, { grantedAt: 'desc' }, { id: 'desc' }],
      select: USER_BADGE_SELECT,
    }),
    isSelf
      ? prisma.userBadge.findMany({ where: { userId }, orderBy: [{ awardedAt: 'desc' }, { id: 'desc' }], select: USER_BADGE_SELECT })
      : Promise.resolve([] as DbUserBadge[]),
    isSelf
      ? prisma.badge.findMany({
          where: { OR: [{ isEnabled: true, isActive: true }, { UserBadge: { some: { userId } } }] },
          orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
          select: BADGE_COLLECTION_SELECT,
        })
      : Promise.resolve([] as DbCollectionBadge[]),
  ])

  const visibleRecords = isSelf ? records : records.filter((record) => record.Badge.visibility !== 'SECRET')
  const visibleRecordIds = new Set(visibleRecords.map((record) => record.Badge.id))
  const visibleEquippedBadges = equippedBadges.filter((badge) => visibleRecordIds.has(badge.id))
  const equippedBadgeId = visibleEquippedBadges[0]?.id || null
  const equippedPositions = new Map(visibleEquippedBadges.map((badge, index) => [badge.id, badge.position ?? index]))
  const recordByBadgeId = new Map(visibleRecords.map((record) => [record.Badge.id, record]))

  if (!isSelf) {
    const stats = await getBadgeOwnershipStats(visibleRecords.filter((record) => record.Badge.visibility === 'PUBLIC').map((record) => record.Badge.id))
    const highest = getHighestOwnedTierByGroup(visibleRecords.map((record) => record.Badge), new Set(visibleRecords.map((record) => record.Badge.id)))
    const recordByVisibleBadgeId = new Map(visibleRecords.map((record) => [record.Badge.id, record]))
    const showcase = await buildShowcaseViews(userId, false, recordByVisibleBadgeId)
    const recent = visibleRecords.slice(0, 5).map((record) => obtainedBadgeView(record, equippedPositions.has(record.Badge.id), undefined, false, equippedPositions.get(record.Badge.id)))
    return {
      target: { id: target.id, uid: target.uid },
      isSelf: false,
      equippedBadges: visibleEquippedBadges,
      equippedBadgeId,
      obtainedCount: visibleRecords.length,
      visibleTotal: visibleRecords.length,
      publicObtainedCount: visibleRecords.filter((record) => record.Badge.visibility === 'PUBLIC').length,
      publicTotal: visibleRecords.filter((record) => record.Badge.visibility === 'PUBLIC').length,
      hiddenObtainedCount: visibleRecords.filter((record) => record.Badge.visibility === 'HIDDEN').length,
      items: sortBadgeViews(visibleRecords.map((record) => obtainedBadgeView(record, equippedPositions.has(record.Badge.id), stats.get(record.Badge.id) || null, Boolean(record.Badge.tierGroupCode && record.Badge.tierLevel && highest.get(record.Badge.tierGroupCode) === record.Badge.tierLevel), equippedPositions.get(record.Badge.id))), equippedPositions),
      showcase,
      recent,
      seriesCompletions: [],
    }
  }

  const ownershipStats = await getBadgeOwnershipStats(allBadges.filter((badge) => badge.visibility === 'PUBLIC').map((badge) => badge.id))
  const ownedIds = new Set(records.map((record) => record.Badge.id))
  const highest = getHighestOwnedTierByGroup(allBadges, ownedIds)
  const items = allBadges.flatMap((badge) => {
    const record = recordByBadgeId.get(badge.id)
    if (record) return [obtainedBadgeView(record, equippedPositions.has(badge.id), ownershipStats.get(badge.id) || null, Boolean(badge.tierGroupCode && badge.tierLevel && highest.get(badge.tierGroupCode) === badge.tierLevel), equippedPositions.get(badge.id))]
    if (badge.visibility === 'SECRET') return []
    return [badge.visibility === 'HIDDEN'
      ? hiddenBadgeView(badge)
      : { ...publicBadge(badge), status: 'NOT_OBTAINED' as const, obtainedAt: null, isEquipped: false, progress: null, ownershipStats: ownershipStats.get(badge.id) || null }]
  })

  await addProgressToUnownedBadges(userId, allBadges, items)

  const publicBadges = allBadges.filter((badge) => badge.isEnabled && badge.isActive && badge.visibility === 'PUBLIC')
  const hiddenBadges = allBadges.filter((badge) => badge.isEnabled && badge.isActive && badge.visibility === 'HIDDEN')
  const publicObtainedCount = records.filter((record) => record.Badge.visibility === 'PUBLIC').length
  const hiddenObtainedCount = records.filter((record) => record.Badge.visibility === 'HIDDEN').length
  const itemByBadgeId = new Map(items.map((item) => [item.id, item]))
  const showcase = await buildShowcaseViews(userId, true, recordByBadgeId)
  const recent = records.slice(0, 5).flatMap((record) => itemByBadgeId.get(record.Badge.id) ? [itemByBadgeId.get(record.Badge.id)!] : [])
  const seriesCompletions = await buildSeriesCompletionViews(allBadges, ownedIds, itemByBadgeId)

  return {
    target: { id: target.id, uid: target.uid },
    isSelf: true,
    equippedBadges: equippedBadges,
    equippedBadgeId,
    obtainedCount: records.length,
    visibleTotal: allBadges.filter((badge) => badge.isEnabled && badge.isActive && badge.visibility !== 'SECRET').length,
    publicObtainedCount,
    publicTotal: publicBadges.length,
    hiddenObtainedCount,
    hiddenTotal: hiddenBadges.length,
    completionPercentage: publicBadges.length ? Math.floor((publicObtainedCount / publicBadges.length) * 100) : 0,
    items: sortBadgeViews(items, equippedPositions),
    showcase,
    recent,
    history: historyRecords.map(badgeHistoryView),
    seriesCompletions,
  }
}

/**
 * Reload the detail DTO for the current user. The detail modal uses this
 * no-store path so a newly completed check-in is reflected without trusting a
 * stale museum/collection payload or calculating metrics in the browser.
 */
export async function getBadgeDetailForUser(userId: string, badgeId: string): Promise<BadgeView | null> {
  const [badge, record, equippedBadges] = await Promise.all([
    prisma.badge.findUnique({ where: { id: badgeId }, select: BADGE_COLLECTION_SELECT }),
    prisma.userBadge.findFirst({
      where: { userId, badgeId, ...activeUserBadgeWhere() },
      orderBy: [{ awardedAt: 'desc' }, { id: 'desc' }],
      select: USER_BADGE_SELECT,
    }),
    getEquippedBadgesForUser(userId),
  ])
  if (!badge) return null
  if (!record && (!badge.isEnabled || !badge.isActive)) return null
  if (!record && badge.visibility === 'SECRET') return null

  const ownershipStats = badge.visibility === 'PUBLIC'
    ? (await getBadgeOwnershipStats([badge.id])).get(badge.id) || null
    : null
  const equippedPosition = equippedBadges.find((equipped) => equipped.id === badge.id)?.position
  if (record) return obtainedBadgeView(record, equippedPosition !== undefined, ownershipStats, false, equippedPosition)
  if (badge.visibility === 'HIDDEN') return hiddenBadgeView(badge)

  const detail: BadgeView = {
    ...publicBadge(badge),
    status: 'NOT_OBTAINED',
    obtainedAt: null,
    isEquipped: false,
    progress: null,
    ownershipStats,
  }
  if (canExposeLiveBadgeProgress(badge)) {
    detail.progress = await getUserBadgeRuleProgress(userId, badge.BadgeRule)
  }
  return detail
}

/**
 * Load the public exhibition hall in one bounded catalog query plus one bounded
 * ownership query. The response is already privacy-filtered; the client never
 * receives an unearned SECRET or an unearned HIDDEN badge's real metadata.
 */
export async function getBadgeExhibitionGallery(viewerId?: string | null): Promise<BadgeGalleryView> {
  const isAuthenticated = Boolean(viewerId)
  const [allBadges, ownedRecords, equippedBadges] = await Promise.all([
    prisma.badge.findMany({
      where: viewerId
        ? { OR: [{ isEnabled: true, isActive: true }, { UserBadge: { some: { userId: viewerId } } }] }
        : { isEnabled: true, isActive: true },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
      select: BADGE_COLLECTION_SELECT,
    }),
    viewerId
      ? prisma.userBadge.findMany({
          where: { userId: viewerId, ...activeUserBadgeWhere() },
          orderBy: [{ awardedAt: 'desc' }, { grantedAt: 'desc' }, { id: 'desc' }],
          select: USER_BADGE_SELECT,
        })
      : Promise.resolve([] as DbUserBadge[]),
    viewerId ? getEquippedBadgesForUser(viewerId) : Promise.resolve([] as EquippedBadgeView[]),
  ])

  const ownedIds = new Set(ownedRecords.map((record) => record.Badge.id))
  const recordByBadgeId = new Map(ownedRecords.map((record) => [record.Badge.id, record]))
  const equippedIds = new Set(equippedBadges.filter((badge) => ownedIds.has(badge.id)).map((badge) => badge.id))
  const equippedPositions = new Map(equippedBadges.filter((badge) => ownedIds.has(badge.id)).map((badge, index) => [badge.id, badge.position ?? index]))
  const publicIds = allBadges
    .filter((badge) => badge.isEnabled && badge.isActive && badge.visibility === 'PUBLIC')
    .map((badge) => badge.id)
  const ownershipStats = await getBadgeOwnershipStats(publicIds)
  const highest = getHighestOwnedTierByGroup(allBadges, ownedIds)
  const visibleBadges = allBadges.filter((badge) => badge.visibility !== 'SECRET' || ownedIds.has(badge.id))
  const items = visibleBadges.flatMap((badge) => {
    const owned = recordByBadgeId.get(badge.id)
    if (owned) {
      return [obtainedBadgeView(
        owned,
        equippedIds.has(badge.id),
        ownershipStats.get(badge.id) || null,
        Boolean(badge.tierGroupCode && badge.tierLevel && highest.get(badge.tierGroupCode) === badge.tierLevel),
        equippedPositions.get(badge.id),
      )]
    }
    if (badge.visibility === 'SECRET') return []
    if (badge.visibility === 'HIDDEN') return [hiddenBadgeView(badge)]
    return [{
      ...publicBadge(badge),
      status: 'NOT_OBTAINED' as const,
      obtainedAt: null,
      isEquipped: false,
      progress: null,
      ownershipStats: ownershipStats.get(badge.id) || null,
    }]
  })

  if (viewerId) await addProgressToUnownedBadges(viewerId, allBadges, items)

  // Hidden unearned badges are intentionally excluded from these named
  // sections, so a series name cannot be used to infer a hidden condition.
  const seriesIds = [...new Set(visibleBadges
    .filter((badge) => badge.visibility !== 'HIDDEN' || ownedIds.has(badge.id))
    .map((badge) => badge.seriesId)
    .filter((id): id is string => Boolean(id)))]
  const seriesRows = seriesIds.length
    ? await prisma.badgeSeries.findMany({
        where: { id: { in: seriesIds } },
        orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
        select: {
          id: true,
          code: true,
          name: true,
          description: true,
          sortOrder: true,
          isEnabled: true,
          CompletionRewardBadge: { select: BADGE_COLLECTION_SELECT },
        },
      })
    : []
  const itemByBadgeId = new Map(items.map((item) => [item.id, item]))
  const series = seriesRows.flatMap((row) => {
    const candidates = visibleBadges.filter((badge) => (
      badge.seriesId === row.id
      && badge.isEnabled
      && badge.isActive
      && badge.countsTowardSeriesCompletion
      && (badge.visibility !== 'HIDDEN' || ownedIds.has(badge.id))
    ))
    if (!candidates.length) return []
    const collected = candidates.filter((badge) => ownedIds.has(badge.id)).length
    const rewardBadge = row.CompletionRewardBadge
    let reward: BadgeView | null = null
    if (rewardBadge) {
      const existing = itemByBadgeId.get(rewardBadge.id)
      if (existing) reward = existing
      else if (rewardBadge.visibility === 'PUBLIC') reward = {
        ...publicBadge(rewardBadge),
        status: 'NOT_OBTAINED',
        obtainedAt: null,
        isEquipped: false,
        progress: null,
        ownershipStats: ownershipStats.get(rewardBadge.id) || null,
      }
      else if (rewardBadge.visibility === 'HIDDEN') reward = hiddenBadgeView(rewardBadge)
    }
    const total = candidates.length
    return [{
      series: seriesView(row),
      collected,
      total,
      percentage: total ? Math.floor((collected / total) * 100) : 0,
      completed: total > 0 && collected === total,
      reward,
    }]
  })

  const collectibleTotal = allBadges.filter((badge) => badge.isEnabled && badge.isActive && badge.visibility === 'PUBLIC').length
  const collectibleObtainedCount = allBadges.filter((badge) => badge.isEnabled && badge.isActive && badge.visibility === 'PUBLIC' && ownedIds.has(badge.id)).length
  return {
    isAuthenticated,
    items,
    total: items.length,
    obtainedCount: items.filter((item) => item.status === 'OBTAINED').length,
    collectibleTotal,
    collectibleObtainedCount,
    completionPercentage: collectibleTotal ? Math.floor((collectibleObtainedCount / collectibleTotal) * 100) : 0,
    series,
  }
}

/** Lightweight profile payload: it never loads the full catalog or computes live progress. */
export async function getBadgeProfileSummary(userId: string, viewerId?: string | null): Promise<BadgeCollectionView | null> {
  const target = await prisma.user.findFirst({
    where: { id: userId, status: 'ACTIVE', isDeleted: false, Profile: { isNot: null } },
    select: { id: true, uid: true },
  })
  if (!target) return null
  const isSelf = viewerId === userId
  const now = new Date()
  const [ownedCount, publicObtainedCount, hiddenObtainedCount, publicTotal, hiddenTotal, records, showcaseRows, equippedBadges] = await Promise.all([
    prisma.userBadge.count({ where: { userId, ...activeUserBadgeWhere(now) } }),
    prisma.userBadge.count({ where: { userId, ...activeUserBadgeWhere(now), ...(isSelf ? {} : { isHidden: false }), Badge: { visibility: 'PUBLIC' } } }),
    prisma.userBadge.count({ where: { userId, ...activeUserBadgeWhere(now), ...(isSelf ? {} : { isHidden: false }), Badge: { visibility: 'HIDDEN' } } }),
    prisma.badge.count({ where: { isEnabled: true, isActive: true, visibility: 'PUBLIC' } }),
    prisma.badge.count({ where: { isEnabled: true, isActive: true, visibility: 'HIDDEN' } }),
    prisma.userBadge.findMany({
      where: { userId, ...activeUserBadgeWhere(now), ...(isSelf ? {} : { isHidden: false }) },
      orderBy: [{ awardedAt: 'desc' }, { grantedAt: 'desc' }, { id: 'desc' }],
      take: 5,
      select: USER_BADGE_SELECT,
    }),
    prisma.userBadgeShowcase.findMany({
      where: {
        userId,
        Badge: { isEnabled: true, isActive: true, ...(isSelf ? {} : { visibility: { not: 'SECRET' as const } }) },
      },
      orderBy: [{ slot: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
      select: { slot: true, badgeId: true, Badge: { select: BADGE_COLLECTION_SELECT } },
    }),
    getEquippedBadgesForUser(userId),
  ])
  const visibleRecords = records.filter((record) => isSelf || record.Badge.visibility !== 'SECRET')
  const equippedOwnershipRows = equippedBadges.length
    ? await prisma.userBadge.findMany({
        where: { userId, badgeId: { in: equippedBadges.map((badge) => badge.id) }, ...activeUserBadgeWhere(now) },
        select: { badgeId: true, isHidden: true, Badge: { select: { visibility: true } } },
      })
    : []
  const equippedOwnershipByBadgeId = new Map(equippedOwnershipRows.map((row) => [row.badgeId, row]))
  const visibleEquippedBadges = equippedBadges.filter((badge) => {
    const ownership = equippedOwnershipByBadgeId.get(badge.id)
    return Boolean(ownership && (isSelf || (!ownership.isHidden && ownership.Badge.visibility !== 'SECRET')))
  })
  const equippedPositions = new Map(visibleEquippedBadges.map((badge, index) => [badge.id, badge.position ?? index]))
  const equippedBadgeId = visibleEquippedBadges[0]?.id || null
  const showcaseOwnedRecords = showcaseRows.length
    ? await prisma.userBadge.findMany({
      where: { userId, badgeId: { in: showcaseRows.map((row) => row.badgeId) }, ...activeUserBadgeWhere(now), ...(isSelf ? {} : { isHidden: false }) },
      orderBy: [{ awardedAt: 'desc' }, { id: 'desc' }],
        select: USER_BADGE_SELECT,
      })
    : []
  const recordByBadgeId = new Map(showcaseOwnedRecords.filter((record) => isSelf || record.Badge.visibility !== 'SECRET').map((record) => [record.Badge.id, record]))
  const showcase = showcaseRows.flatMap((row) => {
    const record = recordByBadgeId.get(row.badgeId)
    if (!record) return []
    return [{ slot: row.slot, badge: obtainedBadgeView(record, equippedPositions.has(row.badgeId), undefined, false, equippedPositions.get(row.badgeId)) }]
  })
  const recent = visibleRecords.map((record) => obtainedBadgeView(record, equippedPositions.has(record.Badge.id), undefined, false, equippedPositions.get(record.Badge.id)))
  return {
    target: { id: target.id, uid: target.uid },
    isSelf,
    equippedBadges: visibleEquippedBadges,
    equippedBadgeId,
    obtainedCount: isSelf ? ownedCount : publicObtainedCount + hiddenObtainedCount,
    visibleTotal: publicTotal + hiddenTotal,
    publicObtainedCount,
    publicTotal,
    hiddenObtainedCount,
    hiddenTotal,
    completionPercentage: publicTotal ? Math.floor((publicObtainedCount / publicTotal) * 100) : 0,
    items: recent,
    recent,
    showcase,
    seriesCompletions: [],
  }
}

export async function updateUserBadgeShowcase(userId: string, badgeIds: readonly string[]) {
  const normalized = [...new Set(badgeIds.map((value) => value.trim()).filter(Boolean))]
  if (normalized.length > 6) throw new BadgeServiceError('NOT_FOUND', '荣誉橱窗最多展示 6 枚勋章')
  if (normalized.some((badgeId) => badgeId.length > 191)) throw new BadgeServiceError('NOT_FOUND', '荣誉橱窗勋章标识无效')
  return prisma.$transaction(async (tx) => {
    const owned = await tx.userBadge.findMany({
      where: {
        userId,
        badgeId: { in: normalized },
        ...activeUserBadgeWhere(),
        Badge: { isEnabled: true, isActive: true },
      },
      select: { badgeId: true },
    })
    if (owned.length !== normalized.length) throw new BadgeServiceError('NOT_OWNED', '橱窗只能展示自己已获得且仍启用的勋章')
    await tx.userBadgeShowcase.deleteMany({ where: { userId } })
    if (normalized.length) await tx.userBadgeShowcase.createMany({ data: normalized.map((badgeId, index) => ({ userId, badgeId, slot: index + 1 })) })
    return { badgeIds: normalized, count: normalized.length }
  })
}

export async function getUserBadgeShowcase(userId: string, viewerId?: string | null) {
  const summary = await getBadgeProfileSummary(userId, viewerId)
  return summary?.showcase || []
}

export async function getRecentUserBadges(userId: string, viewerId?: string | null, limit = 5) {
  const summary = await getBadgeProfileSummary(userId, viewerId)
  return (summary?.recent || []).slice(0, Math.min(5, Math.max(1, Math.trunc(limit) || 5)))
}

/**
 * Resolve all currently equipped badges for a batch of users. The relation and
 * ownership records are loaded in bounded queries, then joined in memory so a
 * feed with many authors never creates one query per nickname.
 */
export async function getEquippedBadgesForUsers(userIds: Iterable<string>, now = new Date()) {
  const ids = [...new Set([...userIds].filter(Boolean))]
  const result = new Map<string, EquippedBadgeView[]>(ids.map((id) => [id, []]))
  if (!ids.length) return result

  const rows = await prisma.userEquippedBadge.findMany({
    where: {
      userId: { in: ids },
      Badge: { isEnabled: true, isActive: true, isWearable: true },
    },
    orderBy: [{ position: 'asc' }, { equippedAt: 'asc' }, { id: 'asc' }],
    select: USER_EQUIPPED_BADGE_SELECT,
  })
  if (!rows.length) return result

  const records = await prisma.userBadge.findMany({
    where: {
      userId: { in: ids },
      badgeId: { in: [...new Set(rows.map((row) => row.badgeId))] },
      ...activeUserBadgeWhere(now),
    },
    orderBy: [{ awardedAt: 'desc' }, { id: 'desc' }],
    select: { userId: true, badgeId: true, obtainedAt: true, expiresAt: true, status: true },
  })
  const recordByUserBadge = new Map<string, DbEquippedOwnership>()
  for (const record of records) {
    if (isUserBadgeActive(record, now)) {
      const key = `${record.userId}:${record.badgeId}`
      if (!recordByUserBadge.has(key)) recordByUserBadge.set(key, record)
    }
  }

  for (const row of rows) {
    const ownership = recordByUserBadge.get(`${row.userId}:${row.badgeId}`)
    if (!ownership) continue
    result.get(row.userId)?.push(equippedBadgeView(row, ownership))
  }
  return result
}

export async function getEquippedBadgesForUser(userId: string): Promise<EquippedBadgeView[]> {
  return (await getEquippedBadgesForUsers([userId])).get(userId) || []
}

/**
 * Compatibility projection for legacy single-badge DTOs. The canonical
 * equipment query remains plural; older public payloads deliberately expose
 * only the first ordered badge until their contracts are upgraded.
 */
export function getPrimaryEquippedBadgeMap(equippedBadges: ReadonlyMap<string, EquippedBadgeView[]>) {
  return new Map<string, EquippedBadgeView>(
    [...equippedBadges.entries()].flatMap(([userId, badges]) => badges[0] ? [[userId, badges[0]] as const] : []),
  )
}

/** Compatibility helper for callers that still need the first badge only. */
export async function getEquippedBadgeForUser(userId: string): Promise<EquippedBadgeView | null> {
  return (await getEquippedBadgesForUser(userId))[0] || null
}

function stableGrantHash(value: string) {
  return createHash('sha256').update(value).digest('hex')
}

function activeBadgeKey(userId: string, badgeId: string) {
  return stableGrantHash(`active:${userId}:${badgeId}`)
}

function namespacedGrantKey(input: GrantBadgeInput) {
  const raw = input.grantKey?.trim() || (input.sourceType?.trim() && input.sourceId?.trim() ? `${input.sourceType.trim()}:${input.sourceId.trim()}` : null)
  return raw ? stableGrantHash(`grant:${input.userId}:${input.badgeId}:${raw}`) : null
}

function acquisitionSourceKey(userId: string, badgeId: string, sourceType: string | null, sourceId: string | null, grantKey: string | null) {
  const type = sourceType || 'UNSPECIFIED'
  const identity = sourceId || grantKey || 'default'
  return stableGrantHash(`badge-source:${userId}:${badgeId}:${type}:${identity}`)
}

async function lockUserForMutation(tx: Prisma.TransactionClient, userId: string) {
  await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM \`User\` WHERE id = ${userId} FOR UPDATE`
}

function operationResult(input: GrantBadgeInput, badgeName: string, recordId: string, sourceAttached = false): BadgeOperationResult {
  return { created: false, alreadyOwned: true, sourceAttached, recordId, userId: input.userId, badgeId: input.badgeId, badgeName }
}

async function loadActiveBadgeSources(tx: Prisma.TransactionClient, userId: string, badgeId: string, now: Date) {
  return tx.userBadgeSource.findMany({
    where: { userId, badgeId, isActive: true, OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] },
    select: { id: true, sourceType: true, sourceId: true, isActive: true, expiresAt: true },
  })
}

async function clearBadgePresentationIfUnowned(tx: Prisma.TransactionClient, userId: string, badgeId: string) {
  await tx.userEquippedBadge.deleteMany({ where: { userId, badgeId } })
  // Keep clearing the legacy column while old rows may still exist during the
  // migration boundary. New runtime writes never use this column.
  await tx.user.updateMany({ where: { id: userId, equippedBadgeId: badgeId }, data: { equippedBadgeId: null } })
  await tx.userBadgeShowcase.deleteMany({ where: { userId, badgeId } })
}

/** Recompute the aggregate UserBadge expiry from all currently valid sources. */
async function refreshBadgeAggregate(tx: Prisma.TransactionClient, userId: string, badgeId: string, now: Date) {
  const record = await tx.userBadge.findFirst({
    where: { userId, badgeId, status: 'ACTIVE' },
    orderBy: [{ awardedAt: 'desc' }, { id: 'desc' }],
    select: { id: true, expiresAt: true },
  })
  if (!record) return { owned: false, recordId: null as string | null, changed: false }
  const sources = await loadActiveBadgeSources(tx, userId, badgeId, now)
  if (!sources.length) return { owned: false, recordId: record.id, changed: false }
  const expiresAt = sources.some((source) => !source.expiresAt)
    ? null
    : sources.reduce<Date | null>((latest, source) => !latest || (source.expiresAt && source.expiresAt > latest) ? source.expiresAt : latest, null)
  const changed = (record.expiresAt?.getTime() || null) !== (expiresAt?.getTime() || null)
  if (changed) await tx.userBadge.update({ where: { id: record.id }, data: { expiresAt, expiredAt: null, revokedAt: null, activeKey: activeBadgeKey(userId, badgeId) } })
  return { owned: true, recordId: record.id, changed }
}

async function expireStaleUserBadgeRows(tx: Prisma.TransactionClient, input: GrantBadgeInput, now: Date) {
  await tx.userBadgeSource.updateMany({
    where: { userId: input.userId, badgeId: input.badgeId, isActive: true, expiresAt: { not: null, lte: now } },
    data: { isActive: false, expiredAt: now },
  })
  const aggregate = await refreshBadgeAggregate(tx, input.userId, input.badgeId, now)
  if (aggregate.owned) return
  const stale = await tx.userBadge.findMany({
    where: { userId: input.userId, badgeId: input.badgeId, status: 'ACTIVE', expiresAt: { not: null, lte: now } },
    select: { id: true },
  })
  if (!stale.length) return
  await tx.userBadge.updateMany({
    where: { id: { in: stale.map((row) => row.id) }, status: 'ACTIVE' },
    data: { status: 'EXPIRED', expiredAt: now, activeKey: null },
  })
  await clearBadgePresentationIfUnowned(tx, input.userId, input.badgeId)
}

async function upsertBadgeAcquisitionSource(tx: Prisma.TransactionClient, input: {
  userId: string
  badgeId: string
  userBadgeId: string
  sourceKey: string
  sourceType: string | null
  sourceId: string | null
  grantReason: string | null
  grantedBy: string | null
  grantedAt: Date
  expiresAt: Date | null
  active: boolean
}) {
  const sourceType = input.sourceType || 'UNSPECIFIED'
  await tx.userBadgeSource.upsert({
    where: { sourceKey: input.sourceKey },
    update: {
      userBadgeId: input.userBadgeId,
      userId: input.userId,
      badgeId: input.badgeId,
      sourceType,
      sourceId: input.sourceId,
      isActive: input.active,
      grantedAt: input.grantedAt,
      expiresAt: input.expiresAt,
      expiredAt: input.active ? null : input.expiresAt,
      revokedAt: null,
      grantReason: input.grantReason,
      grantedBy: input.grantedBy,
    },
    create: {
      sourceKey: input.sourceKey,
      userBadgeId: input.userBadgeId,
      userId: input.userId,
      badgeId: input.badgeId,
      sourceType,
      sourceId: input.sourceId,
      isActive: input.active,
      grantedAt: input.grantedAt,
      expiresAt: input.expiresAt,
      expiredAt: input.active ? null : input.expiresAt,
      grantReason: input.grantReason,
      grantedBy: input.grantedBy,
    },
  })
}

async function grantBadgeInTransaction(tx: Prisma.TransactionClient, input: GrantBadgeInput): Promise<BadgeOperationResult> {
  const now = new Date()
  const awardedAt = input.obtainedAt || now
  const sourceType = input.sourceType?.trim().slice(0, 32) || null
  const sourceId = input.sourceId?.trim().slice(0, 191) || null
  const grantReason = input.grantReason?.trim().slice(0, 500) || null
  const grantKey = namespacedGrantKey(input)
  const sourceKey = acquisitionSourceKey(input.userId, input.badgeId, sourceType, sourceId, input.grantKey?.trim() || null)

  // All grant paths lock the User row first. This serializes concurrent
  // evaluators for one badge holder while activeKey remains the DB invariant.
  await lockUserForMutation(tx, input.userId)
  const user = await tx.user.findUnique({ where: { id: input.userId }, select: { id: true } })
  const badge = await tx.badge.findUnique({
    where: { id: input.badgeId },
    select: { id: true, name: true, isEnabled: true, isActive: true, availableFrom: true, availableUntil: true, validityType: true, validityDays: true },
  })
  if (!user) throw new BadgeServiceError('USER_NOT_FOUND', '目标用户不存在')
  if (!badge) throw new BadgeServiceError('BADGE_NOT_FOUND', '勋章不存在')

  if (grantKey) {
    const sameGrant = await tx.userBadge.findUnique({ where: { grantKey }, select: { id: true } })
    if (sameGrant) return operationResult(input, badge.name, sameGrant.id)
  }

  await expireStaleUserBadgeRows(tx, input, now)
  const active = await tx.userBadge.findFirst({
    where: { userId: input.userId, badgeId: input.badgeId, ...activeUserBadgeWhere(now) },
    orderBy: [{ awardedAt: 'desc' }, { id: 'desc' }],
    select: { id: true },
  })
  const expiresAt = calculateBadgeExpiresAt(awardedAt, badge.validityType, badge.validityDays)
  const awardedIsActive = !expiresAt || expiresAt > now
  if (active) {
    // UserBadge is the aggregate visible ownership row. Keep each earning
    // source independently so a later derived-rule revoke cannot remove a
    // manual, event, or other automatic source.
    const existingSource = await tx.userBadgeSource.findUnique({ where: { sourceKey }, select: { id: true, isActive: true } })
    await upsertBadgeAcquisitionSource(tx, {
      userId: input.userId,
      badgeId: input.badgeId,
      userBadgeId: active.id,
      sourceKey,
      sourceType,
      sourceId,
      grantReason,
      grantedBy: input.actorId || null,
      grantedAt: awardedAt,
      expiresAt,
      active: awardedIsActive,
    })
    if (sourceType === 'ADMIN_GRANT' || sourceType === 'ADMIN_BACKFILL') {
      await tx.userBadge.update({ where: { id: active.id }, data: { sourceType, sourceId, grantReason, grantedBy: input.actorId || null } })
    }
    await refreshBadgeAggregate(tx, input.userId, input.badgeId, now)
    const sourceAttached = !existingSource || !existingSource.isActive
    if (sourceAttached && input.actorId) await writeBadgeAdminAction(tx, {
      actorId: input.actorId,
      action: 'BADGE_GRANT',
      targetUserId: input.userId,
      badgeId: input.badgeId,
      detail: { badgeName: badge.name, awardedAt: awardedAt.toISOString(), expiresAt: expiresAt?.toISOString() || null, sourceType, sourceId, grantKey, grantReason, sourceAttached: true },
    })
    if (!sourceAttached) return operationResult(input, badge.name, active.id)
    return { ...operationResult(input, badge.name, active.id), sourceAttached: true }
  }

  if (!badge.isEnabled || !badge.isActive) throw new BadgeServiceError('BADGE_DISABLED', '这枚勋章当前已停用')
  const availability = getBadgeAvailability(badge)
  const availabilityMode = input.availabilityMode || 'CURRENT'
  if (availabilityMode === 'CURRENT' && availability !== 'PERMANENT' && availability !== 'AVAILABLE') {
    throw new BadgeServiceError('BADGE_NOT_AVAILABLE', availability === 'UPCOMING' ? '这枚限定勋章尚未开放' : '这枚限定勋章已经绝版，当前不能再授予')
  }
  if (availabilityMode === 'HISTORICAL_WINDOW') {
    if (availability === 'UPCOMING') throw new BadgeServiceError('BADGE_NOT_AVAILABLE', '这枚限定勋章尚未开始，不能进行历史资格补发')
    const window = input.historicalWindow
    if (availability !== 'PERMANENT' && (!window || !(window.from instanceof Date) || !(window.until instanceof Date) || Number.isNaN(window.from.getTime()) || Number.isNaN(window.until.getTime()) || window.from > window.until)) {
      throw new BadgeServiceError('BADGE_NOT_AVAILABLE', '历史资格补发缺少有效的限定时间窗口')
    }
  }
  if (availabilityMode === 'ADMIN_MANUAL' && availability !== 'PERMANENT' && !grantReason) {
    throw new BadgeServiceError('BADGE_NOT_AVAILABLE', '限定勋章手动补发必须填写补发原因')
  }

  const immediatelyExpired = Boolean(expiresAt && expiresAt <= now)
  const status = immediatelyExpired ? 'EXPIRED' : 'ACTIVE'
  const record = await tx.userBadge.create({
    data: {
      userId: input.userId,
      badgeId: input.badgeId,
      obtainedAt: awardedAt,
      awardedAt,
      grantedAt: awardedAt,
      createdAt: awardedAt,
      expiresAt,
      expiredAt: immediatelyExpired ? now : null,
      status,
      activeKey: status === 'ACTIVE' ? activeBadgeKey(input.userId, input.badgeId) : null,
      grantKey,
      sourceType,
      sourceId,
      grantReason,
      grantedBy: input.actorId || null,
    },
    select: { id: true },
  })

  await upsertBadgeAcquisitionSource(tx, {
    userId: input.userId,
    badgeId: input.badgeId,
    userBadgeId: record.id,
    sourceKey,
    sourceType,
    sourceId,
    grantReason,
    grantedBy: input.actorId || null,
    grantedAt: awardedAt,
    expiresAt,
    active: status === 'ACTIVE',
  })

  await tx.userBadgeTracking.deleteMany({ where: { userId: input.userId, badgeId: input.badgeId } })
  if (input.actorId) await writeBadgeAdminAction(tx, {
    actorId: input.actorId,
    action: 'BADGE_GRANT',
    targetUserId: input.userId,
    badgeId: input.badgeId,
    detail: { badgeName: badge.name, awardedAt: awardedAt.toISOString(), expiresAt: expiresAt?.toISOString() || null, sourceType, sourceId, grantKey, grantReason },
  })
  return { created: true, recordId: record.id, userId: input.userId, badgeId: input.badgeId, badgeName: badge.name }
}

export async function grantBadge(input: GrantBadgeInput): Promise<BadgeOperationResult> {
  try {
    const result = await prisma.$transaction((tx) => grantBadgeInTransaction(tx, input))
    if (result.created && !input.deferPhase3Effects) {
      try {
        const { processBadgeGrantEffects } = await import('@/lib/badge-phase3')
        await processBadgeGrantEffects({ userId: result.userId, grants: [{ badgeId: result.badgeId, recordId: result.recordId }], skipOwnershipRecheck: input.deferOwnershipRecheck })
      } catch (error) {
        console.error('[badge.grant.phase3]', { userId: result.userId, badgeId: result.badgeId, error })
      }
    }
    return result
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      const key = namespacedGrantKey(input)
      const existing = (key
        ? await prisma.userBadge.findUnique({ where: { grantKey: key }, select: { id: true, Badge: { select: { name: true } } } })
        : null)
        || await prisma.userBadge.findUnique({ where: { activeKey: activeBadgeKey(input.userId, input.badgeId) }, select: { id: true, Badge: { select: { name: true } } } })
      if (existing) return operationResult(input, existing.Badge.name, existing.id)
    }
    throw error
  }
}

/**
 * Grant a badge inside a caller-owned transaction. Activity verification uses
 * this variant so the verification row and the hidden reward are committed or
 * rolled back together. Phase 3 presentation effects remain outside this
 * primitive and are intentionally not run while the parent transaction is
 * open.
 */
export async function grantBadgeWithTransaction(tx: Prisma.TransactionClient, input: GrantBadgeInput): Promise<BadgeOperationResult> {
  return grantBadgeInTransaction(tx, input)
}

export async function hasBadge(userId: string, badgeId: string) {
  const record = await prisma.userBadge.findFirst({ where: { userId, badgeId, ...activeUserBadgeWhere() }, select: { id: true } })
  return Boolean(record)
}

export async function revokeBadgeAcquisitionSource(input: {
  userId: string
  badgeId: string
  sourceType: string
  sourceId: string
  reason?: string | null
  /** Internal guard/context for chained BADGE_OWNERSHIP evaluation. */
  deferOwnershipRecheck?: boolean
  ownershipVisitedBadgeIds?: ReadonlySet<string>
}) {
  const result = await prisma.$transaction(async (tx) => {
    await lockUserForMutation(tx, input.userId)
    await lockBadgeForMutation(tx, input.badgeId)
    const now = new Date()
    const sourceKey = acquisitionSourceKey(input.userId, input.badgeId, input.sourceType.trim().slice(0, 32), input.sourceId.trim().slice(0, 191), null)
    const source = await tx.userBadgeSource.findUnique({ where: { sourceKey }, select: { id: true, userBadgeId: true, isActive: true } })
      || await tx.userBadgeSource.findFirst({
        // Compatibility for rows created before the normalized source key was
        // introduced. The migration uses the same key for identified legacy
        // rows, while this fallback keeps a partially migrated database safe.
        where: { userId: input.userId, badgeId: input.badgeId, sourceType: input.sourceType.trim().slice(0, 32), sourceId: input.sourceId.trim().slice(0, 191), isActive: true },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        select: { id: true, userBadgeId: true, isActive: true },
      })
    if (!source || !source.isActive) return { revoked: false, ownershipChanged: false }

    const aggregate = await tx.userBadge.findFirst({
      where: { id: source.userBadgeId, userId: input.userId, badgeId: input.badgeId, status: 'ACTIVE' },
      select: { id: true, expiresAt: true },
    })
    await tx.userBadgeSource.update({ where: { id: source.id }, data: { isActive: false, revokedAt: now, grantReason: input.reason?.trim().slice(0, 500) || null } })
    const refreshed = await refreshBadgeAggregate(tx, input.userId, input.badgeId, now)
    if (!refreshed.owned && aggregate) {
      await tx.userBadge.update({ where: { id: aggregate.id }, data: { status: aggregate.expiresAt && aggregate.expiresAt <= now ? 'EXPIRED' : 'REVOKED', ...(aggregate.expiresAt && aggregate.expiresAt <= now ? { expiredAt: now } : { revokedAt: now }), activeKey: null } })
      await clearBadgePresentationIfUnowned(tx, input.userId, input.badgeId)
    }
    // The aggregate can be stale when a source expires between scheduler
    // runs. Treat the loss of the last valid source as an ownership change
    // even when the runtime ACTIVE query no longer sees that stale row.
    return { revoked: true, ownershipChanged: Boolean(aggregate && !refreshed.owned) }
  })
  if (result.ownershipChanged && !input.deferOwnershipRecheck) {
    try {
      const { triggerBadgeOwnershipRecheck } = await import('@/lib/badge-ownership')
      await triggerBadgeOwnershipRecheck(input.userId, input.badgeId, { visitedBadgeIds: input.ownershipVisitedBadgeIds })
    } catch (error) {
      console.error('[badge.source-revoke.ownership-recheck]', { userId: input.userId, badgeId: input.badgeId, error })
    }
  }
  return result
}

export async function revokeBadge({ userId, badgeId, actorId, reason }: { userId: string; badgeId: string; actorId?: string | null; reason?: string | null }) {
  const result = await prisma.$transaction(async (tx) => {
    await lockUserForMutation(tx, userId)
    await lockBadgeForMutation(tx, badgeId)
    await expireStaleUserBadgeRows(tx, { userId, badgeId }, new Date())
    const record = await tx.userBadge.findFirst({
      where: { userId, badgeId, ...activeUserBadgeWhere() },
      orderBy: [{ awardedAt: 'desc' }, { id: 'desc' }],
      select: { id: true, Badge: { select: { name: true } } },
    })
    if (!record) throw new BadgeServiceError('NOT_FOUND', '该用户尚未拥有此勋章')

    await tx.userBadge.update({ where: { id: record.id }, data: { status: 'REVOKED', revokedAt: new Date(), activeKey: null } })
    await tx.userBadgeSource.updateMany({ where: { userId, badgeId, isActive: true }, data: { isActive: false, revokedAt: new Date() } })
    await clearBadgePresentationIfUnowned(tx, userId, badgeId)

    if (actorId) await writeBadgeAdminAction(tx, {
      actorId,
      action: 'BADGE_REVOKE',
      targetUserId: userId,
      badgeId,
      detail: { badgeName: record.Badge.name, reason: reason?.trim().slice(0, 500) || null },
    })

    return { userId, badgeId, badgeName: record.Badge.name }
  })
  try {
    const { triggerBadgeOwnershipRecheck } = await import('@/lib/badge-ownership')
    await triggerBadgeOwnershipRecheck(userId, badgeId)
  } catch (error) {
    console.error('[badge.revoke.ownership-recheck]', { userId, badgeId, error })
  }
  return result
}

function equipmentMutationResult(equippedBadges: EquippedBadgeView[], badge?: EquippedBadgeView | null) {
  const first = equippedBadges[0] || null
  return {
    equippedBadges,
    equippedBadgeIds: equippedBadges.map((item) => item.id),
    equippedBadgeId: first?.id || null,
    // Temporary compatibility for older callers; the plural array is the
    // canonical response used by new UI code.
    equippedBadge: first,
    badge: badge || null,
  }
}

export async function equipBadge(userId: string, badgeId: string) {
  await prisma.$transaction(async (tx) => {
    await lockUserForMutation(tx, userId)
    await lockBadgeForMutation(tx, badgeId)
    await expireStaleUserBadgeRows(tx, { userId, badgeId }, new Date())
    const record = await tx.userBadge.findFirst({
      where: { userId, badgeId, ...activeUserBadgeWhere() },
      orderBy: [{ awardedAt: 'desc' }, { id: 'desc' }],
      select: { id: true, obtainedAt: true, expiresAt: true, Badge: { select: EQUIPPED_BADGE_SELECT } },
    })
    if (!record) throw new BadgeServiceError('NOT_OWNED', '你还没有获得这枚勋章')
    if (!record.Badge.isEnabled || !record.Badge.isActive) throw new BadgeServiceError('BADGE_DISABLED', '这枚勋章当前已停用')
    if (!record.Badge.isWearable) throw new BadgeServiceError('BADGE_NOT_WEARABLE', '这枚勋章不允许佩戴')

    const existing = await tx.userEquippedBadge.findUnique({
      where: { userId_badgeId: { userId, badgeId } },
      select: { id: true },
    })
    if (!existing) {
      const last = await tx.userEquippedBadge.findFirst({
        where: { userId },
        orderBy: [{ position: 'desc' }, { equippedAt: 'desc' }, { id: 'desc' }],
        select: { position: true },
      })
      await tx.userEquippedBadge.create({
        data: { userId, badgeId, position: (last?.position ?? -1) + 1 },
      })
    }
  })

  const equippedBadges = await getEquippedBadgesForUser(userId)
  return equipmentMutationResult(equippedBadges, equippedBadges.find((badge) => badge.id === badgeId) || null)
}

async function normalizeEquippedPositions(tx: Prisma.TransactionClient, userId: string) {
  const rows = await tx.userEquippedBadge.findMany({
    where: { userId },
    orderBy: [{ position: 'asc' }, { equippedAt: 'asc' }, { id: 'asc' }],
    select: { id: true },
  })
  for (const [position, row] of rows.entries()) {
    await tx.userEquippedBadge.update({ where: { id: row.id }, data: { position } })
  }
}

export async function unequipBadge(userId: string, badgeId?: string | null) {
  await prisma.$transaction(async (tx) => {
    await lockUserForMutation(tx, userId)
    if (badgeId) {
      await tx.userEquippedBadge.deleteMany({ where: { userId, badgeId } })
    } else {
      await tx.userEquippedBadge.deleteMany({ where: { userId } })
      // Legacy cleanup is intentionally retained until the old field is
      // removed in a later migration.
      await tx.user.updateMany({ where: { id: userId }, data: { equippedBadgeId: null } })
    }
    await normalizeEquippedPositions(tx, userId)
  })
  return equipmentMutationResult(await getEquippedBadgesForUser(userId))
}

export async function reorderEquippedBadges(userId: string, badgeIds: readonly string[]) {
  const normalized = badgeIds.map((value) => value.trim())
  if (normalized.some((value) => !value || value.length > 191) || new Set(normalized).size !== normalized.length) {
    throw new BadgeServiceError('INVALID_EQUIPPED_ORDER', '佩戴勋章顺序无效')
  }

  await prisma.$transaction(async (tx) => {
    await lockUserForMutation(tx, userId)
    const current = await tx.userEquippedBadge.findMany({
      where: { userId },
      orderBy: [{ position: 'asc' }, { equippedAt: 'asc' }, { id: 'asc' }],
      select: { id: true, badgeId: true },
    })
    const owned = normalized.length
      ? await tx.userBadge.findMany({
          where: {
            userId,
            badgeId: { in: normalized },
            ...activeUserBadgeWhere(),
            Badge: { isEnabled: true, isActive: true, isWearable: true },
          },
          select: { badgeId: true },
        })
      : []
    const ownedIds = new Set(owned.map((row) => row.badgeId))
    const staleIds = current.filter((row) => !ownedIds.has(row.badgeId)).map((row) => row.id)
    if (staleIds.length) await tx.userEquippedBadge.deleteMany({ where: { id: { in: staleIds } } })
    const currentIds = current.filter((row) => !staleIds.includes(row.id)).map((row) => row.badgeId)
    if (currentIds.length !== normalized.length || currentIds.some((id) => !normalized.includes(id))) {
      throw new BadgeServiceError('INVALID_EQUIPPED_ORDER', '排序必须包含当前全部有效佩戴勋章')
    }
    for (const [position, badgeId] of normalized.entries()) {
      await tx.userEquippedBadge.update({
        where: { userId_badgeId: { userId, badgeId } },
        data: { position },
      })
    }
  })

  return equipmentMutationResult(await getEquippedBadgesForUser(userId))
}

export async function disableBadge(badgeId: string, enabled: boolean, actorId?: string | null) {
  return prisma.$transaction(async (tx) => {
    const badge = await tx.badge.update({ where: { id: badgeId }, data: { isEnabled: enabled, isActive: enabled }, select: { id: true, name: true } })
    if (!enabled) {
      await tx.userEquippedBadge.deleteMany({ where: { badgeId } })
      await tx.user.updateMany({ where: { equippedBadgeId: badgeId }, data: { equippedBadgeId: null } })
      await tx.userBadgeShowcase.deleteMany({ where: { badgeId } })
    }
    if (actorId) await writeBadgeAdminAction(tx, {
      actorId,
      action: enabled ? 'BADGE_ENABLE' : 'BADGE_DISABLE',
      badgeId,
      detail: { badgeName: badge.name },
    })
    return badge
  })
}

export async function deleteBadgeSafely(badgeId: string, actorId?: string | null) {
  try {
    return await prisma.$transaction(async (tx) => {
      await lockBadgeForMutation(tx, badgeId)
      const ownerCount = await tx.userBadge.count({ where: { badgeId } })
      if (ownerCount > 0) throw new BadgeServiceError('HAS_OWNERS', `该勋章已有 ${ownerCount} 位用户获得，请先停用；为保护历史记录不能直接删除`)

      const badge = await tx.badge.delete({ where: { id: badgeId }, select: { id: true, name: true } })
      if (actorId) await writeBadgeAdminAction(tx, {
        actorId,
        action: 'BADGE_DELETE',
        badgeId,
        detail: { badgeName: badge.name },
      })
      return badge
    })
  } catch (error) {
    if (error instanceof BadgeServiceError) throw error
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
      throw new BadgeServiceError('NOT_FOUND', '勋章不存在')
    }
    throw error
  }
}

export const badgeAdminSelect = {
  ...BADGE_SELECT,
  acquisitionDescriptionCustomized: true,
  category: true,
  musicTourId: true,
  isAutoGrant: true,
  seriesId: true,
  tierGroupCode: true,
  tierLevel: true,
  availableFrom: true,
  availableUntil: true,
  Series: { select: { id: true, code: true, name: true, description: true, sortOrder: true, isEnabled: true } },
  createdAt: true,
  updatedAt: true,
  BadgeRule: {
    select: {
      id: true,
      ruleType: true,
      operator: true,
      threshold: true,
      secondaryThreshold: true,
      configJson: true,
      isEnabled: true,
      retentionPolicy: true,
      createdAt: true,
      updatedAt: true,
    },
  },
  _count: { select: { UserBadge: true } },
} as const

export const badgeAdminDisplaySelect = {
  ...badgeAdminSelect,
  PharmacyPrize: {
    where: { type: 'BADGE', enabled: true, Campaign: { status: { not: 'ENDED' } } },
    select: { id: true },
    take: 1,
  },
} as const

type DbAdminBadge = Prisma.BadgeGetPayload<{ select: typeof badgeAdminDisplaySelect }>

function resolveAdminBadgeAcquisition(badge: DbAdminBadge) {
  const generatedDescription = badge.BadgeRule
    ? generateBadgeAcquisitionDescription(badge.BadgeRule.ruleType as SupportedBadgeRuleType, badge.BadgeRule.threshold, badge.BadgeRule.configJson)
    : null
  return {
    ...badge,
    resolvedAcquisitionDescription: resolveBadgeAcquisitionDescription({
      storedDescription: badge.acquisitionDescription,
      generatedDescription,
      hasAngelGiftPrize: badge.PharmacyPrize.length > 0,
    }),
  }
}

export async function findBadgeForAdmin(badgeId: string) {
  const badge = await prisma.badge.findUnique({ where: { id: badgeId }, select: badgeAdminDisplaySelect })
  return badge ? resolveAdminBadgeAcquisition(badge) : null
}

export async function listBadgesForAdmin({ query, enabled, visibility, grantType, rarity, seriesId, tierGroupCode, availability, order }: { query?: string; enabled?: boolean; visibility?: string; grantType?: string; rarity?: string; seriesId?: string; tierGroupCode?: string; availability?: string; order?: 'sortOrder' | 'ownerCount' | 'rate' | 'createdAt' } = {}) {
  const where: Prisma.BadgeWhereInput = {}
  const normalizedQuery = query?.trim()
  if (normalizedQuery) where.OR = [{ name: { contains: normalizedQuery } }, { code: { contains: normalizedQuery } }, { slug: { contains: normalizedQuery } }]
  if (typeof enabled === 'boolean') where.isEnabled = enabled
  if (visibility === 'PUBLIC' || visibility === 'HIDDEN' || visibility === 'SECRET') where.visibility = visibility
  if (grantType === 'AUTO' || grantType === 'MANUAL' || grantType === 'EVENT') where.grantType = grantType
  if (rarity === 'COMMON' || rarity === 'RARE' || rarity === 'EPIC' || rarity === 'LEGENDARY' || rarity === 'LIMITED') where.rarity = rarity
  if (seriesId) where.seriesId = seriesId
  if (tierGroupCode) where.tierGroupCode = tierGroupCode
  if (availability === 'PERMANENT') { where.availableFrom = null; where.availableUntil = null }
  if (availability === 'UPCOMING') where.availableFrom = { gt: new Date() }
  if (availability === 'ENDED') where.availableUntil = { lte: new Date() }
  if (availability === 'AVAILABLE') where.AND = [{ OR: [
    { availableFrom: null, availableUntil: null },
    { availableFrom: null, availableUntil: { gt: new Date() } },
    { availableFrom: { lte: new Date() }, availableUntil: null },
    { availableFrom: { lte: new Date() }, availableUntil: { gt: new Date() } },
  ] }]

  const orderBy = order === 'createdAt' ? [{ createdAt: 'desc' as const }] : [{ sortOrder: 'asc' as const }, { createdAt: 'asc' as const }]
  const badges = await prisma.badge.findMany({ where, orderBy, select: badgeAdminDisplaySelect })
  const resolvedBadges = badges.map(resolveAdminBadgeAcquisition)
  if (order !== 'ownerCount' && order !== 'rate') return resolvedBadges
  const stats = await getBadgeOwnershipStats(resolvedBadges.map((badge) => badge.id))
  return resolvedBadges.sort((left, right) => {
    const leftValue = order === 'rate' ? stats.get(left.id)?.rate || 0 : stats.get(left.id)?.ownerCount || 0
    const rightValue = order === 'rate' ? stats.get(right.id)?.rate || 0 : stats.get(right.id)?.ownerCount || 0
    return rightValue - leftValue || left.sortOrder - right.sortOrder || left.createdAt.getTime() - right.createdAt.getTime()
  })
}

export async function listBadgeOwners(badgeId: string) {
  return prisma.userBadge.findMany({
    where: { badgeId },
    orderBy: [{ obtainedAt: 'desc' }, { id: 'desc' }],
    select: {
      id: true,
      awardedAt: true,
      obtainedAt: true,
      expiresAt: true,
      expiredAt: true,
      revokedAt: true,
      status: true,
      grantReason: true,
      sourceType: true,
      sourceId: true,
      User: { select: { id: true, uid: true, nickname: true, Profile: { select: { displayName: true } } } },
    },
  })
}

export async function findUsersForBadgeGrant(query: string) {
  const keyword = query.trim().slice(0, 80)
  if (!keyword) return []
  const uid = Number.parseInt(keyword, 10)
  return prisma.user.findMany({
    where: {
      status: 'ACTIVE',
      isDeleted: false,
      OR: [
        ...(Number.isInteger(uid) && uid > 0 ? [{ uid }] : []),
        { nickname: { contains: keyword } },
        { username: { contains: keyword } },
        { usernameNormalized: { contains: keyword.toLowerCase() } },
      ],
    },
    orderBy: [{ uid: 'asc' }],
    take: 20,
    select: { id: true, uid: true, nickname: true, Profile: { select: { displayName: true } } },
  })
}
