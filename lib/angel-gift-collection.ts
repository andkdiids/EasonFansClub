import { Prisma } from '@prisma/client'
import { publicImageUrl } from '@/lib/images'
import { prisma } from '@/lib/prisma'
import { activeUserBadgeWhere } from '@/lib/badge-validity'

export const ANGEL_GIFT_COLLECTION_SOURCE = 'ANGEL_GIFT_COLLECTION'

type AngelGiftDb = typeof prisma | Prisma.TransactionClient

const badgeSelect = {
  id: true,
  name: true,
  code: true,
  iconUrl: true,
  rarity: true,
  visibility: true,
  sortOrder: true,
  isEnabled: true,
  isActive: true,
} as const

const angelGiftPrizeOrderBy: Prisma.PharmacyPrizeOrderByWithRelationInput[] = [
  { sortOrder: 'asc' },
  { createdAt: 'asc' },
  { id: 'asc' },
]

const campaignSelect = {
  id: true,
  title: true,
  collectionRewardBadgeId: true,
  CollectionRewardBadge: { select: badgeSelect },
  PharmacyPrize: {
    where: { type: 'BADGE' as const, enabled: true, badgeId: { not: null } },
    orderBy: angelGiftPrizeOrderBy,
    select: {
      id: true,
      badgeId: true,
      isHidden: true,
      sortOrder: true,
      Badge: { select: badgeSelect },
    },
  },
} as const

type CampaignRow = Prisma.PharmacyCampaignGetPayload<{ select: typeof campaignSelect }>

export type AngelGiftCollectionBadgeDefinition = {
  id: string
  name: string
  code: string
  imageUrl: string | null
  rarity: string
  visibility: string
  sortOrder: number
  isHidden: boolean
  isReward?: boolean
}

export type AngelGiftVisibleBadge = AngelGiftCollectionBadgeDefinition & {
  obtainedAt: string | null
  isOwned: boolean
}

export type VisibleSeriesCollection = {
  seriesId: string
  seriesTitle: string
  visibleBadges: AngelGiftVisibleBadge[]
  visibleOwnedCount: number
  visibleTotalCount: number
  hiddenRevealedCount: number
  collectionRewardRevealed: boolean
  collectionReward: AngelGiftVisibleBadge | null
}

export type AngelGiftCollectionDefinition = {
  id: string
  title: string
  requiredBadges: AngelGiftCollectionBadgeDefinition[]
  rewardBadge: AngelGiftCollectionBadgeDefinition | null
}

export type AngelGiftGrantInput = {
  userId: string
  badgeId: string
  sourceType: string
  sourceId: string
  grantKey: string
  grantReason: string
  obtainedAt: Date
  deferPhase3Effects?: boolean
}

export type AngelGiftGrantResult = {
  created: boolean
  sourceAttached?: boolean
  recordId: string
  badgeId: string
  badgeName: string
}

export type AngelGiftCollectionCheckResult = {
  checkedCampaignIds: string[]
  completedCampaignIds: string[]
  grants: Array<{ badgeId: string; recordId: string }>
}

function emptyCheckResult(): AngelGiftCollectionCheckResult {
  return { checkedCampaignIds: [], completedCampaignIds: [], grants: [] }
}

function toDefinition(
  badge: NonNullable<CampaignRow['PharmacyPrize'][number]['Badge']>,
  options: { isHidden: boolean; isReward?: boolean },
): AngelGiftCollectionBadgeDefinition {
  return {
    id: badge.id,
    name: badge.name,
    code: badge.code,
    imageUrl: publicImageUrl(badge.iconUrl),
    rarity: badge.rarity,
    visibility: badge.visibility,
    sortOrder: badge.sortOrder,
    isHidden: options.isHidden,
    ...(options.isReward ? { isReward: true } : {}),
  }
}

function toRewardDefinition(badge: NonNullable<CampaignRow['CollectionRewardBadge']>): AngelGiftCollectionBadgeDefinition {
  return {
    id: badge.id,
    name: badge.name,
    code: badge.code,
    imageUrl: publicImageUrl(badge.iconUrl),
    rarity: badge.rarity,
    visibility: badge.visibility,
    sortOrder: badge.sortOrder,
    isHidden: true,
    isReward: true,
  }
}

/** Load one Angel Gift theme as a collection definition. No user metadata is returned here. */
export async function loadAngelGiftCollectionDefinition(campaignId: string, db: AngelGiftDb = prisma): Promise<AngelGiftCollectionDefinition | null> {
  const campaign = await db.pharmacyCampaign.findUnique({ where: { id: campaignId }, select: campaignSelect })
  if (!campaign) return null

  const seen = new Set<string>()
  const requiredBadges = campaign.PharmacyPrize.flatMap((prize) => {
    if (!prize.badgeId || !prize.Badge || seen.has(prize.badgeId)) return []
    seen.add(prize.badgeId)
    return [toDefinition(prize.Badge, { isHidden: prize.isHidden })]
  })
  const rewardBadge = campaign.CollectionRewardBadge
    ? toRewardDefinition(campaign.CollectionRewardBadge)
    : null
  return { id: campaign.id, title: campaign.title, requiredBadges, rewardBadge }
}

/**
 * The single user-facing resolver for an Angel Gift collection. Hidden
 * members and the reward are joined only after durable ownership history has
 * revealed them for this user.
 */
export function resolveVisibleSeriesCollection(input: {
  seriesId: string
  seriesTitle: string
  requiredBadges: readonly AngelGiftCollectionBadgeDefinition[]
  rewardBadge?: AngelGiftCollectionBadgeDefinition | null
  historicallyOwnedIds?: ReadonlySet<string>
  activeOwnedAt?: ReadonlyMap<string, Date>
}): VisibleSeriesCollection {
  const history = input.historicallyOwnedIds || new Set<string>()
  const activeOwnedAt = input.activeOwnedAt || new Map<string, Date>()
  const visibleBadges = input.requiredBadges
    .filter((badge) => (!badge.isHidden && badge.visibility === 'PUBLIC') || history.has(badge.id))
    .map((badge) => ({
      ...badge,
      obtainedAt: activeOwnedAt.get(badge.id)?.toISOString() || null,
      isOwned: activeOwnedAt.has(badge.id),
    }))
  const rewardRevealed = Boolean(input.rewardBadge && history.has(input.rewardBadge.id))
  const collectionReward = rewardRevealed && input.rewardBadge
    ? {
        ...input.rewardBadge,
        obtainedAt: activeOwnedAt.get(input.rewardBadge.id)?.toISOString() || null,
        isOwned: activeOwnedAt.has(input.rewardBadge.id),
      }
    : null
  const allVisible = collectionReward ? [...visibleBadges, collectionReward] : visibleBadges
  return {
    seriesId: input.seriesId,
    seriesTitle: input.seriesTitle,
    visibleBadges: allVisible,
    visibleOwnedCount: allVisible.filter((badge) => badge.isOwned).length,
    visibleTotalCount: allVisible.length,
    hiddenRevealedCount: visibleBadges.filter((badge) => badge.isHidden && !badge.isReward).length,
    collectionRewardRevealed: rewardRevealed,
    collectionReward,
  }
}

export async function resolveVisibleAngelGiftCollection(input: { userId?: string | null; campaignId: string; now?: Date; db?: AngelGiftDb }): Promise<VisibleSeriesCollection | null> {
  const db = input.db || prisma
  const definition = await loadAngelGiftCollectionDefinition(input.campaignId, db)
  if (!definition) return null
  const badgeIds = [...new Set([
    ...definition.requiredBadges.map((badge) => badge.id),
    ...(definition.rewardBadge ? [definition.rewardBadge.id] : []),
  ])]
  const historicallyOwnedIds = new Set<string>()
  const activeOwnedAt = new Map<string, Date>()
  if (input.userId && badgeIds.length) {
    const [history, active] = await Promise.all([
      db.userBadge.findMany({ where: { userId: input.userId, badgeId: { in: badgeIds } }, select: { badgeId: true } }),
      db.userBadge.findMany({ where: { userId: input.userId, badgeId: { in: badgeIds }, ...activeUserBadgeWhere(input.now || new Date()) }, select: { badgeId: true, obtainedAt: true }, orderBy: [{ obtainedAt: 'asc' }, { id: 'asc' }] }),
    ])
    history.forEach((row) => historicallyOwnedIds.add(row.badgeId))
    active.forEach((row) => { if (!activeOwnedAt.has(row.badgeId)) activeOwnedAt.set(row.badgeId, row.obtainedAt) })
  }
  return resolveVisibleSeriesCollection({
    seriesId: definition.id,
    seriesTitle: definition.title,
    requiredBadges: definition.requiredBadges,
    rewardBadge: definition.rewardBadge,
    historicallyOwnedIds,
    activeOwnedAt,
  })
}

async function getAngelGiftRelationBadgeIds(badgeIds: readonly string[] | undefined, db: AngelGiftDb) {
  const scope = badgeIds === undefined ? undefined : [...new Set(badgeIds)]
  if (scope && !scope.length) return new Set<string>()
  const [hiddenMembers, rewards] = await Promise.all([
    db.pharmacyPrize.findMany({ where: { type: 'BADGE', enabled: true, isHidden: true, ...(scope ? { badgeId: { in: scope } } : {}) }, select: { badgeId: true } }),
    db.pharmacyCampaign.findMany({ where: { collectionRewardBadgeId: scope ? { in: scope } : { not: null } }, select: { collectionRewardBadgeId: true } }),
  ])
  return new Set([
    ...hiddenMembers.flatMap((row) => row.badgeId ? [row.badgeId] : []),
    ...rewards.flatMap((row) => row.collectionRewardBadgeId ? [row.collectionRewardBadgeId] : []),
  ])
}

/** Historically revealed Angel Gift relation badges, including revoked rows. */
export async function getRevealedAngelGiftBadgeIds(userId: string | null | undefined, badgeIds?: readonly string[], db: AngelGiftDb = prisma) {
  if (!userId) return new Set<string>()
  const relationIds = await getAngelGiftRelationBadgeIds(badgeIds, db)
  const scope = badgeIds === undefined ? undefined : [...new Set(badgeIds)]
  const collectionHistoryWhere = {
    userId,
    sourceType: ANGEL_GIFT_COLLECTION_SOURCE,
    ...(scope ? { badgeId: { in: scope } } : {}),
  }
  const [history, legacyCollectionHistory, sourceHistory] = await Promise.all([
    relationIds.size
      ? db.userBadge.findMany({ where: { userId, badgeId: { in: [...relationIds] } }, select: { badgeId: true } })
      : Promise.resolve([] as Array<{ badgeId: string }>),
    db.userBadge.findMany({ where: collectionHistoryWhere, select: { badgeId: true } }),
    db.userBadgeSource.findMany({ where: collectionHistoryWhere, select: { badgeId: true } }),
  ])
  return new Set([...history, ...legacyCollectionHistory, ...sourceHistory].map((row) => row.badgeId))
}

/**
 * Return Angel Gift relation badges that must be excluded from a generic
 * badge API for this user. A Badge can be used by several systems; this
 * filter never mutates the Badge row itself.
 */
export async function getUnrevealedAngelGiftBadgeIds(userId: string | null | undefined, badgeIds?: readonly string[], db: AngelGiftDb = prisma) {
  const relationIds = [...await getAngelGiftRelationBadgeIds(badgeIds, db)]
  if (!relationIds.length) return new Set<string>()
  const scope = badgeIds === undefined ? null : new Set(badgeIds)
  const scopedRelationIds = scope ? relationIds.filter((id) => scope.has(id)) : relationIds
  if (!scopedRelationIds.length) return new Set<string>()
  if (!userId) return new Set(scopedRelationIds)
  const history = await db.userBadge.findMany({ where: { userId, badgeId: { in: scopedRelationIds } }, select: { badgeId: true } })
  const revealed = new Set(history.map((row) => row.badgeId))
  return new Set(scopedRelationIds.filter((id) => !revealed.has(id)))
}

export async function isAngelGiftBadgeUnrevealed(userId: string, badgeId: string, db: AngelGiftDb = prisma) {
  return (await getUnrevealedAngelGiftBadgeIds(userId, [badgeId], db)).has(badgeId)
}

async function lockCollectionUser(tx: Prisma.TransactionClient, userId: string) {
  const rows = await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM \`User\` WHERE id = ${userId} FOR UPDATE`
  if (!rows.length) throw new Error('用户不存在')
}

/**
 * Check and grant configured rewards while the caller's user lock is held.
 * The callback is the existing Badge transaction primitive, so no second
 * ownership table or nested transaction is introduced.
 */
export async function checkAngelGiftCollectionCompletionInTransaction(input: {
  tx: Prisma.TransactionClient
  userId: string
  sourceBadgeId?: string
  campaignId?: string
  now?: Date
  grantBadge: (grant: AngelGiftGrantInput) => Promise<AngelGiftGrantResult>
  lockUser?: boolean
}): Promise<AngelGiftCollectionCheckResult> {
  const { tx, userId } = input
  const now = input.now || new Date()
  if (input.lockUser !== false) await lockCollectionUser(tx, userId)
  const campaignIds = input.campaignId
    ? [input.campaignId]
    : input.sourceBadgeId
      ? (await tx.pharmacyPrize.findMany({ where: { type: 'BADGE', enabled: true, badgeId: input.sourceBadgeId }, select: { campaignId: true }, distinct: ['campaignId'] })).map((row) => row.campaignId)
      : []
  const result = emptyCheckResult()
  for (const campaignId of campaignIds) {
    const definition = await loadAngelGiftCollectionDefinition(campaignId, tx)
    if (!definition || !definition.rewardBadge || !definition.requiredBadges.length) continue
    if (input.sourceBadgeId && !definition.requiredBadges.some((badge) => badge.id === input.sourceBadgeId)) continue
    result.checkedCampaignIds.push(campaignId)
    const requiredIds = definition.requiredBadges.map((badge) => badge.id)
    const owned = await tx.userBadge.findMany({ where: { userId, badgeId: { in: requiredIds }, ...activeUserBadgeWhere(now) }, select: { badgeId: true } })
    if (new Set(owned.map((row) => row.badgeId)).size !== requiredIds.length) continue
    const rewardOwned = await tx.userBadge.findFirst({ where: { userId, badgeId: definition.rewardBadge.id, ...activeUserBadgeWhere(now) }, select: { id: true } })
    if (rewardOwned) continue
    const reward = await tx.badge.findUnique({ where: { id: definition.rewardBadge.id }, select: { id: true, isEnabled: true, isActive: true } })
    if (!reward?.isEnabled || !reward.isActive) continue
    const grant = await input.grantBadge({
      userId,
      badgeId: reward.id,
      sourceType: ANGEL_GIFT_COLLECTION_SOURCE,
      sourceId: campaignId,
      grantKey: `angel-gift-collection:${campaignId}`,
      grantReason: `集齐「${definition.title}」系列全部普通款及隐藏款后获得`,
      obtainedAt: now,
      deferPhase3Effects: true,
    })
    if (grant.created || grant.sourceAttached) {
      result.completedCampaignIds.push(campaignId)
      result.grants.push({ badgeId: grant.badgeId, recordId: grant.recordId })
    }
  }
  return result
}

/** Post-commit entry point used by explicit backfills and retry workers. */
export async function grantAngelGiftCollectionRewards(userId: string, campaignId: string, now = new Date()) {
  return prisma.$transaction(async (tx) => {
    const { grantBadgeWithTransaction } = await import('@/lib/badge-service')
    return checkAngelGiftCollectionCompletionInTransaction({
      tx,
      userId,
      campaignId,
      now,
      grantBadge: (grant) => grantBadgeWithTransaction(tx, grant),
    })
  }, { timeout: 15000 })
}

type BackfillUser = { id: string }

async function eligibleBackfillUsers(campaignId: string, now: Date, cursor: string | undefined, batchSize: number) {
  const definition = await loadAngelGiftCollectionDefinition(campaignId)
  if (!definition || !definition.rewardBadge || !definition.requiredBadges.length) return { definition, users: [] as BackfillUser[], hasMore: false }
  const users = await prisma.user.findMany({ where: { status: 'ACTIVE', isDeleted: false, ...(cursor ? { id: { gt: cursor } } : {}) }, orderBy: { id: 'asc' }, take: batchSize + 1, select: { id: true } })
  const hasMore = users.length > batchSize
  const rows = hasMore ? users.slice(0, batchSize) : users
  const requiredIds = definition.requiredBadges.map((badge) => badge.id)
  const owned = rows.length
    ? await prisma.userBadge.findMany({ where: { userId: { in: rows.map((user) => user.id) }, badgeId: { in: requiredIds }, ...activeUserBadgeWhere(now) }, select: { userId: true, badgeId: true } })
    : []
  const ownedByUser = new Map<string, Set<string>>()
  owned.forEach((row) => { const ids = ownedByUser.get(row.userId) || new Set<string>(); ids.add(row.badgeId); ownedByUser.set(row.userId, ids) })
  const eligible = rows.filter((user) => (ownedByUser.get(user.id)?.size || 0) === requiredIds.length)
  return { definition, users: eligible, hasMore, nextCursor: rows.at(-1)?.id || null }
}

export async function getAngelGiftCollectionBackfillPreview(campaignId: string, options: { batchSize?: number; now?: Date } = {}) {
  const now = options.now || new Date()
  const batchSize = Math.min(Math.max(Math.trunc(options.batchSize || 500) || 500, 1), 1000)
  let cursor: string | undefined
  let eligibleCount = 0
  let rewardOwnedCount = 0
  while (true) {
    const page = await eligibleBackfillUsers(campaignId, now, cursor, batchSize)
    if (!page.definition) return { campaignId, requiredBadgeCount: 0, rewardBadgeId: null, eligibleCount: 0, pendingCount: 0 }
    const rewardBadge = page.definition.rewardBadge
    if (!rewardBadge) return { campaignId, requiredBadgeCount: page.definition.requiredBadges.length, rewardBadgeId: null, eligibleCount, pendingCount: 0 }
    eligibleCount += page.users.length
    if (page.users.length) rewardOwnedCount += await prisma.userBadge.count({ where: { userId: { in: page.users.map((user) => user.id) }, badgeId: rewardBadge.id, ...activeUserBadgeWhere(now) } })
    if (!page.hasMore) {
      return { campaignId, requiredBadgeCount: page.definition.requiredBadges.length, rewardBadgeId: rewardBadge.id, eligibleCount, pendingCount: Math.max(0, eligibleCount - rewardOwnedCount) }
    }
    cursor = page.nextCursor || undefined
  }
}

export async function executeAngelGiftCollectionBackfill(campaignId: string, options: { batchSize?: number; now?: Date } = {}) {
  const now = options.now || new Date()
  const batchSize = Math.min(Math.max(Math.trunc(options.batchSize || 100) || 100, 1), 500)
  let cursor: string | undefined
  let eligibleCount = 0
  let grantedCount = 0
  let failedCount = 0
  while (true) {
    const page = await eligibleBackfillUsers(campaignId, now, cursor, batchSize)
    if (!page.definition) return { campaignId, eligibleCount, grantedCount, failedCount }
    eligibleCount += page.users.length
    for (const user of page.users) {
      try {
        const result = await grantAngelGiftCollectionRewards(user.id, campaignId, now)
        grantedCount += result.grants.length
      } catch (error) {
        failedCount += 1
        console.error('[angel-gift.collection.backfill]', { userId: user.id, campaignId, error })
      }
    }
    if (!page.hasMore) return { campaignId, eligibleCount, grantedCount, failedCount }
    cursor = page.nextCursor || undefined
  }
}
