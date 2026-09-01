import { calculateCheckinStreaks } from '@/lib/checkin'
import { GUESS_SONG_RISK_THRESHOLD } from '@/lib/guess-song-constants'
import { prisma } from '@/lib/prisma'
import { grantBadge } from '@/lib/badge-service'
import { badgeAvailabilityWhere, getBadgeAvailability } from '@/lib/badge-phase2'
import { ACTIVE_RELATION_USER_WHERE, accountAgeDays, getUserBadgeMetric, safeMetric, VALID_POST_WHERE } from '@/lib/badge-metrics'
import { getSeriesCompletionEligibleUserIds, getSeriesCompletionPreview, processBadgeGrantEffects } from '@/lib/badge-phase3'
import { getBatchHistoricalBadgeMetrics, getHistoricalBackfillCapability, getHistoricalQualificationWindow, type HistoricalQualificationWindow } from '@/lib/badge-historical'
import { getActivityParticipationBadgeStats, grantEligibleActivityBadges } from '@/lib/activity-badge-rewards'
import {
  BADGE_EVALUATION_EVENTS,
  BADGE_RULE_REGISTRY,
  BADGE_RULE_TYPES_WITH_SPECIAL,
  generateBadgeAcquisitionDescription,
  type ParsedBadgeRule,
  type SupportedBadgeRuleType,
  type BadgeRuleOperatorValue,
} from '@/lib/badge-rules'

export type BadgeEvaluationEvent = typeof BADGE_EVALUATION_EVENTS[number]

function supportsEvent(ruleType: SupportedBadgeRuleType, eventType: BadgeEvaluationEvent) {
  return (BADGE_RULE_REGISTRY[ruleType].events as readonly string[]).includes(eventType)
}

const EVENT_RULE_TYPES = Object.fromEntries(
  BADGE_EVALUATION_EVENTS.map((eventType) => [
    eventType,
    BADGE_RULE_TYPES_WITH_SPECIAL.filter((ruleType) => supportsEvent(ruleType, eventType)),
  ]),
) as unknown as Record<BadgeEvaluationEvent, readonly SupportedBadgeRuleType[]>

export type BadgeEvaluationSummary = {
  userId: string
  evaluated: number
  eligible: number
  granted: number
  alreadyOwned: number
  failed: number
  failures: string[]
}

export type BadgeBackfillSummary = {
  badgeId: string
  ruleId: string
  ruleType: SupportedBadgeRuleType
  scanned: number
  granted: number
  alreadyOwned: number
  notEligible: number
  failed: number
  failures: string[]
  nextCursor: string | null
  done: boolean
  mode: 'CURRENT' | 'HISTORICAL_WINDOW'
  historicalWindow: { from: string; until: string } | null
}

function emptySummary(userId: string): BadgeEvaluationSummary {
  return { userId, evaluated: 0, eligible: 0, granted: 0, alreadyOwned: 0, failed: 0, failures: [] }
}

export function evaluateBadgeMetric(value: number, operator: BadgeRuleOperatorValue, threshold: number) {
  if (operator === 'LTE') return value <= threshold
  if (operator === 'EQ') return value === threshold
  return value >= threshold
}

export { getBadgeMetricLoader, getUserBadgeMetric } from '@/lib/badge-metrics'

function ruleDescription(rule: Pick<ParsedBadgeRule, 'ruleType' | 'threshold'>) {
  return generateBadgeAcquisitionDescription(rule.ruleType, rule.threshold)
}

async function loadEnabledRules(ruleTypes?: readonly SupportedBadgeRuleType[]) {
  const now = new Date()
  return prisma.badgeRule.findMany({
    where: {
      isEnabled: true,
      ...(ruleTypes ? { ruleType: { in: [...new Set(ruleTypes)] } } : {}),
      Badge: { isEnabled: true, isActive: true, grantType: 'AUTO', ...badgeAvailabilityWhere(now) },
    },
    select: {
      id: true,
      badgeId: true,
      ruleType: true,
      operator: true,
      threshold: true,
      secondaryThreshold: true,
      configJson: true,
      isEnabled: true,
    },
  })
}

export async function evaluateUserAutoBadges(userId: string, ruleTypes?: readonly SupportedBadgeRuleType[]) {
  const summary = emptySummary(userId)
  const rules = await loadEnabledRules(ruleTypes)
  const metrics = new Map<string, number>()
  const newlyGranted: Array<{ badgeId: string; recordId: string }> = []
  const needsConcertTargets = rules.some((rule) => rule.ruleType === 'CONCERT_SHOW_ATTENDED' || rule.ruleType === 'CONCERT_TOUR_ATTENDED')
  const concertFacts = needsConcertTargets
    ? await prisma.userMusicConcert.findMany({ where: { userId }, select: { concertId: true, MusicConcert: { select: { tourId: true } } } })
    : []

  for (const rule of rules) {
    const type = rule.ruleType as SupportedBadgeRuleType
    // Activity participation has an activity-scoped predicate and is handled
    // by the shared activity scanner, never by the scalar event evaluator.
    if (type === 'BADGE_SERIES_COMPLETE' || type === 'ACTIVITY_PARTICIPATION') continue
    const config = rule.configJson && typeof rule.configJson === 'object' && !Array.isArray(rule.configJson) ? rule.configJson as { concertId?: unknown; tourId?: unknown } : null
    const isTargetRule = type === 'CONCERT_SHOW_ATTENDED' || type === 'CONCERT_TOUR_ATTENDED'
    const metricKey = isTargetRule ? `${type}:${String(config?.concertId || config?.tourId || '')}` : type
    if (!isTargetRule && rule.threshold === null) continue
    if (!metrics.has(metricKey)) {
      const targetMetric = type === 'CONCERT_SHOW_ATTENDED'
        ? concertFacts.some((fact) => fact.concertId === config?.concertId) ? 1 : 0
        : type === 'CONCERT_TOUR_ATTENDED'
          ? concertFacts.some((fact) => fact.MusicConcert.tourId === config?.tourId) ? 1 : 0
          : await getUserBadgeMetric(userId, type)
      metrics.set(metricKey, targetMetric)
    }
    summary.evaluated += 1
    if (!evaluateBadgeMetric(metrics.get(metricKey) || 0, rule.operator as BadgeRuleOperatorValue, isTargetRule ? 1 : rule.threshold!)) continue
    summary.eligible += 1
    try {
      const result = await grantBadge({
        userId,
        badgeId: rule.badgeId,
        sourceType: 'AUTO_RULE',
        sourceId: rule.id,
        grantReason: `自动达成：${ruleDescription({ ruleType: type, threshold: rule.threshold })}`,
        deferPhase3Effects: true,
      })
      if (result.created) {
        summary.granted += 1
        newlyGranted.push({ badgeId: result.badgeId, recordId: result.recordId })
      }
      else summary.alreadyOwned += 1
    } catch (error) {
      summary.failed += 1
      summary.failures.push(`${rule.id}:${error instanceof Error ? error.message : '发放失败'}`)
    }
  }
  if (newlyGranted.length) {
    try {
      await processBadgeGrantEffects({ userId, grants: newlyGranted })
    } catch (error) {
      console.error('[badge-rule.phase3-effects]', { userId, error })
    }
  }
  try {
    const { processTrackedBadgeMilestones } = await import('@/lib/badge-phase5')
    await processTrackedBadgeMilestones(userId, ruleTypes || [...new Set(rules.map((rule) => rule.ruleType as SupportedBadgeRuleType))])
  } catch (error) {
    console.error('[badge-rule.milestones]', { userId, error })
  }
  return summary
}

export async function evaluateBadgesForEvent(userId: string, eventType: BadgeEvaluationEvent) {
  const ruleTypes = EVENT_RULE_TYPES[eventType]
  if (!ruleTypes) {
    console.warn('[badge-rule.event.invalid]', { userId, eventType })
    return emptySummary(userId)
  }
  return evaluateUserAutoBadges(userId, ruleTypes)
}

/** Event hooks deliberately do not await this function, so badge rules cannot slow or roll back the primary action. */
export function triggerBadgeEvaluation(userId: string, eventType: BadgeEvaluationEvent): Promise<boolean> {
  const task = evaluateBadgesForEvent(userId, eventType).then((summary) => {
    if (summary.failed > 0) {
      console.error('[badge-rule.event.partial]', { userId, eventType, failed: summary.failed, failures: summary.failures.slice(0, 10) })
      return false
    }
    return true
  }).catch((error) => {
    console.error('[badge-rule.event]', { userId, eventType, error })
    return false
  })
  // Existing event hooks intentionally do not await this promise. It resolves
  // to false after logging instead of rejecting, so ignored hooks cannot create
  // an unhandled rejection. A durable caller may await it and inspect false.
  void task
  return task
}

export type BadgeMetricUser = { id: string; createdAt: Date }

function createMetricMap(rows: BadgeMetricUser[]) {
  return new Map(rows.map((row) => [row.id, 0]))
}

export async function getBatchBadgeMetrics(users: BadgeMetricUser[], ruleType: SupportedBadgeRuleType, configJson?: unknown) {
  const userIds = users.map((user) => user.id)
  const metrics = createMetricMap(users)
  if (!userIds.length) return metrics

  switch (ruleType) {
    case 'POST_COUNT':
    case 'FEATURED_POST_COUNT': {
      const rows = await prisma.post.groupBy({
        by: ['authorId'],
        where: { authorId: { in: userIds }, ...VALID_POST_WHERE, ...(ruleType === 'FEATURED_POST_COUNT' ? { isFeatured: true } : {}) },
        _count: { _all: true },
      })
      rows.forEach((row) => metrics.set(row.authorId, row._count._all))
      return metrics
    }
    case 'CHECKIN_TOTAL_DAYS': {
      const rows = await prisma.checkIn.findMany({ where: { userId: { in: userIds } }, select: { userId: true, checkinDateKey: true } })
      const dates = new Map<string, Set<string>>()
      rows.forEach((row) => {
        const userDates = dates.get(row.userId) || new Set<string>()
        userDates.add(row.checkinDateKey)
        dates.set(row.userId, userDates)
      })
      dates.forEach((dateKeys, userId) => metrics.set(userId, dateKeys.size))
      return metrics
    }
    case 'CHECKIN_STREAK': {
      const rows = await prisma.checkIn.findMany({ where: { userId: { in: userIds } }, select: { userId: true, checkinDateKey: true } })
      const dates = new Map<string, string[]>()
      rows.forEach((row) => {
        const userDates = dates.get(row.userId)
        if (userDates) userDates.push(row.checkinDateKey)
        else dates.set(row.userId, [row.checkinDateKey])
      })
      users.forEach((user) => metrics.set(user.id, calculateCheckinStreaks(dates.get(user.id) || []).currentStreak))
      return metrics
    }
    case 'ACCOUNT_AGE_DAYS':
      users.forEach((user) => metrics.set(user.id, accountAgeDays(user.createdAt)))
      return metrics
    case 'FRIEND_COUNT': {
      const [left, right] = await Promise.all([
        prisma.friendship.groupBy({
          by: ['userAId'],
          where: {
            userAId: { in: userIds },
            User_Friendship_userAIdToUser: ACTIVE_RELATION_USER_WHERE,
            User_Friendship_userBIdToUser: ACTIVE_RELATION_USER_WHERE,
          },
          _count: { _all: true },
        }),
        prisma.friendship.groupBy({
          by: ['userBId'],
          where: {
            userBId: { in: userIds },
            User_Friendship_userAIdToUser: ACTIVE_RELATION_USER_WHERE,
            User_Friendship_userBIdToUser: ACTIVE_RELATION_USER_WHERE,
          },
          _count: { _all: true },
        }),
      ])
      left.forEach((row) => metrics.set(row.userAId, (metrics.get(row.userAId) || 0) + row._count._all))
      right.forEach((row) => metrics.set(row.userBId, (metrics.get(row.userBId) || 0) + row._count._all))
      return metrics
    }
    case 'FOLLOWER_COUNT': {
      const rows = await prisma.follow.groupBy({
        by: ['followingId'],
        where: {
          followingId: { in: userIds },
          User_Follow_followerIdToUser: ACTIVE_RELATION_USER_WHERE,
          User_Follow_followingIdToUser: ACTIVE_RELATION_USER_WHERE,
        },
        _count: { _all: true },
      })
      rows.forEach((row) => metrics.set(row.followingId, row._count._all))
      return metrics
    }
    case 'GUESS_SONG_MAX_STREAK': {
      const rows = await prisma.guessSongSession.groupBy({
        by: ['userId'],
        where: { userId: { in: userIds }, status: 'COMPLETED', completedAt: { not: null }, isValid: true, riskScore: { lt: GUESS_SONG_RISK_THRESHOLD } },
        _max: { maxStreak: true },
      })
      rows.forEach((row) => metrics.set(row.userId, safeMetric(row._max.maxStreak)))
      return metrics
    }
    case 'DUEL_WIN_COUNT': {
      const rows = await prisma.guessSongDuelStats.findMany({ where: { userId: { in: userIds } }, select: { userId: true, wins: true } })
      rows.forEach((row) => metrics.set(row.userId, row.wins))
      return metrics
    }
    case 'WANT_LISTEN_MAX_STREAK': {
      const rows = await prisma.wantListenStats.groupBy({ by: ['userId'], where: { userId: { in: userIds } }, _max: { maxStreak: true } })
      rows.forEach((row) => metrics.set(row.userId, safeMetric(row._max.maxStreak)))
      return metrics
    }
    case 'CONCERT_ATTENDANCE_COUNT': {
      const rows = await prisma.userMusicConcert.groupBy({ by: ['userId'], where: { userId: { in: userIds } }, _count: { _all: true } })
      rows.forEach((row) => metrics.set(row.userId, row._count._all))
      return metrics
    }
    case 'CONCERT_SHOW_ATTENDED':
    case 'CONCERT_TOUR_ATTENDED': {
      const config = configJson && typeof configJson === 'object' && !Array.isArray(configJson) ? configJson as { concertId?: unknown; tourId?: unknown } : null
      const rows = await prisma.userMusicConcert.findMany({
        where: {
          userId: { in: userIds },
          ...(ruleType === 'CONCERT_SHOW_ATTENDED'
            ? { concertId: typeof config?.concertId === 'string' ? config.concertId : '__invalid__' }
            : { MusicConcert: { tourId: typeof config?.tourId === 'string' ? config.tourId : '__invalid__' } }),
        },
        select: { userId: true },
      })
      rows.forEach((row) => metrics.set(row.userId, 1))
      return metrics
    }
    case 'RATING_COUNT': {
      const rows = await prisma.rating.groupBy({ by: ['userId'], where: { userId: { in: userIds } }, _count: { _all: true } })
      rows.forEach((row) => metrics.set(row.userId, row._count._all))
      return metrics
    }
    case 'BADGE_SERIES_COMPLETE':
    case 'ACTIVITY_PARTICIPATION':
      return metrics
  }
  return metrics
}

export async function backfillBadgeRule({ badgeId, cursor, batchSize = 200 }: { badgeId: string; cursor?: string | null; batchSize?: number }): Promise<BadgeBackfillSummary> {
  const boundedBatchSize = normalizeBackfillBatchSize(batchSize)
  const normalizedCursor = normalizeBackfillCursor(cursor)
  const badge = await prisma.badge.findUnique({
    where: { id: badgeId },
    select: {
      id: true,
      isEnabled: true,
      isActive: true,
      grantType: true,
      availableFrom: true,
      availableUntil: true,
      BadgeRule: { select: { id: true, ruleType: true, operator: true, threshold: true, configJson: true, isEnabled: true } },
    },
  })
  if (!badge || !badge.BadgeRule) throw new Error('勋章或自动规则不存在')
  if (!badge.isEnabled || !badge.isActive || badge.grantType !== 'AUTO' || !badge.BadgeRule.isEnabled) throw new Error('勋章或自动规则当前未启用')

  const type = badge.BadgeRule.ruleType as SupportedBadgeRuleType
  const availability = getBadgeAvailability(badge)
  if (availability === 'UPCOMING') throw new Error('限定勋章尚未开始，不能进行历史扫描')
  const historicalCapability = getHistoricalBackfillCapability(type)
  const isLimited = Boolean(badge.availableFrom || badge.availableUntil)
  const mode: BadgeBackfillSummary['mode'] = isLimited ? 'HISTORICAL_WINDOW' : 'CURRENT'
  const historicalWindow: HistoricalQualificationWindow | null = isLimited
    ? getHistoricalQualificationWindow({ availableFrom: badge.availableFrom, availableUntil: badge.availableUntil })
    : null
  if (isLimited && !historicalCapability.supported) throw new Error(`该规则无法可靠判断限定期历史资格：${historicalCapability.basis}`)

  if (type === 'BADGE_SERIES_COMPLETE') {
    const config = badge.BadgeRule.configJson && typeof badge.BadgeRule.configJson === 'object' && !Array.isArray(badge.BadgeRule.configJson) ? badge.BadgeRule.configJson as { seriesId?: unknown } : null
    const seriesId = typeof config?.seriesId === 'string' ? config.seriesId : ''
    if (!seriesId) throw new Error('系列完成规则缺少系列配置')
    const eligibleIds = await getSeriesCompletionEligibleUserIds(seriesId)
    const candidates = eligibleIds.filter((id) => !normalizedCursor || id > normalizedCursor)
    const hasMore = candidates.length > boundedBatchSize
    const rows = (hasMore ? candidates.slice(0, boundedBatchSize) : candidates).map((id) => ({ id }))
    const summary: BadgeBackfillSummary = {
      badgeId,
      ruleId: badge.BadgeRule.id,
      ruleType: type,
      scanned: rows.length,
      granted: 0,
      alreadyOwned: 0,
      notEligible: 0,
      failed: 0,
      failures: [],
      nextCursor: hasMore ? rows.at(-1)?.id || null : null,
      done: !hasMore,
      mode,
      historicalWindow: historicalWindow ? { from: historicalWindow.from.toISOString(), until: historicalWindow.until.toISOString() } : null,
    }
    const newlyGranted: Array<{ userId: string; badgeId: string; recordId: string }> = []
    for (const user of rows) {
      try {
        const result = await grantBadge({
          userId: user.id,
          badgeId,
          sourceType: 'AUTO_RULE',
          sourceId: badge.BadgeRule.id,
          grantReason: '完成勋章系列后获得',
          availabilityMode: mode,
          ...(historicalWindow ? { historicalWindow } : {}),
          deferPhase3Effects: true,
        })
        if (result.created) {
          summary.granted += 1
          newlyGranted.push({ userId: user.id, badgeId: result.badgeId, recordId: result.recordId })
        } else summary.alreadyOwned += 1
      } catch (error) {
        summary.failed += 1
        summary.failures.push(`${user.id}:${error instanceof Error ? error.message : '发放失败'}`)
      }
    }
    // Series-completion backfill may contain multiple users. Effects are
    // intentionally processed per user so one notification never crosses users.
    for (const user of rows) {
      const userGrants = newlyGranted.filter((grant) => grant.userId === user.id).map(({ badgeId: ownedBadgeId, recordId }) => ({ badgeId: ownedBadgeId, recordId }))
      if (userGrants.length) await processBadgeGrantEffects({ userId: user.id, grants: userGrants }).catch((error) => console.error('[badge.series.backfill.effects]', { userId: user.id, error }))
    }
    return summary
  }

  if (type === 'ACTIVITY_PARTICIPATION') {
    const config = badge.BadgeRule.configJson && typeof badge.BadgeRule.configJson === 'object' && !Array.isArray(badge.BadgeRule.configJson)
      ? badge.BadgeRule.configJson as { activityId?: unknown }
      : null
    const activityId = typeof config?.activityId === 'string' ? config.activityId : ''
    if (!activityId) throw new Error('参加指定活动规则缺少活动配置')
    const result = await grantEligibleActivityBadges({ badgeId, activityId, batchSize: boundedBatchSize })
    return {
      badgeId,
      ruleId: badge.BadgeRule.id,
      ruleType: type,
      scanned: result.scannedRegistrations,
      granted: result.granted,
      alreadyOwned: result.alreadyOwned,
      notEligible: 0,
      failed: result.failed,
      failures: result.failures,
      nextCursor: null,
      done: true,
      mode,
      historicalWindow: historicalWindow ? { from: historicalWindow.from.toISOString(), until: historicalWindow.until.toISOString() } : null,
    }
  }

  const users = await prisma.user.findMany({
    where: { status: 'ACTIVE', isDeleted: false, ...(normalizedCursor ? { id: { gt: normalizedCursor } } : {}) },
    orderBy: { id: 'asc' },
    take: boundedBatchSize + 1,
    select: { id: true, createdAt: true },
  })
  const hasMore = users.length > boundedBatchSize
  const rows = hasMore ? users.slice(0, boundedBatchSize) : users
  const metrics = mode === 'HISTORICAL_WINDOW'
    ? await getBatchHistoricalBadgeMetrics(rows, type, badge.BadgeRule.configJson, historicalWindow!)
    : await getBatchBadgeMetrics(rows, type, badge.BadgeRule.configJson)
  const summary: BadgeBackfillSummary = {
    badgeId,
    ruleId: badge.BadgeRule.id,
    ruleType: type,
    scanned: rows.length,
    granted: 0,
    alreadyOwned: 0,
    notEligible: 0,
    failed: 0,
    failures: [],
    nextCursor: hasMore ? rows.at(-1)?.id || null : null,
    done: !hasMore,
    mode,
    historicalWindow: historicalWindow ? { from: historicalWindow.from.toISOString(), until: historicalWindow.until.toISOString() } : null,
  }

  const newlyGranted: Array<{ userId: string; badgeId: string; recordId: string }> = []
  for (const user of rows) {
    const targetThreshold = type === 'CONCERT_SHOW_ATTENDED' || type === 'CONCERT_TOUR_ATTENDED' ? 1 : badge.BadgeRule.threshold
    if (targetThreshold === null || !evaluateBadgeMetric(metrics.get(user.id) || 0, badge.BadgeRule.operator as BadgeRuleOperatorValue, targetThreshold)) {
      summary.notEligible += 1
      continue
    }
    try {
      const result = await grantBadge({
        userId: user.id,
        badgeId,
        sourceType: 'AUTO_RULE',
        sourceId: badge.BadgeRule.id,
        grantReason: mode === 'HISTORICAL_WINDOW'
          ? `限定期历史资格补发：${historicalWindow!.from.toISOString()} 至 ${historicalWindow!.until.toISOString()}；${ruleDescription({ ruleType: type, threshold: badge.BadgeRule.threshold })}`
          : `自动达成：${ruleDescription({ ruleType: type, threshold: badge.BadgeRule.threshold })}`,
        availabilityMode: mode,
        ...(historicalWindow ? { historicalWindow } : {}),
        deferPhase3Effects: true,
      })
      if (result.created) {
        summary.granted += 1
        newlyGranted.push({ userId: user.id, badgeId: result.badgeId, recordId: result.recordId })
      }
      else summary.alreadyOwned += 1
    } catch (error) {
      summary.failed += 1
      summary.failures.push(`${user.id}:${error instanceof Error ? error.message : '发放失败'}`)
    }
  }
  if (newlyGranted.length) {
    // A normal backfill batch is scoped to one badge but can contain many users;
    // effects are kept isolated per user while the grant loop remains idempotent.
    for (const user of rows) {
      const grants = newlyGranted.filter((grant) => grant.userId === user.id).map(({ badgeId: ownedBadgeId, recordId }) => ({ badgeId: ownedBadgeId, recordId }))
      if (grants.length) await processBadgeGrantEffects({ userId: user.id, grants }).catch((error) => console.error('[badge.backfill.effects]', { userId: user.id, error }))
    }
  }
  return summary
}

export type BadgeRulePreview = {
  badgeId: string
  ruleId: string
  ruleType: SupportedBadgeRuleType
  operator: BadgeRuleOperatorValue
  threshold: number | null
  availability: ReturnType<typeof getBadgeAvailability>
  eligibleCount: number
  ownedCount: number
  pendingCount: number
  historical: {
    supported: boolean
    mode: 'CURRENT' | 'HISTORICAL_WINDOW' | 'UNSUPPORTED' | 'UPCOMING'
    basis: string
    from: string | null
    until: string | null
    message: string | null
  }
}

/**
 * Preview walks bounded user pages and uses the batch metric loader. It never
 * materializes the whole user table or grants a badge.
 */
export async function previewBadgeRule(badgeId: string): Promise<BadgeRulePreview> {
  const badge = await prisma.badge.findUnique({
    where: { id: badgeId },
    select: {
      id: true,
      grantType: true,
      isEnabled: true,
      isActive: true,
      availableFrom: true,
      availableUntil: true,
      BadgeRule: { select: { id: true, ruleType: true, operator: true, threshold: true, configJson: true, isEnabled: true } },
    },
  })
  if (!badge?.BadgeRule) throw new Error('勋章或自动规则不存在')
  if (badge.grantType !== 'AUTO') throw new Error('只有系统自动授予勋章可以预览规则')
  if (!badge.isEnabled || !badge.isActive) throw new Error('勋章当前未启用')
  if (!badge.BadgeRule.isEnabled) throw new Error('自动规则当前未启用')
  const availability = getBadgeAvailability(badge)
  const type = badge.BadgeRule.ruleType as SupportedBadgeRuleType
  const operator = badge.BadgeRule.operator as BadgeRuleOperatorValue
  const capability = getHistoricalBackfillCapability(type)
  const isLimited = Boolean(badge.availableFrom || badge.availableUntil)
  const historicalWindow = isLimited ? getHistoricalQualificationWindow({ availableFrom: badge.availableFrom, availableUntil: badge.availableUntil }) : null
  const historical = {
    supported: capability.supported,
    mode: availability === 'UPCOMING' ? 'UPCOMING' as const : isLimited && !capability.supported ? 'UNSUPPORTED' as const : isLimited ? 'HISTORICAL_WINDOW' as const : 'CURRENT' as const,
    basis: capability.basis,
    from: historicalWindow?.from.toISOString() || null,
    until: historicalWindow?.until.toISOString() || null,
    message: availability === 'UPCOMING' ? '限定勋章尚未开始，当前没有可扫描的历史资格' : isLimited && !capability.supported ? `该规则无法可靠判断限定期历史资格：${capability.basis}` : null,
  }
  const ownedCount = await prisma.userBadge.count({ where: { badgeId, User: ACTIVE_RELATION_USER_WHERE } })
  if (availability === 'UPCOMING' || (isLimited && !capability.supported)) {
    return {
      badgeId,
      ruleId: badge.BadgeRule.id,
      ruleType: type,
      operator,
      threshold: badge.BadgeRule.threshold,
      availability,
      eligibleCount: 0,
      ownedCount,
      pendingCount: 0,
      historical,
    }
  }

  if (type === 'BADGE_SERIES_COMPLETE') {
    const config = badge.BadgeRule.configJson && typeof badge.BadgeRule.configJson === 'object' && !Array.isArray(badge.BadgeRule.configJson) ? badge.BadgeRule.configJson as { seriesId?: unknown } : null
    const seriesId = typeof config?.seriesId === 'string' ? config.seriesId : ''
    if (!seriesId) throw new Error('系列完成规则缺少系列配置')
    const stats = await getSeriesCompletionPreview(seriesId, badgeId)
    return { badgeId, ruleId: badge.BadgeRule.id, ruleType: type, operator, threshold: null, availability, ...stats, historical }
  }
  if (type === 'ACTIVITY_PARTICIPATION') {
    const config = badge.BadgeRule.configJson && typeof badge.BadgeRule.configJson === 'object' && !Array.isArray(badge.BadgeRule.configJson)
      ? badge.BadgeRule.configJson as { activityId?: unknown }
      : null
    const activityId = typeof config?.activityId === 'string' ? config.activityId : ''
    if (!activityId) throw new Error('参加指定活动规则缺少活动配置')
    const stats = await getActivityParticipationBadgeStats({ badgeId, activityId })
    return { badgeId, ruleId: badge.BadgeRule.id, ruleType: type, operator, threshold: null, availability, ...stats, historical }
  }
  let cursor: string | undefined
  let eligibleCount = 0
  let pendingCount = 0
  while (true) {
    const users = await prisma.user.findMany({
      where: { status: 'ACTIVE', isDeleted: false, ...(cursor ? { id: { gt: cursor } } : {}) },
      orderBy: { id: 'asc' },
      take: BACKFILL_BATCH_MAX,
      select: { id: true, createdAt: true },
    })
    if (!users.length) break
    const metrics = historicalWindow
      ? await getBatchHistoricalBadgeMetrics(users, type, badge.BadgeRule.configJson, historicalWindow)
      : await getBatchBadgeMetrics(users, type, badge.BadgeRule.configJson)
    const targetThreshold = type === 'CONCERT_SHOW_ATTENDED' || type === 'CONCERT_TOUR_ATTENDED' ? 1 : badge.BadgeRule.threshold
    const eligibleIds = users
      .filter((user) => targetThreshold !== null && evaluateBadgeMetric(metrics.get(user.id) || 0, operator, targetThreshold))
      .map((user) => user.id)
    eligibleCount += eligibleIds.length
    if (eligibleIds.length) {
      const ownedEligibleCount = await prisma.userBadge.count({
        where: { badgeId, userId: { in: eligibleIds } },
      })
      pendingCount += Math.max(0, eligibleIds.length - ownedEligibleCount)
    }
    cursor = users.at(-1)?.id
    if (users.length < BACKFILL_BATCH_MAX) break
  }
  return {
    badgeId,
    ruleId: badge.BadgeRule.id,
    ruleType: type,
    operator,
    threshold: badge.BadgeRule.threshold,
    availability,
    eligibleCount,
    ownedCount,
    pendingCount,
    historical,
  }
}

const BACKFILL_BATCH_MIN = 100
const BACKFILL_BATCH_MAX = 500

export function normalizeBackfillBatchSize(value: number | undefined) {
  const normalized = value === undefined ? 200 : value
  if (!Number.isSafeInteger(normalized) || normalized < BACKFILL_BATCH_MIN || normalized > BACKFILL_BATCH_MAX) {
    throw new Error(`批量补发数量必须是 ${BACKFILL_BATCH_MIN} 到 ${BACKFILL_BATCH_MAX} 的整数`)
  }
  return normalized
}

export function normalizeBackfillCursor(value: string | null | undefined) {
  if (value === undefined || value === null || value === '') return undefined
  const normalized = value.trim()
  if (normalized !== value || normalized.length > 191 || /[\u0000-\u001f\u007f]/.test(normalized)) throw new Error('批量补发游标格式无效')
  return normalized || undefined
}

export const BADGE_RULE_EVENT_MAP = EVENT_RULE_TYPES
export const SUPPORTED_BADGE_RULE_TYPES = BADGE_RULE_TYPES_WITH_SPECIAL
