import { Prisma } from '@prisma/client'
import { calculateBadgeRuleProgress, badgeAvailabilityWhere, canExposeLiveBadgeProgress, getBadgeAvailability, getBadgeOwnershipStats } from '@/lib/badge-phase2'
import { getUserBadgeMetric } from '@/lib/badge-metrics'
import { BADGE_RULE_REGISTRY, type SupportedBadgeRuleType } from '@/lib/badge-rules'
import { toPublicMediaUrl } from '@/lib/media-url'
import { prisma } from '@/lib/prisma'
import { emitRealtime } from '@/lib/realtime'
import { formatUid } from '@/lib/uid'
import { evaluateBadgeMetric, getBatchBadgeMetrics } from '@/lib/badge-rule-engine'
import { safeNotificationWrite } from '@/lib/notification-transaction'

export const MAX_BADGE_TRACKING = 10
export const BADGE_RECOMMENDATION_LIMIT = 3
export const BADGE_RECOMMENDATION_CANDIDATES = 50
export const BADGE_MILESTONES = [25, 50, 75, 90] as const

const TRACKABLE_RULE_TYPES = Object.keys(BADGE_RULE_REGISTRY).filter((key) => {
  const entry = BADGE_RULE_REGISTRY[key as SupportedBadgeRuleType]
  return entry.threshold !== null
}) as SupportedBadgeRuleType[]

const taskBadgeSelect = {
  id: true, name: true, description: true, acquisitionDescription: true, iconUrl: true,
  visibility: true, grantType: true, isEnabled: true, isActive: true,
  rarity: true, effectType: true, sortOrder: true, availableFrom: true, availableUntil: true,
  Series: { select: { id: true, name: true } },
  BadgeRule: { select: { id: true, ruleType: true, operator: true, threshold: true, isEnabled: true } },
} as const

type TaskBadge = Prisma.BadgeGetPayload<{ select: typeof taskBadgeSelect }>

function remainingLabel(ruleType: SupportedBadgeRuleType, current: number, target: number) {
  const entry = BADGE_RULE_REGISTRY[ruleType]
  const unit = 'unit' in entry ? entry.unit : ''
  return `还差 ${Math.max(0, target - current)}${unit}`
}

function dailyTieBreaker(userId: string, badgeId: string, now: Date) {
  const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now)
  let hash = 2166136261
  for (const char of `${userId}:${day}:${badgeId}`) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619)
  return hash >>> 0
}

async function loadMetrics(userId: string, badges: readonly TaskBadge[]) {
  const types = [...new Set(badges.map((badge) => badge.BadgeRule?.ruleType).filter(Boolean))] as SupportedBadgeRuleType[]
  const entries = await Promise.all(types.map(async (type) => [type, await getUserBadgeMetric(userId, type)] as const))
  return new Map(entries)
}

function toTaskItem(badge: TaskBadge, metrics: Map<SupportedBadgeRuleType, number>, tracking?: { createdAt: Date; lastMilestone: number }) {
  const rule = badge.BadgeRule!
  const type = rule.ruleType as SupportedBadgeRuleType
  const progress = calculateBadgeRuleProgress(metrics.get(type) || 0, rule)
  if (!progress) return null
  return {
    id: badge.id,
    name: badge.name,
    description: badge.description,
    acquisitionDescription: badge.acquisitionDescription,
    imageUrl: toPublicMediaUrl(badge.iconUrl),
    rarity: badge.rarity,
    effectType: badge.effectType,
    series: badge.Series,
    availabilityStatus: getBadgeAvailability(badge),
    ruleType: type,
    ruleLabel: BADGE_RULE_REGISTRY[type].label,
    unit: 'unit' in BADGE_RULE_REGISTRY[type] ? BADGE_RULE_REGISTRY[type].unit : '',
    progress,
    remainingLabel: remainingLabel(type, progress.current, progress.target),
    trackedAt: tracking?.createdAt.toISOString() || null,
    lastMilestone: tracking?.lastMilestone || 0,
  }
}

export async function getBadgeTaskCenter(userId: string, now = new Date()) {
  const [trackingRows, candidates] = await Promise.all([
    prisma.userBadgeTracking.findMany({
      where: { userId },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      select: { createdAt: true, lastMilestone: true, Badge: { select: taskBadgeSelect } },
    }),
    prisma.badge.findMany({
      where: {
        visibility: 'PUBLIC', grantType: 'AUTO', isEnabled: true, isActive: true,
        ...badgeAvailabilityWhere(now),
        BadgeRule: { is: { isEnabled: true, operator: 'GTE', threshold: { not: null }, ruleType: { in: TRACKABLE_RULE_TYPES } } },
        UserBadge: { none: { userId } },
        UserBadgeTracking: { none: { userId } },
      },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
      take: BADGE_RECOMMENDATION_CANDIDATES,
      select: taskBadgeSelect,
    }),
  ])
  const validTracked = trackingRows.filter((row) => {
    const badge = row.Badge
    return TRACKABLE_RULE_TYPES.includes(badge.BadgeRule?.ruleType as SupportedBadgeRuleType)
      && canExposeLiveBadgeProgress(badge, now)
  })
  const validIds = new Set(validTracked.map((row) => row.Badge.id))
  const staleIds = trackingRows.filter((row) => !validIds.has(row.Badge.id)).map((row) => row.Badge.id)
  if (staleIds.length) {
    await prisma.userBadgeTracking.deleteMany({ where: { userId, badgeId: { in: staleIds } } })
  }
  const allBadges = [...validTracked.map((row) => row.Badge), ...candidates]
  const metrics = await loadMetrics(userId, allBadges)
  const tracking = validTracked.map((row) => toTaskItem(row.Badge, metrics, row)).filter((item): item is NonNullable<typeof item> => Boolean(item))
  const recommendations = candidates
    .map((badge) => toTaskItem(badge, metrics))
    .filter((item): item is NonNullable<typeof item> => Boolean(item))
    .filter((item) => item.progress.current < item.progress.target)
    .sort((left, right) => right.progress.percentage - left.progress.percentage
      || dailyTieBreaker(userId, left.id, now) - dailyTieBreaker(userId, right.id, now)
      || left.id.localeCompare(right.id))
    .slice(0, BADGE_RECOMMENDATION_LIMIT)
  return { tracking, recommendations, maxTracking: MAX_BADGE_TRACKING, generatedAt: now.toISOString() }
}

export async function trackBadge(userId: string, badgeId: string) {
  const badge = await prisma.badge.findUnique({
    where: { id: badgeId },
    select: {
      id: true, visibility: true, grantType: true, isEnabled: true, isActive: true,
      availableFrom: true, availableUntil: true,
      BadgeRule: { select: { ruleType: true, operator: true, threshold: true, isEnabled: true } },
      UserBadge: { where: { userId }, select: { id: true }, take: 1 },
    },
  })
  if (!badge) throw new Error('勋章不存在')
  const availability = getBadgeAvailability(badge)
  const ruleType = badge.BadgeRule?.ruleType as SupportedBadgeRuleType | undefined
  if (badge.UserBadge.length) throw new Error('已经获得的勋章不需要追踪')
  if (badge.visibility !== 'PUBLIC' || badge.grantType !== 'AUTO' || !badge.isEnabled || !badge.isActive
    || !badge.BadgeRule?.isEnabled || badge.BadgeRule.operator !== 'GTE' || badge.BadgeRule.threshold === null
    || !ruleType || !TRACKABLE_RULE_TYPES.includes(ruleType) || !['PERMANENT', 'AVAILABLE'].includes(availability)) {
    throw new Error('这枚勋章当前不能加入任务')
  }
  try {
    return await prisma.$transaction(async (tx) => {
      const existing = await tx.userBadgeTracking.findUnique({ where: { userId_badgeId: { userId, badgeId } } })
      if (existing) return existing
      const count = await tx.userBadgeTracking.count({ where: { userId } })
      if (count >= MAX_BADGE_TRACKING) throw new Error(`最多同时追踪 ${MAX_BADGE_TRACKING} 枚勋章，请先取消一个目标。`)
      return tx.userBadgeTracking.create({ data: { userId, badgeId } })
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      return prisma.userBadgeTracking.findUniqueOrThrow({ where: { userId_badgeId: { userId, badgeId } } })
    }
    throw error
  }
}

export function untrackBadge(userId: string, badgeId: string) {
  return prisma.userBadgeTracking.deleteMany({ where: { userId, badgeId } })
}

export function highestBadgeMilestone(percentage: number) {
  return [...BADGE_MILESTONES].reverse().find((value) => percentage >= value) || 0
}

export async function processTrackedBadgeMilestones(userId: string, ruleTypes?: readonly SupportedBadgeRuleType[]) {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { uid: true, showBadgeProgressNotifications: true } })
  if (!user) return { checked: 0, notified: 0 }
  const rows = await prisma.userBadgeTracking.findMany({
    where: {
      userId,
      Badge: {
        visibility: 'PUBLIC', grantType: 'AUTO', isEnabled: true, isActive: true,
        ...badgeAvailabilityWhere(new Date()),
        BadgeRule: { is: { isEnabled: true, operator: 'GTE', threshold: { not: null }, ...(ruleTypes ? { ruleType: { in: [...ruleTypes] } } : {}) } },
      },
    },
    select: { id: true, lastMilestone: true, Badge: { select: { id: true, name: true, BadgeRule: { select: { ruleType: true, operator: true, threshold: true } } } } },
  })
  const types = [...new Set(rows.map((row) => row.Badge.BadgeRule!.ruleType as SupportedBadgeRuleType))]
  const metrics = new Map(await Promise.all(types.map(async (type) => [type, await getUserBadgeMetric(userId, type)] as const)))
  let notified = 0
  for (const row of rows) {
    const rule = row.Badge.BadgeRule!
    const type = rule.ruleType as SupportedBadgeRuleType
    const progress = calculateBadgeRuleProgress(metrics.get(type) || 0, rule)
    if (!progress) continue
    if (progress.percentage >= 100) continue
    const milestone = highestBadgeMilestone(progress.percentage)
    if (!milestone || milestone <= row.lastMilestone) continue
    const trackingAdvanced = await prisma.$transaction(async (tx) => {
      const update = await tx.userBadgeTracking.updateMany({ where: { id: row.id, lastMilestone: { lt: milestone } }, data: { lastMilestone: milestone } })
      return update.count > 0
    }, { timeout: 15_000, maxWait: 5_000 })
    if (trackingAdvanced && user.showBadgeProgressNotifications) {
      await safeNotificationWrite(
        () => prisma.notification.upsert({
          where: { recipientId_key: { recipientId: userId, key: `badge-progress:${userId}:${row.Badge.id}:${milestone}` } },
          create: {
            recipientId: userId, type: 'BADGE', title: '🎖 勋章进度提醒',
            content: `「${row.Badge.name}」已经完成 ${milestone}%，${remainingLabel(type, progress.current, progress.target)}即可获得。`,
            link: `/user/${formatUid(user.uid)}/badges?badge=${encodeURIComponent(row.Badge.id)}`,
            key: `badge-progress:${userId}:${row.Badge.id}:${milestone}`,
          },
          update: {},
        }),
        { operation: 'badge-progress', userId, notificationType: 'BADGE' },
      )
      notified += 1
      emitRealtime(userId, 'notification')
    }
  }
  return { checked: rows.length, notified }
}

function yearBounds(year: number) {
  return {
    start: new Date(`${year}-01-01T00:00:00+08:00`),
    end: new Date(`${year + 1}-01-01T00:00:00+08:00`),
  }
}

export async function getBadgeYearReview(userId: string, year: number) {
  const currentYear = Number(new Intl.DateTimeFormat('en', { timeZone: 'Asia/Shanghai', year: 'numeric' }).format(new Date()))
  if (!Number.isInteger(year) || year < 2000 || year > currentYear) return null
  const { start, end } = yearBounds(year)
  const records = await prisma.userBadge.findMany({
    where: { userId, obtainedAt: { gte: start, lt: end } },
    orderBy: [{ obtainedAt: 'asc' }, { id: 'asc' }],
    select: { id: true, obtainedAt: true, Badge: { select: { id: true, name: true, iconUrl: true, rarity: true, effectType: true, availableFrom: true, availableUntil: true } } },
  })
  const stats = await getBadgeOwnershipStats(records.map((record) => record.Badge.id))
  const [requiredBadges, ownedRequired] = await Promise.all([
    prisma.badge.findMany({
      where: { seriesId: { not: null }, countsTowardSeriesCompletion: true, isEnabled: true, isActive: true, visibility: { not: 'SECRET' } },
      select: { id: true, seriesId: true },
    }),
    prisma.userBadge.findMany({ where: { userId, Badge: { seriesId: { not: null }, countsTowardSeriesCompletion: true, isEnabled: true, isActive: true, visibility: { not: 'SECRET' } } }, select: { badgeId: true } }),
  ])
  const ownedRequiredIds = new Set(ownedRequired.map((item) => item.badgeId))
  const requiredBySeries = new Map<string, string[]>()
  for (const badge of requiredBadges) {
    if (!badge.seriesId) continue
    const ids = requiredBySeries.get(badge.seriesId) || []
    ids.push(badge.id); requiredBySeries.set(badge.seriesId, ids)
  }
  const currentCompletedSeries = [...requiredBySeries.values()].filter((ids) => ids.length > 0 && ids.every((id) => ownedRequiredIds.has(id))).length
  const rarest = [...records].sort((left, right) => (stats.get(left.Badge.id)?.rate || 0) - (stats.get(right.Badge.id)?.rate || 0)
    || right.obtainedAt.getTime() - left.obtainedAt.getTime())[0]
  const months = Array.from({ length: 12 }, (_, index) => ({ month: index + 1, count: 0 }))
  for (const record of records) {
    const month = Number(new Intl.DateTimeFormat('en', { timeZone: 'Asia/Shanghai', month: 'numeric' }).format(record.obtainedAt))
    months[month - 1].count += 1
  }
  const availableYears = await prisma.$queryRaw<Array<{ year: number }>>(Prisma.sql`
    SELECT DISTINCT YEAR(CONVERT_TZ(obtainedAt, '+00:00', '+08:00')) AS year
    FROM UserBadge WHERE userId = ${userId} ORDER BY year DESC
  `)
  return {
    year, total: records.length, months,
    first: records[0] ? { name: records[0].Badge.name, obtainedAt: records[0].obtainedAt.toISOString() } : null,
    latest: records.at(-1) ? { name: records.at(-1)!.Badge.name, obtainedAt: records.at(-1)!.obtainedAt.toISOString() } : null,
    rarest: rarest ? { id: rarest.Badge.id, name: rarest.Badge.name, imageUrl: toPublicMediaUrl(rarest.Badge.iconUrl), effectType: rarest.Badge.effectType, ownershipRate: stats.get(rarest.Badge.id)?.display || '0%' } : null,
    limitedCount: records.filter((record) => record.Badge.availableFrom || record.Badge.availableUntil || record.Badge.rarity === 'LIMITED').length,
    currentCompletedSeries,
    mostActiveMonth: [...months].sort((a, b) => b.count - a.count || a.month - b.month)[0] || null,
    availableYears: availableYears.map((item) => Number(item.year)).filter(Number.isFinite),
  }
}

export type BadgeAnalyticsRange = '30d' | 'all'

export async function getBadgeAnalytics(range: BadgeAnalyticsRange, page = 1, pageSize = 20) {
  const now = new Date()
  const since = range === '30d' ? new Date(now.getTime() - 30 * 86400000) : null
  const where = since ? { obtainedAt: { gte: since } } : {}
  const [totalBadges, autoBadges, limitedBadges, endedBadges, totalGrants, rangeGrants, activeUsers, trackingRows, badgeRows, trend] = await Promise.all([
    prisma.badge.count(), prisma.badge.count({ where: { grantType: 'AUTO' } }),
    prisma.badge.count({ where: { OR: [{ availableFrom: { not: null } }, { availableUntil: { not: null } }, { rarity: 'LIMITED' }] } }),
    prisma.badge.count({ where: { availableUntil: { lt: now } } }), prisma.userBadge.count(), prisma.userBadge.count({ where }),
    prisma.user.count({ where: { status: 'ACTIVE', isDeleted: false } }),
    prisma.userBadgeTracking.groupBy({ by: ['badgeId'], _count: { _all: true }, orderBy: { _count: { badgeId: 'desc' } }, take: 10 }),
    prisma.badge.findMany({
      orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }], skip: (page - 1) * pageSize, take: pageSize,
      select: { id: true, name: true, grantType: true, rarity: true, availableFrom: true, availableUntil: true, BadgeRule: { select: { ruleType: true, operator: true, threshold: true, configJson: true, isEnabled: true } }, _count: { select: { UserBadge: true, UserBadgeTracking: true } } },
    }),
    since ? prisma.$queryRaw<Array<{ day: Date; count: bigint }>>(Prisma.sql`
      SELECT DATE(CONVERT_TZ(obtainedAt, '+00:00', '+08:00')) AS day, COUNT(*) AS count
      FROM UserBadge WHERE obtainedAt >= ${since} GROUP BY day ORDER BY day ASC
    `) : Promise.resolve([]),
  ])
  const stats = await getBadgeOwnershipStats(badgeRows.map((badge) => badge.id))
  const previewCounts = new Map<string, { eligibleCount: number; pendingCount: number }>()
  const previewBadges = badgeRows.filter((badge) => badge.grantType === 'AUTO' && badge.BadgeRule?.isEnabled
    && badge.BadgeRule.threshold !== null && badge.BadgeRule.ruleType !== 'BADGE_SERIES_COMPLETE'
    && ['PERMANENT', 'AVAILABLE'].includes(getBadgeAvailability(badge)))
  previewBadges.forEach((badge) => previewCounts.set(badge.id, { eligibleCount: 0, pendingCount: 0 }))
  let cursor: string | undefined
  while (previewBadges.length) {
    const users = await prisma.user.findMany({
      where: { status: 'ACTIVE', isDeleted: false, ...(cursor ? { id: { gt: cursor } } : {}) },
      orderBy: { id: 'asc' }, take: 500, select: { id: true, createdAt: true },
    })
    if (!users.length) break
    const ownedRows = await prisma.userBadge.findMany({
      where: { userId: { in: users.map((user) => user.id) }, badgeId: { in: previewBadges.map((badge) => badge.id) } },
      select: { userId: true, badgeId: true },
    })
    const owned = new Set(ownedRows.map((row) => `${row.userId}:${row.badgeId}`))
    const metricCache = new Map<string, Map<string, number>>()
    for (const badge of previewBadges) {
      const rule = badge.BadgeRule!
      const signature = `${rule.ruleType}:${JSON.stringify(rule.configJson || null)}`
      let metrics = metricCache.get(signature)
      if (!metrics) {
        metrics = await getBatchBadgeMetrics(users, rule.ruleType as SupportedBadgeRuleType, rule.configJson)
        metricCache.set(signature, metrics)
      }
      const counts = previewCounts.get(badge.id)!
      for (const user of users) {
        if (!evaluateBadgeMetric(metrics.get(user.id) || 0, rule.operator, rule.threshold!)) continue
        counts.eligibleCount += 1
        if (!owned.has(`${user.id}:${badge.id}`)) counts.pendingCount += 1
      }
    }
    cursor = users.at(-1)?.id
    if (users.length < 500) break
  }
  const trackingNames = trackingRows.length ? await prisma.badge.findMany({ where: { id: { in: trackingRows.map((row) => row.badgeId) } }, select: { id: true, name: true } }) : []
  const [seriesRows, completedSeriesRows] = await Promise.all([
    prisma.badgeSeries.findMany({
      where: { isEnabled: true }, orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
      select: {
        id: true, name: true,
        CompletionRewardBadge: { select: { id: true, name: true } },
        _count: { select: { Badges: { where: { countsTowardSeriesCompletion: true, isEnabled: true, isActive: true, visibility: { not: 'SECRET' } } } } },
      },
    }),
    prisma.$queryRaw<Array<{ seriesId: string; completedUsers: bigint }>>(Prisma.sql`
      SELECT completed.seriesId, COUNT(*) AS completedUsers
      FROM (
        SELECT b.seriesId, ub.userId
        FROM Badge b
        INNER JOIN UserBadge ub ON ub.badgeId = b.id
        INNER JOIN User u ON u.id = ub.userId AND u.status = 'ACTIVE' AND u.isDeleted = false
        WHERE b.seriesId IS NOT NULL AND b.countsTowardSeriesCompletion = true
          AND b.isEnabled = true AND b.isActive = true AND b.visibility <> 'SECRET'
        GROUP BY b.seriesId, ub.userId
        HAVING COUNT(DISTINCT b.id) = (
          SELECT COUNT(*) FROM Badge required
          WHERE required.seriesId = b.seriesId AND required.countsTowardSeriesCompletion = true
            AND required.isEnabled = true AND required.isActive = true AND required.visibility <> 'SECRET'
        )
      ) completed GROUP BY completed.seriesId
    `),
  ])
  const completedBySeries = new Map(completedSeriesRows.map((row) => [row.seriesId, Number(row.completedUsers)]))
  const nameById = new Map(trackingNames.map((badge) => [badge.id, badge.name]))
  return {
    range, page, pageSize, totalBadges,
    summary: { totalBadges, autoBadges, limitedBadges, endedBadges, totalGrants, rangeGrants, averageOwned: activeUsers ? totalGrants / activeUsers : 0 },
    badges: badgeRows.map((badge) => {
      const ownership = stats.get(badge.id)!
      const difficulty = ownership.rate < 0.1 ? '极难' : ownership.rate < 1 ? '很难' : ownership.rate < 10 ? '较难' : ownership.rate <= 50 ? '中等' : '普及'
      return { ...badge, availabilityStatus: getBadgeAvailability(badge), ownerCount: ownership.ownerCount, ownershipRate: ownership.display, difficulty, ...(previewCounts.get(badge.id) || { eligibleCount: null, pendingCount: null }) }
    }),
    trackingPopular: trackingRows.map((row) => ({ badgeId: row.badgeId, name: nameById.get(row.badgeId) || '已删除勋章', count: row._count._all })),
    series: seriesRows.map((series) => {
      const completedUsers = completedBySeries.get(series.id) || 0
      return { id: series.id, name: series.name, badgeCount: series._count.Badges, completedUsers, completionRate: activeUsers ? completedUsers / activeUsers * 100 : 0, reward: series.CompletionRewardBadge }
    }),
    trend: trend.map((row) => ({ day: new Date(row.day).toISOString().slice(0, 10), count: Number(row.count) })),
  }
}
