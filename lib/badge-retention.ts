import { prisma } from '@/lib/prisma'
import { hasValidActivityParticipation } from '@/lib/activity-participation'
import { getBadgeAvailability } from '@/lib/badge-phase2'
import { getBadgeOwnershipRuleConfig, matchBadgeOwnershipConfig } from '@/lib/badge-ownership-config'
import { getUserBadgeMetric } from '@/lib/badge-metrics'
import { evaluateBadgeRule } from '@/lib/badge-rule-engine'
import {
  BADGE_RULE_REGISTRY,
  BADGE_RETENTION_POLICIES,
  resolveBadgeRetentionPolicy,
  supportsBadgeRetentionPolicy,
  type BadgeRetentionPolicyValue,
  type SupportedBadgeRuleType,
} from '@/lib/badge-rules'
import { revokeBadgeAcquisitionSource } from '@/lib/badge-service'
import { activeUserBadgeWhere } from '@/lib/badge-validity'
import { BIRTHDAY_BADGE_SLUG } from '@/lib/birthday-constants'

/**
 * Re-derivation of automatic badge conditions.
 *
 * Only the automatic earning source is ever touched. Manual grants, event
 * grants, admin grants, admin backfills and event/concert gifts live under
 * their own sourceType and are never considered here, so a user who received
 * the same badge another way keeps it.
 *
 * The single source of truth for "may this rule recycle at all" is
 * BADGE_RULE_REGISTRY[ruleType].supportsRetentionWhileEligible; the per-rule
 * switch is BadgeRule.retentionPolicy. A rule only recycles when both agree.
 */

type StoredRetentionRule = {
  id: string
  badgeId: string
  ruleType: SupportedBadgeRuleType
  operator: string
  threshold: number | null
  configJson: unknown
  retentionPolicy: BadgeRetentionPolicyValue | null
  badgeName: string
  availableFrom: Date | null
  availableUntil: Date | null
  /** The pre-rule birthday badge is a BIRTHDAY_TODAY compatibility source. */
  legacyBirthdaySource?: boolean
}

function toRetentionPolicy(value: string | null): BadgeRetentionPolicyValue | null {
  if (!value) return null
  return (BADGE_RETENTION_POLICIES as readonly string[]).includes(value) ? value as BadgeRetentionPolicyValue : null
}

export type BadgeRetentionEvaluationSummary = {
  userId: string
  checked: number
  revoked: number
  stillEligible: number
  skipped: number
  failed: number
  failures: string[]
}

/**
 * Which UserBadgeSource rows a rule owns. Activity badges are granted under
 * their own source type by the activity reward scanner; everything else that
 * is structurally driven uses the shared AUTO_RULE source type.
 */
function governedSourceTypes(ruleType: SupportedBadgeRuleType): readonly string[] {
  return ruleType === 'ACTIVITY_PARTICIPATION' ? ['ACTIVITY_PARTICIPATION'] : ['AUTO_RULE']
}

function readConfigObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
}

function readId(value: unknown) {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{1,191}$/.test(value.trim()) ? value.trim() : null
}

async function isSeriesComplete(userId: string, config: Record<string, unknown>, now: Date) {
  const seriesId = readId(config.seriesId)
  if (!seriesId) return false
  const series = await prisma.badgeSeries.findUnique({
    where: { id: seriesId },
    select: { completionRewardBadgeId: true },
  })
  if (!series) return false
  const required = await prisma.badge.findMany({
    where: {
      seriesId,
      isEnabled: true,
      isActive: true,
      countsTowardSeriesCompletion: true,
      visibility: { not: 'SECRET' },
      ...(series.completionRewardBadgeId ? { id: { not: series.completionRewardBadgeId } } : {}),
    },
    select: { id: true },
  })
  if (!required.length) return false
  const owned = await prisma.userBadge.count({
    where: { userId, badgeId: { in: required.map((badge) => badge.id) }, ...activeUserBadgeWhere(now) },
  })
  return owned === required.length
}

async function isActivityParticipationSatisfied(userId: string, config: Record<string, unknown>, now: Date) {
  const activityId = readId(config.activityId)
  if (!activityId) return false
  const activity = await prisma.activity.findUnique({
    where: { id: activityId },
    select: { id: true, status: true, endsAt: true },
  })
  if (!activity || activity.status !== 'PUBLISHED') return false
  const registration = await prisma.activityRegistration.findFirst({
    where: {
      activityId,
      userId,
      status: 'ACTIVE',
      checkInSource: { in: ['MANUAL', 'QR'] },
      verifiedAt: { not: null },
    },
    select: { id: true, status: true, verifiedAt: true, checkedInAt: true, checkInSource: true },
  })
  return registration ? hasValidActivityParticipation(registration, activity.endsAt, now) : false
}

/** Recompute one rule against live business data. Never reads cached metrics. */
export async function isBadgeRuleSatisfied(
  userId: string,
  rule: { ruleType: SupportedBadgeRuleType; operator?: string; threshold?: number | null; configJson?: unknown },
  now = new Date(),
): Promise<boolean> {
  const ruleType = rule.ruleType
  const config = readConfigObject(rule.configJson)

  if (ruleType === 'BADGE_SERIES_COMPLETE') return config ? isSeriesComplete(userId, config, now) : false

  if (ruleType === 'BADGE_OWNERSHIP') {
    const ownership = getBadgeOwnershipRuleConfig(rule.configJson)
    if (!ownership) return false
    const owned = await prisma.userBadge.findMany({
      where: { userId, badgeId: { in: ownership.badgeIds }, ...activeUserBadgeWhere(now) },
      select: { badgeId: true },
    })
    return matchBadgeOwnershipConfig(new Set(owned.map((row) => row.badgeId)), ownership)
  }

  if (ruleType === 'ACTIVITY_PARTICIPATION') return config ? isActivityParticipationSatisfied(userId, config, now) : false

  if (ruleType === 'CONCERT_SHOW_ATTENDED' || ruleType === 'CONCERT_TOUR_ATTENDED') {
    const targetId = readId(config?.[ruleType === 'CONCERT_SHOW_ATTENDED' ? 'concertId' : 'tourId'])
    if (!targetId) return false
    const count = await prisma.userMusicConcert.count({
      where: ruleType === 'CONCERT_SHOW_ATTENDED'
        ? { userId, concertId: targetId }
        : { userId, MusicConcert: { tourId: targetId } },
    })
    return evaluateBadgeRule({ user: { id: userId }, rule: { ruleType, operator: rule.operator, threshold: rule.threshold ?? null, configJson: rule.configJson }, metric: count > 0 ? 1 : 0, now })
  }

  if (ruleType === 'BIRTHDAY_ZODIAC' || ruleType === 'BIRTHDAY_TODAY') {
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, birthMonth: true, birthDay: true } })
    if (!user) return false
    return evaluateBadgeRule({
      user: { id: user.id, birthMonth: user.birthMonth, birthDay: user.birthDay },
      rule: { ruleType, operator: rule.operator, threshold: rule.threshold ?? null, configJson: rule.configJson },
      now,
    })
  }

  const metric = await getUserBadgeMetric(userId, ruleType)
  return evaluateBadgeRule({
    user: { id: userId },
    rule: { ruleType, operator: rule.operator, threshold: rule.threshold ?? null, configJson: rule.configJson },
    metric,
    now,
  })
}

async function loadRecyclableRules(options: { ruleTypes?: readonly SupportedBadgeRuleType[]; badgeIds?: readonly string[] }) {
  const rows = await prisma.badgeRule.findMany({
    where: {
      isEnabled: true,
      Badge: { isEnabled: true, isActive: true, grantType: 'AUTO' },
      ...(options.ruleTypes?.length ? { ruleType: { in: [...new Set(options.ruleTypes)] } } : {}),
      ...(options.badgeIds?.length ? { badgeId: { in: [...new Set(options.badgeIds)] } } : {}),
    },
    select: {
      id: true,
      badgeId: true,
      ruleType: true,
      operator: true,
      threshold: true,
      configJson: true,
      retentionPolicy: true,
      Badge: { select: { id: true, name: true, availableFrom: true, availableUntil: true } },
    },
  })
  const rules = rows.map<StoredRetentionRule>((row) => ({
    id: row.id,
    badgeId: row.badgeId,
    ruleType: row.ruleType as SupportedBadgeRuleType,
    operator: row.operator,
    threshold: row.threshold,
    configJson: row.configJson,
    retentionPolicy: toRetentionPolicy(row.retentionPolicy),
    badgeName: row.Badge.name,
    availableFrom: row.Badge.availableFrom,
    availableUntil: row.Badge.availableUntil,
  }))

  // `birthday-commemorative` predates BadgeRule and is still granted by
  // ensureBirthdayBadge. Treat that automatic source as the compatibility
  // representation of BIRTHDAY_TODAY so existing users get the same
  // retention/regrant semantics as rule-created birthday badges. A configured
  // BIRTHDAY_TODAY rule on the same badge may explicitly opt into permanent
  // retention; when absent, the rule-type default applies.
  const wantsBirthdayToday = !options.ruleTypes?.length || options.ruleTypes.includes('BIRTHDAY_TODAY')
  if (!wantsBirthdayToday) {
    return rules
  }
  const legacyBadges = await prisma.badge.findMany({
    where: {
      slug: BIRTHDAY_BADGE_SLUG,
      isEnabled: true,
      isActive: true,
      grantType: 'AUTO',
      ...(options.badgeIds?.length ? { id: { in: [...new Set(options.badgeIds)] } } : {}),
    },
    select: {
      id: true,
      name: true,
      availableFrom: true,
      availableUntil: true,
      BadgeRule: { select: { ruleType: true, retentionPolicy: true } },
    },
  })
  for (const badge of legacyBadges) {
    const configuredRule = badge.BadgeRule?.ruleType === 'BIRTHDAY_TODAY' ? badge.BadgeRule : null
    rules.push({
      id: `legacy:${BIRTHDAY_BADGE_SLUG}`,
      badgeId: badge.id,
      ruleType: 'BIRTHDAY_TODAY',
      operator: 'GTE',
      threshold: null,
      configJson: {},
      retentionPolicy: toRetentionPolicy(configuredRule?.retentionPolicy || null),
      badgeName: badge.name,
      availableFrom: badge.availableFrom,
      availableUntil: badge.availableUntil,
      legacyBirthdaySource: true,
    })
  }
  return rules
}

/**
 * Recompute every RETAIN_WHILE_ELIGIBLE rule the user currently holds through
 * an automatic source and revoke the sources whose condition no longer holds.
 */
export async function evaluateBadgeRetentionForUser(
  userId: string,
  options: { ruleTypes?: readonly SupportedBadgeRuleType[]; badgeIds?: readonly string[]; now?: Date; reason?: string | null } = {},
): Promise<BadgeRetentionEvaluationSummary> {
  const now = options.now || new Date()
  const summary: BadgeRetentionEvaluationSummary = {
    userId,
    checked: 0,
    revoked: 0,
    stillEligible: 0,
    skipped: 0,
    failed: 0,
    failures: [],
  }
  const rules = await loadRecyclableRules(options)

  for (const rule of rules) {
    // Two independent switches: the rule type must be re-derivable from
    // durable data, and the administrator must have opted in.
    if (!supportsBadgeRetentionPolicy(rule.ruleType)) continue
    if (resolveBadgeRetentionPolicy(rule) !== 'RETAIN_WHILE_ELIGIBLE') continue

    const sourceTypes = rule.legacyBirthdaySource ? ['AUTO', 'LEGACY'] : governedSourceTypes(rule.ruleType)
    const legacySourceFilter = rule.legacyBirthdaySource ? {
      OR: [
        { sourceType: 'AUTO', sourceId: BIRTHDAY_BADGE_SLUG },
        // Rows created before source identities were introduced were
        // migrated as LEGACY with a NULL sourceId. The badge slug scopes
        // this compatibility path to the old birthday badge only.
        { sourceType: 'LEGACY', sourceId: null },
      ],
    } : {}
    const sources = await prisma.userBadgeSource.findMany({
      where: { userId, badgeId: rule.badgeId, isActive: true, sourceType: { in: [...sourceTypes] }, ...legacySourceFilter },
      select: { id: true, sourceType: true, sourceId: true },
    })
    if (!sources.length) {
      summary.skipped += 1
      continue
    }

    // A limited badge that already ended is 绝版: requirement 10.1 forbids
    // recycling it just because the window closed.
    const availability = getBadgeAvailability({ availableFrom: rule.availableFrom, availableUntil: rule.availableUntil }, now)
    if (availability === 'ENDED' || availability === 'UPCOMING') {
      summary.skipped += 1
      continue
    }

    summary.checked += 1
    try {
      const satisfied = await isBadgeRuleSatisfied(userId, rule, now)
      if (satisfied) {
        summary.stillEligible += 1
        continue
      }
      const reason = options.reason?.trim()
        || `不再满足「${BADGE_RULE_REGISTRY[rule.ruleType]?.label || rule.ruleType}」条件，已回收自动获取来源`
      for (const source of sources) {
        const result = await revokeBadgeAcquisitionSource({
          userId,
          badgeId: rule.badgeId,
          sourceType: source.sourceType,
          sourceId: source.sourceId || '',
          reason,
        })
        if (result.revoked) summary.revoked += 1
      }
    } catch (error) {
      summary.failed += 1
      if (summary.failures.length < 100) {
        summary.failures.push(`${rule.badgeId}:${error instanceof Error ? error.message : '回收失败'}`)
      }
      console.error('[badge-retention.evaluate]', { userId, badgeId: rule.badgeId, ruleType: rule.ruleType, error })
    }
  }

  return summary
}

/** Fire-and-forget variant for request paths. Never rejects. */
export function triggerBadgeRetentionEvaluation(
  userId: string,
  options: { ruleTypes?: readonly SupportedBadgeRuleType[]; badgeIds?: readonly string[]; reason?: string | null } = {},
) {
  const task = evaluateBadgeRetentionForUser(userId, options).catch((error) => {
    console.error('[badge-retention.trigger]', { userId, error })
    return { userId, checked: 0, revoked: 0, stillEligible: 0, skipped: 0, failed: 0, failures: [] } satisfies BadgeRetentionEvaluationSummary
  })
  void task
  return task
}
