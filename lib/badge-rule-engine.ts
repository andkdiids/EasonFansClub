import { calculateCheckinStreaks, getShanghaiDateKey, parseBeijingDate } from '@/lib/checkin'
import { GUESS_SONG_RISK_THRESHOLD } from '@/lib/guess-song-risk'
import { prisma } from '@/lib/prisma'
import { grantBadge } from '@/lib/badge-service'
import {
  BADGE_EVALUATION_EVENTS,
  BADGE_RULE_REGISTRY,
  BADGE_RULE_TYPES,
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
    BADGE_RULE_TYPES.filter((ruleType) => supportsEvent(ruleType, eventType)),
  ]),
) as unknown as Record<BadgeEvaluationEvent, readonly SupportedBadgeRuleType[]>

const VALID_POST_WHERE = {
  status: 'PUBLISHED' as const,
  isDeleted: false,
  moderationStatus: 'APPROVED' as const,
}

const ACTIVE_RELATION_USER_WHERE = {
  status: 'ACTIVE' as const,
  isDeleted: false,
}

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
}

function emptySummary(userId: string): BadgeEvaluationSummary {
  return { userId, evaluated: 0, eligible: 0, granted: 0, alreadyOwned: 0, failed: 0, failures: [] }
}

export function evaluateBadgeMetric(value: number, operator: BadgeRuleOperatorValue, threshold: number) {
  if (operator === 'LTE') return value <= threshold
  if (operator === 'EQ') return value === threshold
  return value >= threshold
}

function safeMetric(value: number | null | undefined) {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, value) : 0
}

function accountAgeDays(createdAt: Date, now = new Date()) {
  const created = parseBeijingDate(getShanghaiDateKey(createdAt))
  const today = parseBeijingDate(getShanghaiDateKey(now))
  if (!created || !today) return Math.max(0, Math.floor((now.getTime() - createdAt.getTime()) / 86_400_000))
  return Math.max(0, Math.floor((today.getTime() - created.getTime()) / 86_400_000))
}

type BadgeMetricLoader = (userId: string) => Promise<number>

const BADGE_RULE_METRIC_LOADERS: Record<SupportedBadgeRuleType, BadgeMetricLoader> = {
  POST_COUNT: (userId) => prisma.post.count({ where: { authorId: userId, ...VALID_POST_WHERE } }),
  FEATURED_POST_COUNT: (userId) => prisma.post.count({ where: { authorId: userId, isFeatured: true, ...VALID_POST_WHERE } }),
  CHECKIN_TOTAL_DAYS: (userId) => prisma.checkIn.count({ where: { userId } }),
  CHECKIN_STREAK: async (userId) => {
    const rows = await prisma.checkIn.findMany({ where: { userId }, select: { checkinDateKey: true } })
    return calculateCheckinStreaks(rows.map((row) => row.checkinDateKey)).currentStreak
  },
  ACCOUNT_AGE_DAYS: async (userId) => {
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { createdAt: true } })
    return user ? accountAgeDays(user.createdAt) : 0
  },
  FRIEND_COUNT: (userId) => prisma.friendship.count({
    where: {
      OR: [{ userAId: userId }, { userBId: userId }],
      User_Friendship_userAIdToUser: ACTIVE_RELATION_USER_WHERE,
      User_Friendship_userBIdToUser: ACTIVE_RELATION_USER_WHERE,
    },
  }),
  FOLLOWER_COUNT: (userId) => prisma.follow.count({
    where: {
      followingId: userId,
      User_Follow_followerIdToUser: ACTIVE_RELATION_USER_WHERE,
      User_Follow_followingIdToUser: ACTIVE_RELATION_USER_WHERE,
    },
  }),
  GUESS_SONG_MAX_STREAK: async (userId) => {
    const result = await prisma.guessSongSession.aggregate({
      where: {
        userId,
        status: 'COMPLETED',
        completedAt: { not: null },
        isValid: true,
        riskScore: { lt: GUESS_SONG_RISK_THRESHOLD },
      },
      _max: { maxStreak: true },
    })
    return safeMetric(result._max.maxStreak)
  },
  DUEL_WIN_COUNT: async (userId) => {
    const result = await prisma.guessSongDuelStats.findUnique({ where: { userId }, select: { wins: true } })
    return safeMetric(result?.wins)
  },
  WANT_LISTEN_MAX_STREAK: async (userId) => {
    const result = await prisma.wantListenStats.aggregate({ where: { userId }, _max: { maxStreak: true } })
    return safeMetric(result._max.maxStreak)
  },
  CONCERT_ATTENDANCE_COUNT: (userId) => prisma.userMusicConcert.count({ where: { userId } }),
  RATING_COUNT: (userId) => prisma.rating.count({ where: { userId } }),
}

export function getBadgeMetricLoader(ruleType: SupportedBadgeRuleType) {
  const loaderKey = BADGE_RULE_REGISTRY[ruleType].metricLoader as SupportedBadgeRuleType
  return BADGE_RULE_METRIC_LOADERS[loaderKey]
}

export async function getUserBadgeMetric(userId: string, ruleType: SupportedBadgeRuleType): Promise<number> {
  return getBadgeMetricLoader(ruleType)(userId)
}

function ruleDescription(rule: Pick<ParsedBadgeRule, 'ruleType' | 'threshold'>) {
  return generateBadgeAcquisitionDescription(rule.ruleType, rule.threshold)
}

async function loadEnabledRules(ruleTypes?: readonly SupportedBadgeRuleType[]) {
  return prisma.badgeRule.findMany({
    where: {
      isEnabled: true,
      ...(ruleTypes ? { ruleType: { in: [...new Set(ruleTypes)] } } : {}),
      Badge: { isEnabled: true, isActive: true, grantType: 'AUTO' },
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
  const metrics = new Map<SupportedBadgeRuleType, number>()

  for (const rule of rules) {
    const type = rule.ruleType as SupportedBadgeRuleType
    if (!metrics.has(type)) metrics.set(type, await getUserBadgeMetric(userId, type))
    summary.evaluated += 1
    if (!evaluateBadgeMetric(metrics.get(type) || 0, rule.operator as BadgeRuleOperatorValue, rule.threshold)) continue
    summary.eligible += 1
    try {
      const result = await grantBadge({
        userId,
        badgeId: rule.badgeId,
        sourceType: 'AUTO_RULE',
        sourceId: rule.id,
        grantReason: `自动达成：${ruleDescription({ ruleType: type, threshold: rule.threshold })}`,
      })
      if (result.created) summary.granted += 1
      else summary.alreadyOwned += 1
    } catch (error) {
      summary.failed += 1
      summary.failures.push(`${rule.id}:${error instanceof Error ? error.message : '发放失败'}`)
    }
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
export function triggerBadgeEvaluation(userId: string, eventType: BadgeEvaluationEvent) {
  void evaluateBadgesForEvent(userId, eventType).catch((error) => {
    console.error('[badge-rule.event]', { userId, eventType, error })
  })
}

type BackfillUser = { id: string; createdAt: Date }

function createMetricMap(rows: BackfillUser[]) {
  return new Map(rows.map((row) => [row.id, 0]))
}

async function getBatchMetrics(users: BackfillUser[], ruleType: SupportedBadgeRuleType) {
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
      const rows = await prisma.checkIn.groupBy({ by: ['userId'], where: { userId: { in: userIds } }, _count: { _all: true } })
      rows.forEach((row) => metrics.set(row.userId, row._count._all))
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
    case 'RATING_COUNT': {
      const rows = await prisma.rating.groupBy({ by: ['userId'], where: { userId: { in: userIds } }, _count: { _all: true } })
      rows.forEach((row) => metrics.set(row.userId, row._count._all))
      return metrics
    }
  }
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
      BadgeRule: { select: { id: true, ruleType: true, operator: true, threshold: true, isEnabled: true } },
    },
  })
  if (!badge || !badge.BadgeRule) throw new Error('勋章或自动规则不存在')
  if (!badge.isEnabled || !badge.isActive || badge.grantType !== 'AUTO' || !badge.BadgeRule.isEnabled) throw new Error('勋章或自动规则当前未启用')

  const users = await prisma.user.findMany({
    where: { status: 'ACTIVE', isDeleted: false, ...(normalizedCursor ? { id: { gt: normalizedCursor } } : {}) },
    orderBy: { id: 'asc' },
    take: boundedBatchSize + 1,
    select: { id: true, createdAt: true },
  })
  const hasMore = users.length > boundedBatchSize
  const rows = hasMore ? users.slice(0, boundedBatchSize) : users
  const type = badge.BadgeRule.ruleType as SupportedBadgeRuleType
  const metrics = await getBatchMetrics(rows, type)
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
  }

  for (const user of rows) {
    if (!evaluateBadgeMetric(metrics.get(user.id) || 0, badge.BadgeRule.operator as BadgeRuleOperatorValue, badge.BadgeRule.threshold)) {
      summary.notEligible += 1
      continue
    }
    try {
      const result = await grantBadge({
        userId: user.id,
        badgeId,
        sourceType: 'AUTO_RULE',
        sourceId: badge.BadgeRule.id,
        grantReason: `自动达成：${ruleDescription({ ruleType: type, threshold: badge.BadgeRule.threshold })}`,
      })
      if (result.created) summary.granted += 1
      else summary.alreadyOwned += 1
    } catch (error) {
      summary.failed += 1
      summary.failures.push(`${user.id}:${error instanceof Error ? error.message : '发放失败'}`)
    }
  }
  return summary
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
export const SUPPORTED_BADGE_RULE_TYPES = BADGE_RULE_TYPES
