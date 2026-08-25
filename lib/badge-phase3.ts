import { emitRealtime } from '@/lib/realtime'
import { formatUid } from '@/lib/uid'
import { getUserBadgeMetric } from '@/lib/badge-metrics'
import { prisma } from '@/lib/prisma'
import { createNotification } from '@/lib/notification-write'

export const MAX_BADGE_SHOWCASE_SLOTS = 6
export const BADGE_PHASE3_MAX_DEPTH = 5

type GrantRecord = { badgeId: string; recordId: string }
type GrantEffectState = {
  depth: number
  visitedBadgeIds: Set<string>
  visitedSeriesIds: Set<string>
  grants: GrantRecord[]
  completedSeriesIds: string[]
}

type SeriesCompletionData = {
  id: string
  name: string
  rewardBadgeId: string | null
  requiredBadgeIds: string[]
}

async function loadSeriesCompletionData(seriesId: string): Promise<SeriesCompletionData | null> {
  const series = await prisma.badgeSeries.findUnique({
    where: { id: seriesId },
    select: { id: true, name: true, completionRewardBadgeId: true },
  })
  if (!series) return null
  const badges = await prisma.badge.findMany({
    where: {
      seriesId,
      isEnabled: true,
      isActive: true,
      countsTowardSeriesCompletion: true,
      visibility: { not: 'SECRET' },
      ...(series.completionRewardBadgeId ? { id: { not: series.completionRewardBadgeId } } : {}),
    },
    orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
    select: { id: true },
  })
  return { id: series.id, name: series.name, rewardBadgeId: series.completionRewardBadgeId, requiredBadgeIds: badges.map((badge) => badge.id) }
}

export async function getSeriesCompletionEligibleUserIds(seriesId: string) {
  const data = await loadSeriesCompletionData(seriesId)
  if (!data || !data.requiredBadgeIds.length) return []
  const rows = await prisma.userBadge.groupBy({
    by: ['userId'],
    where: { badgeId: { in: data.requiredBadgeIds }, User: { status: 'ACTIVE', isDeleted: false } },
    _count: { _all: true },
  })
  return rows.filter((row) => row._count._all === data.requiredBadgeIds.length).map((row) => row.userId).sort()
}

export async function getSeriesCompletionPreview(seriesId: string, rewardBadgeId: string) {
  const eligibleIds = await getSeriesCompletionEligibleUserIds(seriesId)
  const ownedCount = await prisma.userBadge.count({ where: { badgeId: rewardBadgeId, User: { status: 'ACTIVE', isDeleted: false } } })
  const pending = eligibleIds.length
    ? await prisma.userBadge.count({ where: { badgeId: rewardBadgeId, userId: { in: eligibleIds } } })
    : 0
  return { eligibleCount: eligibleIds.length, ownedCount, pendingCount: Math.max(0, eligibleIds.length - pending) }
}

async function loadGrantBadges(userId: string, grants: readonly GrantRecord[]) {
  const ids = [...new Set(grants.map((grant) => grant.badgeId))]
  if (!ids.length) return []
  return prisma.badge.findMany({
    where: { id: { in: ids } },
    select: {
      id: true,
      name: true,
      visibility: true,
      rarity: true,
      announceOnGrant: true,
      tierGroupCode: true,
      tierLevel: true,
      Series: { select: { id: true, name: true } },
      BadgeRule: { select: { id: true, ruleType: true, threshold: true, isEnabled: true } },
    },
  }).then((badges) => badges.filter((badge) => grants.some((grant) => grant.badgeId === badge.id) && badge.id && userId))
}

function shortBadgeName(value: string) {
  const trimmed = value.trim()
  return trimmed.length > 40 ? `${trimmed.slice(0, 39)}…` : trimmed
}

/** Notification idempotency only needs a stable bounded key, not a secret hash. */
function stableNotificationHash(value: string) {
  let hash = 2166136261
  for (const character of value) {
    hash ^= character.codePointAt(0) || 0
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}

function notificationKey(userId: string, grants: readonly GrantRecord[]) {
  const value = grants.map((grant) => grant.recordId).sort().join('|')
  return `badge-grant:${userId}:${stableNotificationHash(value)}`
}

async function createBadgeGrantNotification(userId: string, grants: readonly GrantRecord[]) {
  const badges = await loadGrantBadges(userId, grants)
  if (!badges.length) return
  const names = badges.map((badge) => `「${shortBadgeName(badge.name)}」`).join('、')
  const title = badges.length === 1 ? '🎖 获得新勋章' : `🎖 获得 ${badges.length} 枚新勋章`
  const first = badges[0]
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { uid: true } })
  if (!user) return
  const tierLines: string[] = []
  const groups = [...new Set(badges.map((badge) => badge.tierGroupCode).filter((value): value is string => Boolean(value)))]
  const ownedTierRows = groups.length
    ? await prisma.userBadge.findMany({
        where: {
          userId,
          Badge: {
            tierGroupCode: { in: groups },
            tierLevel: { not: null },
            isEnabled: true,
            isActive: true,
          },
        },
        select: { Badge: { select: { tierGroupCode: true, tierLevel: true } } },
      })
    : []
  const highestOwnedTier = new Map<string, number>()
  for (const row of ownedTierRows) {
    const group = row.Badge.tierGroupCode
    const level = row.Badge.tierLevel
    if (!group || level === null) continue
    highestOwnedTier.set(group, Math.max(highestOwnedTier.get(group) || 0, level))
  }
  const metricCache = new Map<string, number>()
  for (const group of groups) {
    const current = highestOwnedTier.get(group) || Math.max(...badges.filter((badge) => badge.tierGroupCode === group).map((badge) => badge.tierLevel || 0))
    const next = await prisma.badge.findFirst({
      where: { tierGroupCode: group, tierLevel: { gt: current }, isEnabled: true, isActive: true },
      orderBy: [{ tierLevel: 'asc' }, { id: 'asc' }],
      select: { name: true, tierLevel: true, BadgeRule: { select: { ruleType: true, threshold: true, isEnabled: true } } },
    })
    if (!next) tierLines.push('已完成该成长系列最高等级')
    else if (next.BadgeRule?.isEnabled && next.BadgeRule.threshold !== null && next.BadgeRule.ruleType !== 'BADGE_SERIES_COMPLETE') {
      const metricType = next.BadgeRule.ruleType
      if (!metricCache.has(metricType)) metricCache.set(metricType, await getUserBadgeMetric(userId, metricType as never))
      const metric = metricCache.get(metricType) || 0
      tierLines.push(`下一等级：${shortBadgeName(next.name)} · 当前进度 ${metric} / ${next.BadgeRule.threshold}`)
    } else tierLines.push(`下一等级：${shortBadgeName(next.name)}`)
  }
  const content = badges.length === 1
    ? `你已获得${names}勋章。${tierLines.length ? ` ${tierLines.join('；')}` : ''}`
    : `你已获得${names}。${tierLines.length ? ` ${tierLines.join('；')}` : ''}`
  try {
    await createNotification({
      data: {
        recipientId: userId,
        type: 'BADGE',
        title,
        content: content.slice(0, 1000),
        link: `/user/${formatUid(user.uid)}/badges?badge=${encodeURIComponent(first.id)}`,
        key: notificationKey(userId, grants),
      },
    })
    emitRealtime(userId, 'notification')
  } catch (error) {
    // Concurrent retries can hit the notification key. The grant itself is
    // already durable and must not be turned into a failed business action.
    console.error('[badge.grant.notification]', { userId, error })
  }
}

async function createBadgeActivity(userId: string, grants: readonly GrantRecord[]) {
  const badges = await loadGrantBadges(userId, grants)
  const announced = badges.filter((badge) => badge.announceOnGrant && badge.visibility !== 'SECRET')
  if (!announced.length) return
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { uid: true, showBadgeActivity: true } })
  if (!user?.showBadgeActivity) return
  const names = announced.map((badge) => `「${shortBadgeName(badge.name)}」`).join('、')
  await prisma.friendActivity.create({
    data: {
      actorId: userId,
      type: 'BADGE',
      content: announced.length === 1 ? `获得了${names}勋章` : `获得了 ${announced.length} 枚稀有勋章：${names}`,
      targetUrl: `/user/${formatUid(user.uid)}/badges?badge=${encodeURIComponent(announced[0].id)}`,
    },
  })
}

async function collectSeriesRewards(userId: string, sourceGrants: readonly GrantRecord[], state: GrantEffectState) {
  if (!sourceGrants.length) return
  if (state.depth >= BADGE_PHASE3_MAX_DEPTH) {
    console.warn('[badge.series.max-depth]', { userId, depth: state.depth, grantCount: sourceGrants.length })
    return
  }
  const badges = await prisma.badge.findMany({
    where: { id: { in: [...new Set(sourceGrants.map((grant) => grant.badgeId))] } },
    select: { id: true, seriesId: true, Series: { select: { id: true, name: true, completionRewardBadgeId: true } } },
  })
  const nextRewards: GrantRecord[] = []
  const checkedSeriesIds = new Set<string>()
  for (const badge of badges) {
    if (state.visitedBadgeIds.has(badge.id)) continue
    state.visitedBadgeIds.add(badge.id)
    const series = badge.Series
    if (!series?.completionRewardBadgeId || checkedSeriesIds.has(series.id)) continue
    checkedSeriesIds.add(series.id)
    const data = await loadSeriesCompletionData(series.id)
    if (!data || !data.requiredBadgeIds.length) continue
    const owned = await prisma.userBadge.count({ where: { userId, badgeId: { in: data.requiredBadgeIds } } })
    if (owned !== data.requiredBadgeIds.length) continue
    if (state.visitedSeriesIds.has(series.id)) continue
    state.visitedSeriesIds.add(series.id)
    const reward = await prisma.userBadge.findUnique({ where: { userId_badgeId: { userId, badgeId: series.completionRewardBadgeId } }, select: { id: true } })
    if (reward) continue
    try {
      const { grantBadge } = await import('@/lib/badge-service')
      const rewardRule = await prisma.badgeRule.findUnique({ where: { badgeId: series.completionRewardBadgeId }, select: { id: true } })
      const result = await grantBadge({
        userId,
        badgeId: series.completionRewardBadgeId,
        sourceType: 'AUTO_RULE',
        sourceId: rewardRule?.id || series.id,
        grantReason: `集齐「${series.name}」系列后获得`,
        deferPhase3Effects: true,
      })
      if (result.created) {
        nextRewards.push({ badgeId: result.badgeId, recordId: result.recordId })
        state.completedSeriesIds.push(series.id)
      }
    } catch (error) {
      console.error('[badge.series.reward]', { userId, seriesId: series.id, error })
    }
  }
  if (!nextRewards.length) return
  state.grants.push(...nextRewards)
  state.depth += 1
  await collectSeriesRewards(userId, nextRewards, state)
}

export async function processBadgeGrantEffects(input: { userId: string; grants: readonly GrantRecord[] }) {
  const grants = [...new Map(input.grants.map((grant) => [grant.recordId, grant])).values()]
  if (!grants.length) return
  const state: GrantEffectState = { depth: 0, visitedBadgeIds: new Set(), visitedSeriesIds: new Set(), grants: [...grants], completedSeriesIds: [] }
  await collectSeriesRewards(input.userId, grants, state)
  await createBadgeGrantNotification(input.userId, state.grants)
  await createBadgeActivity(input.userId, state.grants)
  if (state.completedSeriesIds.length) {
    const user = await prisma.user.findUnique({ where: { id: input.userId }, select: { uid: true } })
    if (user) {
      for (const seriesId of [...new Set(state.completedSeriesIds)]) {
        try {
          await createNotification({
            data: {
              recipientId: input.userId,
              type: 'BADGE',
              title: '🎉 系列完成',
              content: '你已完成一个勋章系列收藏。',
              link: `/user/${formatUid(user.uid)}/badges`,
              key: `badge-series-completed:${input.userId}:${seriesId}`,
            },
          })
          emitRealtime(input.userId, 'notification')
        } catch (error) {
          if (!(error instanceof Error && /P2002|Unique constraint/i.test(error.message))) console.error('[badge.series.notification]', { input, error })
        }
      }
    }
  }
}
