import { Prisma } from '@prisma/client'
import { toPublicMediaUrl } from '@/lib/media-url'
import { prisma } from '@/lib/prisma'
import type { BadgeCollectionView, BadgeGalleryView, BadgeShowcaseItemView, BadgeView, EquippedBadgeView } from '@/lib/badge-types'
import { calculateBadgeProgress, getBadgeAvailability, getBadgeOwnershipStats, type BadgeOwnershipStats } from '@/lib/badge-phase2'
import { getUserBadgeMetric } from '@/lib/badge-metrics'

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
// presentation fields. Keep Series, Tier, availability and rule metadata out
// of these bounded batch lookups.
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
} as const

type DbBadge = Prisma.BadgeGetPayload<{ select: typeof BADGE_SELECT }>
const BADGE_COLLECTION_SELECT = {
  ...BADGE_SELECT,
  BadgeRule: { select: { id: true, ruleType: true, operator: true, threshold: true, isEnabled: true } },
} as const
type DbCollectionBadge = Prisma.BadgeGetPayload<{ select: typeof BADGE_COLLECTION_SELECT }>
type DbUserBadge = {
  obtainedAt: Date
  grantedAt: Date
  Badge: DbCollectionBadge
}

export type GrantBadgeInput = {
  userId: string
  badgeId: string
  sourceType?: string | null
  sourceId?: string | null
  grantReason?: string | null
  actorId?: string | null
  obtainedAt?: Date
  /** Used by a batch evaluator so Phase 3 effects can be emitted once. */
  deferPhase3Effects?: boolean
}

export type BadgeOperationResult = {
  created: boolean
  alreadyOwned?: boolean
  recordId: string
  userId: string
  badgeId: string
  badgeName: string
}

export class BadgeServiceError extends Error {
  code: 'USER_NOT_FOUND' | 'BADGE_NOT_FOUND' | 'BADGE_DISABLED' | 'BADGE_NOT_WEARABLE' | 'BADGE_NOT_AVAILABLE' | 'NOT_OWNED' | 'NOT_FOUND' | 'HAS_OWNERS'

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

function publicBadge(badge: DbBadge): Omit<BadgeView, 'status' | 'obtainedAt' | 'isEquipped'> {
  return {
    id: badge.id,
    code: badge.code,
    name: badge.name,
    imageUrl: toPublicMediaUrl(badge.iconUrl),
    description: badge.description,
    acquisitionDescription: badge.acquisitionDescription,
    visibility: badge.visibility,
    rarity: badge.rarity,
    grantType: badge.grantType,
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

function obtainedBadgeView(record: DbUserBadge, isEquipped: boolean, ownershipStats?: BadgeOwnershipStats | null, isHighestTier = false): BadgeView {
  return {
    ...publicBadge(record.Badge),
    status: 'OBTAINED',
    obtainedAt: record.obtainedAt.toISOString(),
    isEquipped,
    isHighestTier,
    ownershipStats: ownershipStats || null,
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

function sortBadgeViews(items: BadgeView[], equippedBadgeId: string | null) {
  return items.sort((left, right) => {
    if (left.id === equippedBadgeId) return -1
    if (right.id === equippedBadgeId) return 1
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

function progressForRule(metric: number, rule: { operator: string; threshold: number | null }) {
  if (rule.threshold === null) return null
  return calculateBadgeProgress(metric, rule.operator as 'GTE' | 'LTE' | 'EQ', rule.threshold)
}

async function addProgressToUnownedBadges(userId: string, badges: readonly DbCollectionBadge[], items: BadgeView[]) {
  const candidates = badges.filter((badge) => badge.visibility === 'PUBLIC' && badge.grantType === 'AUTO' && badge.BadgeRule?.isEnabled && badge.BadgeRule.ruleType !== 'BADGE_SERIES_COMPLETE' && badge.BadgeRule.threshold !== null && getBadgeAvailability(badge) === 'AVAILABLE')
  if (!candidates.length) return
  const metrics = new Map<string, number>()
  for (const badge of candidates) {
    const rule = badge.BadgeRule
    if (!rule) continue
    const type = rule.ruleType as Parameters<typeof getUserBadgeMetric>[1]
    if (!metrics.has(type)) metrics.set(type, await getUserBadgeMetric(userId, type))
    const item = items.find((candidate) => candidate.id === badge.id)
    if (item) item.progress = progressForRule(metrics.get(type) || 0, rule)
  }
}

export async function getBadgeCollection(userId: string, viewerId?: string | null): Promise<BadgeCollectionView | null> {
  const target = await prisma.user.findFirst({
    where: { id: userId, status: 'ACTIVE', isDeleted: false, Profile: { isNot: null } },
    select: {
      id: true,
      uid: true,
      equippedBadgeId: true,
      EquippedBadge: { select: BADGE_SELECT },
    },
  })
  if (!target) return null

  const isSelf = viewerId === userId
  const [records, allBadges] = await Promise.all([
    prisma.userBadge.findMany({
      where: { userId, ...(isSelf ? {} : { isHidden: false }) },
      orderBy: [{ obtainedAt: 'desc' }, { grantedAt: 'desc' }, { id: 'desc' }],
      select: { obtainedAt: true, grantedAt: true, Badge: { select: BADGE_COLLECTION_SELECT } },
    }),
    isSelf
      ? prisma.badge.findMany({
          where: { OR: [{ isEnabled: true, isActive: true }, { UserBadge: { some: { userId } } }] },
          orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
          select: BADGE_COLLECTION_SELECT,
        })
      : Promise.resolve([] as DbCollectionBadge[]),
  ])

  const visibleRecords = isSelf ? records : records.filter((record) => record.Badge.visibility !== 'SECRET')
  const equippedBadgeId = target.EquippedBadge && target.EquippedBadge.isEnabled && target.EquippedBadge.isActive && target.EquippedBadge.isWearable && visibleRecords.some((record) => record.Badge.id === target.EquippedBadge?.id)
    ? target.EquippedBadge.id
    : null
  const recordByBadgeId = new Map(visibleRecords.map((record) => [record.Badge.id, record]))

  if (!isSelf) {
    const stats = await getBadgeOwnershipStats(visibleRecords.filter((record) => record.Badge.visibility === 'PUBLIC').map((record) => record.Badge.id))
    const highest = getHighestOwnedTierByGroup(visibleRecords.map((record) => record.Badge), new Set(visibleRecords.map((record) => record.Badge.id)))
    const recordByVisibleBadgeId = new Map(visibleRecords.map((record) => [record.Badge.id, record]))
    const showcase = await buildShowcaseViews(userId, false, recordByVisibleBadgeId)
    const recent = visibleRecords.slice(0, 5).map((record) => obtainedBadgeView(record, record.Badge.id === equippedBadgeId))
    return {
      target: { id: target.id, uid: target.uid },
      isSelf: false,
      equippedBadgeId,
      obtainedCount: visibleRecords.length,
      visibleTotal: visibleRecords.length,
      publicObtainedCount: visibleRecords.filter((record) => record.Badge.visibility === 'PUBLIC').length,
      publicTotal: visibleRecords.filter((record) => record.Badge.visibility === 'PUBLIC').length,
      hiddenObtainedCount: visibleRecords.filter((record) => record.Badge.visibility === 'HIDDEN').length,
      items: sortBadgeViews(visibleRecords.map((record) => obtainedBadgeView(record, record.Badge.id === equippedBadgeId, stats.get(record.Badge.id) || null, Boolean(record.Badge.tierGroupCode && record.Badge.tierLevel && highest.get(record.Badge.tierGroupCode) === record.Badge.tierLevel))), equippedBadgeId),
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
    if (record) return [obtainedBadgeView(record, badge.id === equippedBadgeId, ownershipStats.get(badge.id) || null, Boolean(badge.tierGroupCode && badge.tierLevel && highest.get(badge.tierGroupCode) === badge.tierLevel))]
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
    equippedBadgeId,
    obtainedCount: records.length,
    visibleTotal: allBadges.filter((badge) => badge.isEnabled && badge.isActive && badge.visibility !== 'SECRET').length,
    publicObtainedCount,
    publicTotal: publicBadges.length,
    hiddenObtainedCount,
    hiddenTotal: hiddenBadges.length,
    completionPercentage: publicBadges.length ? Math.floor((publicObtainedCount / publicBadges.length) * 100) : 0,
    items: sortBadgeViews(items, equippedBadgeId),
    showcase,
    recent,
    seriesCompletions,
  }
}

/**
 * Load the public exhibition hall in one bounded catalog query plus one bounded
 * ownership query. The response is already privacy-filtered; the client never
 * receives an unearned SECRET or an unearned HIDDEN badge's real metadata.
 */
export async function getBadgeExhibitionGallery(viewerId?: string | null): Promise<BadgeGalleryView> {
  const isAuthenticated = Boolean(viewerId)
  const [allBadges, ownedRecords, viewer] = await Promise.all([
    prisma.badge.findMany({
      where: viewerId
        ? { OR: [{ isEnabled: true, isActive: true }, { UserBadge: { some: { userId: viewerId } } }] }
        : { isEnabled: true, isActive: true },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
      select: BADGE_COLLECTION_SELECT,
    }),
    viewerId
      ? prisma.userBadge.findMany({
          where: { userId: viewerId },
          orderBy: [{ obtainedAt: 'desc' }, { grantedAt: 'desc' }, { id: 'desc' }],
          select: { obtainedAt: true, grantedAt: true, Badge: { select: BADGE_COLLECTION_SELECT } },
        })
      : Promise.resolve([] as DbUserBadge[]),
    viewerId
      ? prisma.user.findUnique({ where: { id: viewerId }, select: { equippedBadgeId: true } })
      : Promise.resolve(null),
  ])

  const ownedIds = new Set(ownedRecords.map((record) => record.Badge.id))
  const recordByBadgeId = new Map(ownedRecords.map((record) => [record.Badge.id, record]))
  const equippedBadgeId = viewer?.equippedBadgeId && ownedIds.has(viewer.equippedBadgeId) ? viewer.equippedBadgeId : null
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
        badge.id === equippedBadgeId,
        ownershipStats.get(badge.id) || null,
        Boolean(badge.tierGroupCode && badge.tierLevel && highest.get(badge.tierGroupCode) === badge.tierLevel),
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
    select: { id: true, uid: true, equippedBadgeId: true, EquippedBadge: { select: BADGE_SELECT } },
  })
  if (!target) return null
  const isSelf = viewerId === userId
  const [ownedCount, publicObtainedCount, hiddenObtainedCount, publicTotal, hiddenTotal, records, showcaseRows, equippedOwnership] = await Promise.all([
    prisma.userBadge.count({ where: { userId } }),
    prisma.userBadge.count({ where: { userId, ...(isSelf ? {} : { isHidden: false }), Badge: { visibility: 'PUBLIC' } } }),
    prisma.userBadge.count({ where: { userId, ...(isSelf ? {} : { isHidden: false }), Badge: { visibility: 'HIDDEN' } } }),
    prisma.badge.count({ where: { isEnabled: true, isActive: true, visibility: 'PUBLIC' } }),
    prisma.badge.count({ where: { isEnabled: true, isActive: true, visibility: 'HIDDEN' } }),
    prisma.userBadge.findMany({
      where: { userId, ...(isSelf ? {} : { isHidden: false }) },
      orderBy: [{ obtainedAt: 'desc' }, { grantedAt: 'desc' }, { id: 'desc' }],
      take: 5,
      select: { obtainedAt: true, grantedAt: true, Badge: { select: BADGE_COLLECTION_SELECT } },
    }),
    prisma.userBadgeShowcase.findMany({
      where: {
        userId,
        Badge: { isEnabled: true, isActive: true, ...(isSelf ? {} : { visibility: { not: 'SECRET' as const } }) },
      },
      orderBy: [{ slot: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
      select: { slot: true, badgeId: true, Badge: { select: BADGE_COLLECTION_SELECT } },
    }),
    target.equippedBadgeId
      ? prisma.userBadge.findUnique({
          where: { userId_badgeId: { userId, badgeId: target.equippedBadgeId } },
          select: { isHidden: true },
        })
      : Promise.resolve(null),
  ])
  const visibleRecords = records.filter((record) => isSelf || record.Badge.visibility !== 'SECRET')
  const showcaseOwnedRecords = showcaseRows.length
    ? await prisma.userBadge.findMany({
        where: { userId, badgeId: { in: showcaseRows.map((row) => row.badgeId) }, ...(isSelf ? {} : { isHidden: false }) },
        orderBy: [{ obtainedAt: 'desc' }, { id: 'desc' }],
        select: { obtainedAt: true, grantedAt: true, Badge: { select: BADGE_COLLECTION_SELECT } },
      })
    : []
  const recordByBadgeId = new Map(showcaseOwnedRecords.filter((record) => isSelf || record.Badge.visibility !== 'SECRET').map((record) => [record.Badge.id, record]))
  const showcase = showcaseRows.flatMap((row) => {
    const record = recordByBadgeId.get(row.badgeId)
    if (!record) return []
    return [{ slot: row.slot, badge: obtainedBadgeView(record, row.badgeId === target.equippedBadgeId) }]
  })
  const recent = visibleRecords.map((record) => obtainedBadgeView(record, record.Badge.id === target.equippedBadgeId))
  const equippedIsVisible = Boolean(target.EquippedBadge && equippedOwnership && (isSelf || (!equippedOwnership.isHidden && target.EquippedBadge.visibility !== 'SECRET')))
  const equippedBadgeId = target.EquippedBadge && equippedOwnership && equippedIsVisible && target.EquippedBadge.isEnabled && target.EquippedBadge.isActive && target.EquippedBadge.isWearable
    ? target.EquippedBadge.id
    : null
  return {
    target: { id: target.id, uid: target.uid },
    isSelf,
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

export async function getEquippedBadgeForUser(userId: string): Promise<EquippedBadgeView | null> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { equippedBadgeId: true, EquippedBadge: { select: EQUIPPED_BADGE_SELECT } },
  })
  if (!user?.equippedBadgeId || !user.EquippedBadge || !user.EquippedBadge.isEnabled || !user.EquippedBadge.isActive || !user.EquippedBadge.isWearable) return null

  const owned = await prisma.userBadge.findUnique({
    where: { userId_badgeId: { userId, badgeId: user.equippedBadgeId } },
    select: { obtainedAt: true },
  })
  if (!owned) return null

  return {
    id: user.EquippedBadge.id,
    code: user.EquippedBadge.code,
    name: user.EquippedBadge.name,
    imageUrl: toPublicMediaUrl(user.EquippedBadge.iconUrl),
    effectType: user.EquippedBadge.effectType,
    nicknameEffect: user.EquippedBadge.nicknameEffect,
    nicknameColor: user.EquippedBadge.nicknameColor,
    nicknameGradientStart: user.EquippedBadge.nicknameGradientStart,
    nicknameGradientEnd: user.EquippedBadge.nicknameGradientEnd,
    rarity: user.EquippedBadge.rarity,
    obtainedAt: owned.obtainedAt.toISOString(),
    description: user.EquippedBadge.description,
    acquisitionDescription: user.EquippedBadge.acquisitionDescription,
    isWearable: user.EquippedBadge.isWearable,
    isEnabled: user.EquippedBadge.isEnabled && user.EquippedBadge.isActive,
  }
}

/** Load the current badge for many authors in two bounded queries, never one query per nickname. */
export async function getEquippedBadgesForUsers(userIds: Iterable<string>) {
  const ids = [...new Set([...userIds].filter(Boolean))]
  const result = new Map<string, EquippedBadgeView>()
  if (!ids.length) return result

  const users = await prisma.user.findMany({
    where: { id: { in: ids } },
    select: { id: true, equippedBadgeId: true, EquippedBadge: { select: EQUIPPED_BADGE_SELECT } },
  })
  const equippedUsers = users.filter((user) => Boolean(user.equippedBadgeId && user.EquippedBadge && user.EquippedBadge.isEnabled && user.EquippedBadge.isActive && user.EquippedBadge.isWearable))
  if (!equippedUsers.length) return result
  const records = await prisma.userBadge.findMany({
    where: { userId: { in: equippedUsers.map((user) => user.id) }, badgeId: { in: equippedUsers.map((user) => user.equippedBadgeId!).filter(Boolean) } },
    select: { userId: true, badgeId: true, obtainedAt: true },
  })
  const recordByUserId = new Map(records.map((record) => [`${record.userId}:${record.badgeId}`, record]))
  for (const user of equippedUsers) {
    if (!user.equippedBadgeId || !user.EquippedBadge) continue
    const record = recordByUserId.get(`${user.id}:${user.equippedBadgeId}`)
    if (!record) continue
    result.set(user.id, {
      id: user.EquippedBadge.id,
      code: user.EquippedBadge.code,
      name: user.EquippedBadge.name,
      imageUrl: toPublicMediaUrl(user.EquippedBadge.iconUrl),
      effectType: user.EquippedBadge.effectType,
      nicknameEffect: user.EquippedBadge.nicknameEffect,
      nicknameColor: user.EquippedBadge.nicknameColor,
      nicknameGradientStart: user.EquippedBadge.nicknameGradientStart,
      nicknameGradientEnd: user.EquippedBadge.nicknameGradientEnd,
      rarity: user.EquippedBadge.rarity,
      obtainedAt: record.obtainedAt.toISOString(),
      description: user.EquippedBadge.description,
      acquisitionDescription: user.EquippedBadge.acquisitionDescription,
      isWearable: user.EquippedBadge.isWearable,
      isEnabled: user.EquippedBadge.isEnabled && user.EquippedBadge.isActive,
    })
  }
  return result
}

export async function grantBadge(input: GrantBadgeInput): Promise<BadgeOperationResult> {
  const obtainedAt = input.obtainedAt || new Date()
  const sourceType = input.sourceType?.trim().slice(0, 32) || null
  const sourceId = input.sourceId?.trim().slice(0, 191) || null
  const grantReason = input.grantReason?.trim().slice(0, 500) || null

  try {
    const result = await prisma.$transaction(async (tx) => {
      const [user, badge] = await Promise.all([
        tx.user.findUnique({ where: { id: input.userId }, select: { id: true } }),
        tx.badge.findUnique({ where: { id: input.badgeId }, select: { id: true, name: true, isEnabled: true, isActive: true, availableFrom: true, availableUntil: true } }),
      ])
      if (!user) throw new BadgeServiceError('USER_NOT_FOUND', '目标用户不存在')
      if (!badge) throw new BadgeServiceError('BADGE_NOT_FOUND', '勋章不存在')

      const existing = await tx.userBadge.findUnique({
        where: { userId_badgeId: { userId: input.userId, badgeId: input.badgeId } },
        select: { id: true },
      })
      if (existing) {
        return {
          created: false,
          alreadyOwned: true,
          recordId: existing.id,
          userId: input.userId,
          badgeId: input.badgeId,
          badgeName: badge.name,
        }
      }

      if (!badge.isEnabled || !badge.isActive) throw new BadgeServiceError('BADGE_DISABLED', '这枚勋章当前已停用')

      const availability = getBadgeAvailability(badge)
      if (availability !== 'PERMANENT' && availability !== 'AVAILABLE') {
        throw new BadgeServiceError('BADGE_NOT_AVAILABLE', availability === 'UPCOMING' ? '这枚限定勋章尚未开放' : '这枚限定勋章已经绝版，当前不能再授予')
      }

      const record = await tx.userBadge.create({
        data: {
          userId: input.userId,
          badgeId: input.badgeId,
          obtainedAt,
          grantedAt: obtainedAt,
          createdAt: obtainedAt,
          sourceType,
          sourceId,
          grantReason,
          grantedBy: input.actorId || null,
        },
        select: { id: true },
      })

      // A completed task becomes historical ownership immediately. Keeping
      // this in the grant transaction prevents a stale 100/100 task.
      await tx.userBadgeTracking.deleteMany({ where: { userId: input.userId, badgeId: input.badgeId } })

      if (input.actorId) await writeBadgeAdminAction(tx, {
        actorId: input.actorId,
        action: 'BADGE_GRANT',
        targetUserId: input.userId,
        badgeId: input.badgeId,
        detail: { badgeName: badge.name, obtainedAt: obtainedAt.toISOString(), sourceType, sourceId, grantReason },
      })

      return {
        created: true,
        recordId: record.id,
        userId: input.userId,
        badgeId: input.badgeId,
        badgeName: badge.name,
      }
    })
    if (result.created && !input.deferPhase3Effects) {
      try {
        const { processBadgeGrantEffects } = await import('@/lib/badge-phase3')
        await processBadgeGrantEffects({ userId: result.userId, grants: [{ badgeId: result.badgeId, recordId: result.recordId }] })
      } catch (error) {
        // Granting the historical record is the source of truth. Notifications,
        // activity and series rewards are deliberately best-effort side effects.
        console.error('[badge.grant.phase3]', { userId: result.userId, badgeId: result.badgeId, error })
      }
    }
    return result
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      const existing = await prisma.userBadge.findUnique({
        where: { userId_badgeId: { userId: input.userId, badgeId: input.badgeId } },
        select: { id: true, Badge: { select: { name: true } } },
      })
      if (existing) {
        return {
          created: false,
          alreadyOwned: true,
          recordId: existing.id,
          userId: input.userId,
          badgeId: input.badgeId,
          badgeName: existing.Badge.name,
        }
      }
    }
    throw error
  }
}

export async function hasBadge(userId: string, badgeId: string) {
  const record = await prisma.userBadge.findUnique({
    where: { userId_badgeId: { userId, badgeId } },
    select: { id: true },
  })
  return Boolean(record)
}

export async function revokeBadge({ userId, badgeId, actorId, reason }: { userId: string; badgeId: string; actorId?: string | null; reason?: string | null }) {
  return prisma.$transaction(async (tx) => {
    await lockBadgeForMutation(tx, badgeId)
    const record = await tx.userBadge.findUnique({
      where: { userId_badgeId: { userId, badgeId } },
      select: { id: true, Badge: { select: { name: true } } },
    })
    if (!record) throw new BadgeServiceError('NOT_FOUND', '该用户尚未拥有此勋章')

    await tx.userBadge.delete({ where: { id: record.id } })
    await tx.userBadgeShowcase.deleteMany({ where: { userId, badgeId } })
    await tx.user.updateMany({ where: { id: userId, equippedBadgeId: badgeId }, data: { equippedBadgeId: null } })

    if (actorId) await writeBadgeAdminAction(tx, {
      actorId,
      action: 'BADGE_REVOKE',
      targetUserId: userId,
      badgeId,
      detail: { badgeName: record.Badge.name, reason: reason?.trim().slice(0, 500) || null },
    })

    return { userId, badgeId, badgeName: record.Badge.name }
  })
}

export async function equipBadge(userId: string, badgeId: string) {
  return prisma.$transaction(async (tx) => {
    await lockBadgeForMutation(tx, badgeId)
    const record = await tx.userBadge.findUnique({
      where: { userId_badgeId: { userId, badgeId } },
      select: { id: true, obtainedAt: true, Badge: { select: EQUIPPED_BADGE_SELECT } },
    })
    if (!record) throw new BadgeServiceError('NOT_OWNED', '你还没有获得这枚勋章')
    if (!record.Badge.isEnabled || !record.Badge.isActive) throw new BadgeServiceError('BADGE_DISABLED', '这枚勋章当前已停用')
    if (!record.Badge.isWearable) throw new BadgeServiceError('BADGE_NOT_WEARABLE', '这枚勋章不允许佩戴')

    await tx.user.update({ where: { id: userId }, data: { equippedBadgeId: badgeId } })
    return {
      equippedBadgeId: badgeId,
      badge: {
        id: record.Badge.id,
        code: record.Badge.code,
        name: record.Badge.name,
        imageUrl: toPublicMediaUrl(record.Badge.iconUrl),
        effectType: record.Badge.effectType,
        nicknameEffect: record.Badge.nicknameEffect,
        nicknameColor: record.Badge.nicknameColor,
        nicknameGradientStart: record.Badge.nicknameGradientStart,
        nicknameGradientEnd: record.Badge.nicknameGradientEnd,
        rarity: record.Badge.rarity,
        obtainedAt: record.obtainedAt.toISOString(),
        description: record.Badge.description,
        acquisitionDescription: record.Badge.acquisitionDescription,
        isWearable: record.Badge.isWearable,
        isEnabled: record.Badge.isEnabled && record.Badge.isActive,
      } satisfies EquippedBadgeView,
    }
  })
}

export async function unequipBadge(userId: string) {
  await prisma.user.updateMany({ where: { id: userId }, data: { equippedBadgeId: null } })
  return { equippedBadgeId: null }
}

export async function disableBadge(badgeId: string, enabled: boolean, actorId?: string | null) {
  return prisma.$transaction(async (tx) => {
    const badge = await tx.badge.update({ where: { id: badgeId }, data: { isEnabled: enabled, isActive: enabled }, select: { id: true, name: true } })
    if (!enabled) {
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
      createdAt: true,
      updatedAt: true,
    },
  },
  _count: { select: { UserBadge: true } },
} as const

export async function findBadgeForAdmin(badgeId: string) {
  return prisma.badge.findUnique({ where: { id: badgeId }, select: badgeAdminSelect })
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
  const badges = await prisma.badge.findMany({ where, orderBy, select: badgeAdminSelect })
  if (order !== 'ownerCount' && order !== 'rate') return badges
  const stats = await getBadgeOwnershipStats(badges.map((badge) => badge.id))
  return badges.sort((left, right) => {
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
      obtainedAt: true,
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
