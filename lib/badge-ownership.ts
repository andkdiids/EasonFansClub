import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { getBadgeAvailability } from '@/lib/badge-phase2'
import { activeUserBadgeWhere } from '@/lib/badge-validity'
import { getBadgeOwnershipRuleConfig, matchBadgeOwnershipConfig, type BadgeOwnershipRuleConfig, withBadgeOwnershipNames } from '@/lib/badge-ownership-config'
import { resolveBadgeRetentionPolicy, type BadgeRetentionPolicyValue } from '@/lib/badge-rules'

export const BADGE_OWNERSHIP_RULE_TYPE = 'BADGE_OWNERSHIP' as const
export const BADGE_OWNERSHIP_SOURCE_TYPE = 'AUTO_RULE'
export const BADGE_OWNERSHIP_CYCLE_ERROR = '勋章获取规则存在循环依赖，请检查前置勋章设置。'

type BadgeOwnershipDbClient = Pick<Prisma.TransactionClient, 'badge' | 'badgeRule' | 'badgeRuleDependency' | 'userBadge'>

type StoredOwnershipRule = {
  badgeId: string
  configJson: unknown
}

function buildOwnershipGraph(rules: readonly StoredOwnershipRule[], override?: { badgeId: string; config: BadgeOwnershipRuleConfig }) {
  const graph = new Map<string, string[]>()
  for (const rule of rules) {
    const config = getBadgeOwnershipRuleConfig(rule.configJson)
    if (config) graph.set(rule.badgeId, [...config.badgeIds])
  }
  if (override) graph.set(override.badgeId, [...override.config.badgeIds])
  return graph
}

export function hasBadgeOwnershipCycle(graph: ReadonlyMap<string, readonly string[]>) {
  const visiting = new Set<string>()
  const visited = new Set<string>()
  const visit = (badgeId: string): boolean => {
    if (visiting.has(badgeId)) return true
    if (visited.has(badgeId)) return false
    visiting.add(badgeId)
    for (const dependency of graph.get(badgeId) || []) if (visit(dependency)) return true
    visiting.delete(badgeId)
    visited.add(badgeId)
    return false
  }
  for (const badgeId of new Set([...graph.keys(), ...[...graph.values()].flat()])) if (visit(badgeId)) return true
  return false
}

/** Validate IDs, self-dependency, existence and the complete dependency graph. */
export async function validateBadgeOwnershipRule(input: {
  targetBadgeId: string
  config: BadgeOwnershipRuleConfig
  db?: BadgeOwnershipDbClient
}) {
  const db = input.db || prisma
  if (input.config.badgeIds.includes(input.targetBadgeId)) return { error: '不能把当前正在编辑的勋章作为前置勋章' as const }

  const prerequisites = await db.badge.findMany({
    where: { id: { in: input.config.badgeIds } },
    select: { id: true, name: true, code: true, iconUrl: true, rarity: true },
  })
  if (prerequisites.length !== input.config.badgeIds.length) return { error: '指定的勋章不存在，请刷新后重新选择' as const }

  const rules = await db.badgeRule.findMany({
    where: { ruleType: 'BADGE_OWNERSHIP' },
    select: { badgeId: true, configJson: true },
  })
  if (hasBadgeOwnershipCycle(buildOwnershipGraph(rules, { badgeId: input.targetBadgeId, config: input.config }))) {
    return { error: BADGE_OWNERSHIP_CYCLE_ERROR as typeof BADGE_OWNERSHIP_CYCLE_ERROR }
  }

  const byId = new Map(prerequisites.map((badge) => [badge.id, badge]))
  return {
    config: withBadgeOwnershipNames(input.config, input.config.badgeIds.map((badgeId) => byId.get(badgeId)?.name)),
    prerequisites: input.config.badgeIds.map((badgeId) => byId.get(badgeId)!),
  }
}

/** Keep the reverse lookup table synchronized in the same transaction as BadgeRule. */
export async function syncBadgeOwnershipDependencies(
  tx: Prisma.TransactionClient,
  targetBadgeId: string,
  config: BadgeOwnershipRuleConfig | null,
) {
  await tx.badgeRuleDependency.deleteMany({ where: { targetBadgeId } })
  if (!config?.badgeIds.length) return
  await tx.badgeRuleDependency.createMany({
    data: config.badgeIds.map((sourceBadgeId) => ({ sourceBadgeId, targetBadgeId })),
    skipDuplicates: true,
  })
}

export async function loadCurrentOwnedBadgeIds(userId: string, badgeIds: readonly string[], now = new Date()) {
  if (!badgeIds.length) return new Set<string>()
  const rows = await prisma.userBadge.findMany({
    where: { userId, badgeId: { in: [...new Set(badgeIds)] }, ...activeUserBadgeWhere(now) },
    select: { badgeId: true },
  })
  return new Set(rows.map((row) => row.badgeId))
}

export async function loadCurrentOwnedBadgeIdsForUsers(userIds: readonly string[], badgeIds: readonly string[], now = new Date()) {
  const ownedByUser = new Map<string, Set<string>>()
  if (!userIds.length || !badgeIds.length) return ownedByUser
  const rows = await prisma.userBadge.findMany({
    where: { userId: { in: [...new Set(userIds)] }, badgeId: { in: [...new Set(badgeIds)] }, ...activeUserBadgeWhere(now) },
    select: { userId: true, badgeId: true },
  })
  for (const row of rows) {
    const owned = ownedByUser.get(row.userId) || new Set<string>()
    owned.add(row.badgeId)
    ownedByUser.set(row.userId, owned)
  }
  return ownedByUser
}

export type BadgeOwnershipRecheckSummary = {
  checked: number
  granted: number
  revoked: number
  alreadyOwned: number
  failed: number
}

function emptyRecheckSummary(): BadgeOwnershipRecheckSummary {
  return { checked: 0, granted: 0, revoked: 0, alreadyOwned: 0, failed: 0 }
}

/**
 * Recompute only rules that depend on a changed source badge. A visited set is
 * carried through chained grants/revokes as a runtime guard in addition to
 * save-time cycle validation.
 */
export async function recheckBadgeOwnershipDependents(
  userId: string,
  sourceBadgeId: string,
  options: { visitedBadgeIds?: ReadonlySet<string>; now?: Date } = {},
): Promise<BadgeOwnershipRecheckSummary> {
  const visited = new Set(options.visitedBadgeIds || [])
  if (visited.has(sourceBadgeId)) return emptyRecheckSummary()
  visited.add(sourceBadgeId)
  const now = options.now || new Date()
  const summary = emptyRecheckSummary()
  const dependencies = await prisma.badgeRuleDependency.findMany({
    where: { sourceBadgeId },
    select: { targetBadgeId: true },
  })
  const targetIds = [...new Set(dependencies.map((dependency) => dependency.targetBadgeId).filter((badgeId) => !visited.has(badgeId)))]
  if (!targetIds.length) return summary

  const rules = await prisma.badgeRule.findMany({
    where: {
      badgeId: { in: targetIds },
      ruleType: 'BADGE_OWNERSHIP',
    },
    select: {
      id: true,
      badgeId: true,
      configJson: true,
      isEnabled: true,
      retentionPolicy: true,
      Badge: { select: { isEnabled: true, isActive: true, grantType: true, availableFrom: true, availableUntil: true, name: true } },
    },
  })
  const allPrerequisiteIds = [...new Set(rules.flatMap((rule) => getBadgeOwnershipRuleConfig(rule.configJson)?.badgeIds || []))]
  const ownedIds = await loadCurrentOwnedBadgeIds(userId, allPrerequisiteIds, now)

  for (const rule of rules) {
    const config = getBadgeOwnershipRuleConfig(rule.configJson)
    if (!config) continue
    summary.checked += 1
    const eligible = rule.isEnabled
      && rule.Badge.isEnabled
      && rule.Badge.isActive
      && rule.Badge.grantType === 'AUTO'
      && ['PERMANENT', 'AVAILABLE'].includes(getBadgeAvailability(rule.Badge, now))
      && matchBadgeOwnershipConfig(ownedIds, config)
    try {
      if (eligible) {
        const { grantBadge } = await import('@/lib/badge-service')
        const { processBadgeGrantEffects } = await import('@/lib/badge-phase3')
        const result = await grantBadge({
          userId,
          badgeId: rule.badgeId,
          sourceType: BADGE_OWNERSHIP_SOURCE_TYPE,
          sourceId: rule.id,
          // A new key per re-grant cycle permits a valid ownership-derived
          // badge to be earned again after its source was revoked/expired.
          grantKey: `badge-ownership:${rule.id}:${now.getTime()}`,
          grantReason: `自动达成：${ruleDescription(config)}`,
          // Keep the ownership chain under this evaluator's visited guard.
          // The returned phase-3 grant list also includes any series reward
          // created as a consequence of this derived badge.
          deferPhase3Effects: true,
        })
        if (result.created) {
          summary.granted += 1
          const effects = await processBadgeGrantEffects({ userId, grants: [{ badgeId: result.badgeId, recordId: result.recordId }], skipOwnershipRecheck: true })
          for (const effect of effects) {
            const chained = await recheckBadgeOwnershipDependents(userId, effect.badgeId, { visitedBadgeIds: visited, now })
            mergeRecheckSummary(summary, chained)
          }
        } else summary.alreadyOwned += 1
      } else {
        // Only RETAIN_WHILE_ELIGIBLE rules recycle when the prerequisite set
        // stops matching. A dependent whose administrator chose
        // PERMANENT_AFTER_GRANT keeps its automatic source (default for every
        // rule type except BADGE_OWNERSHIP itself, whose historical behaviour
        // is exactly "revoke while no longer eligible").
        const retentionPolicy = resolveBadgeRetentionPolicy({ ruleType: 'BADGE_OWNERSHIP', retentionPolicy: rule.retentionPolicy as BadgeRetentionPolicyValue | null })
        if (retentionPolicy !== 'RETAIN_WHILE_ELIGIBLE') continue
        const { revokeBadgeAcquisitionSource } = await import('@/lib/badge-service')
        const result = await revokeBadgeAcquisitionSource({ userId, badgeId: rule.badgeId, sourceType: BADGE_OWNERSHIP_SOURCE_TYPE, sourceId: rule.id, reason: '前置勋章条件已失效', deferOwnershipRecheck: true, ownershipVisitedBadgeIds: visited })
        if (result.revoked) {
          summary.revoked += 1
          const chained = await recheckBadgeOwnershipDependents(userId, rule.badgeId, { visitedBadgeIds: visited, now })
          mergeRecheckSummary(summary, chained)
        }
      }
    } catch (error) {
      summary.failed += 1
      console.error('[badge-ownership.recheck]', { userId, sourceBadgeId, targetBadgeId: rule.badgeId, error })
    }
  }
  return summary
}

function mergeRecheckSummary(target: BadgeOwnershipRecheckSummary, source: BadgeOwnershipRecheckSummary) {
  target.checked += source.checked
  target.granted += source.granted
  target.revoked += source.revoked
  target.alreadyOwned += source.alreadyOwned
  target.failed += source.failed
}

export function triggerBadgeOwnershipRecheck(userId: string, sourceBadgeId: string, options: { visitedBadgeIds?: ReadonlySet<string>; now?: Date } = {}) {
  const task = recheckBadgeOwnershipDependents(userId, sourceBadgeId, options).catch((error) => {
    console.error('[badge-ownership.trigger]', { userId, sourceBadgeId, error })
    return emptyRecheckSummary()
  })
  void task
  return task
}

export type BadgeOwnershipBackfillResult = {
  scanned: number
  granted: number
  alreadyOwned: number
  notEligible: number
  failed: number
  failures: string[]
  nextCursor: string | null
  done: boolean
}

/** Batch current-ownership backfill. It never loads all users or all badges. */
export async function backfillBadgeOwnershipRule(input: {
  userIdsAfter?: string
  batchSize: number
  targetBadgeId: string
  ruleId: string
  config: BadgeOwnershipRuleConfig
  now?: Date
}): Promise<BadgeOwnershipBackfillResult> {
  const now = input.now || new Date()
  const users = await prisma.user.findMany({
    where: { status: 'ACTIVE', isDeleted: false, ...(input.userIdsAfter ? { id: { gt: input.userIdsAfter } } : {}) },
    orderBy: { id: 'asc' },
    take: input.batchSize + 1,
    select: { id: true },
  })
  const hasMore = users.length > input.batchSize
  const rows = hasMore ? users.slice(0, input.batchSize) : users
  const ownedByUser = await loadCurrentOwnedBadgeIdsForUsers(rows.map((user) => user.id), input.config.badgeIds, now)
  const result: BadgeOwnershipBackfillResult = {
    scanned: rows.length,
    granted: 0,
    alreadyOwned: 0,
    notEligible: 0,
    failed: 0,
    failures: [],
    nextCursor: hasMore ? rows.at(-1)?.id || null : null,
    done: !hasMore,
  }
  for (const user of rows) {
    if (!matchBadgeOwnershipConfig(ownedByUser.get(user.id) || [], input.config)) {
      result.notEligible += 1
      continue
    }
    try {
      const { grantBadge } = await import('@/lib/badge-service')
      const grant = await grantBadge({
        userId: user.id,
        badgeId: input.targetBadgeId,
        sourceType: BADGE_OWNERSHIP_SOURCE_TYPE,
        sourceId: input.ruleId,
        grantKey: `badge-ownership-backfill:${input.ruleId}:${now.getTime()}`,
        grantReason: `自动达成：${ruleDescription(input.config)}`,
      })
      if (grant.created) result.granted += 1
      else result.alreadyOwned += 1
    } catch (error) {
      result.failed += 1
      if (result.failures.length < 100) result.failures.push(`${user.id}:${error instanceof Error ? error.message : '发放失败'}`)
    }
  }
  return result
}

function ruleDescription(config: BadgeOwnershipRuleConfig) {
  const names = config.badgeNames?.length === config.badgeIds.length ? config.badgeNames.join('、') : '指定勋章'
  if (config.matchMode === 'ANY') return `获得${names}中的任意一枚后获得`
  if (config.matchMode === 'AT_LEAST') return `获得指定勋章中的任意 ${config.minimumCount} 枚后获得`
  return `集齐${names}后获得`
}

export async function getBadgeOwnershipRuleStats(input: { targetBadgeId: string; config: BadgeOwnershipRuleConfig; now?: Date; batchSize?: number }) {
  const now = input.now || new Date()
  const batchSize = input.batchSize || 500
  let cursor: string | undefined
  let eligibleCount = 0
  let eligibleOwnedCount = 0
  while (true) {
    const users = await prisma.user.findMany({
      where: { status: 'ACTIVE', isDeleted: false, ...(cursor ? { id: { gt: cursor } } : {}) },
      orderBy: { id: 'asc' },
      take: batchSize,
      select: { id: true },
    })
    if (!users.length) break
    const ownedByUser = await loadCurrentOwnedBadgeIdsForUsers(users.map((user) => user.id), input.config.badgeIds, now)
    const eligibleUserIds = users.filter((user) => matchBadgeOwnershipConfig(ownedByUser.get(user.id) || [], input.config)).map((user) => user.id)
    eligibleCount += eligibleUserIds.length
    if (eligibleUserIds.length) {
      eligibleOwnedCount += await prisma.userBadge.count({
        where: { userId: { in: eligibleUserIds }, badgeId: input.targetBadgeId, ...activeUserBadgeWhere(now) },
      })
    }
    cursor = users.at(-1)?.id
    if (users.length < batchSize) break
  }
  const ownedCount = await prisma.userBadge.count({ where: { badgeId: input.targetBadgeId, ...activeUserBadgeWhere(now), User: { status: 'ACTIVE', isDeleted: false } } })
  return { eligibleCount, ownedCount, pendingCount: Math.max(0, eligibleCount - eligibleOwnedCount) }
}
