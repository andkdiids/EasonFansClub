import { prisma } from '@/lib/prisma'
import { hasValidActivityParticipation } from '@/lib/activity-participation'
import { getBadgeAvailability } from '@/lib/badge-phase2'
import { getBadgeOwnershipRuleConfig, matchBadgeOwnershipConfig } from '@/lib/badge-ownership-config'
import { ACTIVE_RELATION_USER_WHERE, getUserBadgeMetric } from '@/lib/badge-metrics'
import { evaluateBadgeRule } from '@/lib/badge-rule-engine'
import {
  BADGE_RULE_REGISTRY,
  BADGE_RETENTION_POLICIES,
  generateBadgeAcquisitionDescription,
  getZodiacFromRuleConfig,
  isAcquisitionOnlyBadgeRule,
  resolveBadgeRetentionPolicy,
  supportsBadgeRetentionPolicy,
  type BadgeRetentionPolicyValue,
  type SupportedBadgeRuleType,
} from '@/lib/badge-rules'
import { grantBadge, revokeBadgeAcquisitionSource } from '@/lib/badge-service'
import { activeUserBadgeWhere } from '@/lib/badge-validity'
import { BIRTHDAY_BADGE_SLUG } from '@/lib/birthday-constants'
import { resolveZodiac, ZODIAC_LABELS } from '@/lib/zodiac'
import { resolveZodiacBadgeGrantEligibility } from '@/lib/birthday-zodiac-grant'
import { getPublicUserDisplayName } from '@/lib/friend-display'

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

const REVOKE_PREVIEW_BATCH_SIZE = 200

export const BADGE_REVOKE_PREVIEW_STATUSES = ['ALL', 'PENDING_REVOKE', 'STILL_ELIGIBLE', 'RETAINED_INELIGIBLE'] as const
export type BadgeRevokePreviewStatus = typeof BADGE_REVOKE_PREVIEW_STATUSES[number]

export type BadgeRevokePreviewRow = {
  recordId: string
  user: {
    id: string
    uid: number
    username: string
    displayName: string
    avatarUrl: string | null
  }
  currentBirthday: { month: number; day: number } | null
  badge: { id: string; name: string; slug: string; iconUrl: string | null }
  rule: {
    id: string
    ruleType: SupportedBadgeRuleType
    description: string
  }
  obtainedAt: Date
  awardedAt: Date
  expiresAt: Date | null
  ruleMatches: boolean
  status: Exclude<BadgeRevokePreviewStatus, 'ALL'>
  reason: string
  retentionPolicy: BadgeRetentionPolicyValue
}

export type BadgeRevokePreviewResult = {
  generatedAt: Date
  badge: { id: string; name: string; slug: string; iconUrl: string | null }
  rule: {
    id: string
    ruleType: SupportedBadgeRuleType
    description: string
    retentionPolicy: BadgeRetentionPolicyValue
  }
  currentOwnersCount: number
  stillEligibleCount: number
  pendingRevokeCount: number
  retainedIneligibleCount: number
  rows: BadgeRevokePreviewRow[]
}

export type BadgeRevokeExecutionResult = {
  executedAt: Date
  previewCount: number
  actualRevoked: number
  skipped: number
  failed: number
  skippedReasons: Array<{ reason: string; count: number }>
  failures: Array<{ userId: string; message: string }>
  revokedUsers: Array<{ id: string; uid: number }>
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
      mode: ruleType === 'BIRTHDAY_ZODIAC' ? 'RETENTION' : 'AUTO',
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
  // representation of the acquisition-only BIRTHDAY_TODAY rule. It is kept
  // here so legacy sources remain visible to the rule engine, but it must not
  // enter post-grant retention/revocation.
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

type RevokeRuleContext = {
  rule: StoredRetentionRule
  retentionPolicy: BadgeRetentionPolicyValue
}

type ActiveBadgeOwner = {
  recordId: string
  awardedAt: Date
  obtainedAt: Date
  expiresAt: Date | null
  user: {
    id: string
    uid: number
    username: string
    nickname: string | null
    avatarUrl: string | null
    birthMonth: number | null
    birthDay: number | null
    Profile: { displayName: string | null; avatarUrl: string | null } | null
  }
  sources: Array<{ id: string; sourceType: string; sourceId: string | null }>
}

type RevokeOwnerDecision = {
  status: Exclude<BadgeRevokePreviewStatus, 'ALL'>
  ruleMatches: boolean
  reason: string
  retentionPolicy: BadgeRetentionPolicyValue
  revokeSources: Array<{ id: string; sourceType: string; sourceId: string | null }>
}

function sourcePredicate(rule: StoredRetentionRule) {
  if (rule.legacyBirthdaySource) {
    return {
      OR: [
        { sourceType: 'AUTO', sourceId: BIRTHDAY_BADGE_SLUG },
        { sourceType: 'LEGACY', sourceId: null },
      ],
    }
  }
  if (rule.ruleType === 'ACTIVITY_PARTICIPATION') {
    const activityId = readId(readConfigObject(rule.configJson)?.activityId)
    return { sourceType: 'ACTIVITY_PARTICIPATION', sourceId: activityId || '__invalid_activity_rule__' }
  }
  return { sourceType: governedSourceTypes(rule.ruleType)[0], sourceId: rule.id }
}

function sourceBelongsToRule(source: { sourceType: string; sourceId: string | null }, rule: StoredRetentionRule) {
  if (rule.legacyBirthdaySource) {
    return (source.sourceType === 'AUTO' && source.sourceId === BIRTHDAY_BADGE_SLUG)
      || (source.sourceType === 'LEGACY' && source.sourceId === null)
  }
  if (rule.ruleType === 'ACTIVITY_PARTICIPATION') {
    return source.sourceType === 'ACTIVITY_PARTICIPATION'
      && source.sourceId === readId(readConfigObject(rule.configJson)?.activityId)
  }
  return source.sourceType === governedSourceTypes(rule.ruleType)[0] && source.sourceId === rule.id
}

type ActiveBirthdayHolding = {
  id: string
  sourceType: string | null
  sourceId: string | null
}

type BirthdayAutomaticSource = {
  sourceType: string
  sourceId: string | null
}

/**
 * Birthday-zodiac source repair is still an automatic grant operation. It
 * must use the grant predicate, while BIRTHDAY_TODAY keeps its independent
 * repair behavior. Retention itself deliberately uses a different predicate
 * so a legitimate historical zodiac ownership survives a period change.
 */
export function isBirthdayAutomaticSourceRepairEligible({
  badgeId = 'birthday-zodiac-source-repair',
  ruleType,
  configJson,
  birthMonth,
  birthDay,
  now = new Date(),
}: {
  badgeId?: string
  ruleType: SupportedBadgeRuleType
  configJson: unknown
  birthMonth: number | null | undefined
  birthDay: number | null | undefined
  now?: Date
}) {
  if (ruleType !== 'BIRTHDAY_ZODIAC') return true
  const eligibility = resolveZodiacBadgeGrantEligibility({
    badgeId,
    birthMonth,
    birthDay,
    targetZodiac: getZodiacFromRuleConfig(configJson),
    now,
  })
  return eligibility.eligible
}

function isBirthdayRetentionRule(rule: StoredRetentionRule) {
  return rule.ruleType === 'BIRTHDAY_ZODIAC' || rule.ruleType === 'BIRTHDAY_TODAY'
}

/**
 * UserBadgeSource is the normal current-ownership index, but old or partially
 * migrated rows can have an active UserBadge without its source row. Only
 * infer a source when the aggregate itself carries an unambiguous automatic
 * birthday marker; manual/admin grants remain untouched.
 */
function inferBirthdayAutomaticSource(rule: StoredRetentionRule, holding: ActiveBirthdayHolding): BirthdayAutomaticSource | null {
  if (!isBirthdayRetentionRule(rule)) return null
  if (rule.legacyBirthdaySource) {
    if (holding.sourceType === 'AUTO' && (holding.sourceId === BIRTHDAY_BADGE_SLUG || holding.sourceId === null)) {
      return { sourceType: 'AUTO', sourceId: BIRTHDAY_BADGE_SLUG }
    }
    if (holding.sourceType === 'LEGACY' && holding.sourceId === null) {
      return { sourceType: 'LEGACY', sourceId: null }
    }
    return null
  }
  return holding.sourceType === 'AUTO_RULE'
    ? { sourceType: 'AUTO_RULE', sourceId: rule.id }
    : null
}

/**
 * Repair only the current-source index through the same grant primitive used
 * by the rule engine. The primitive refreshes the aggregate and keeps source
 * history/presentation semantics identical to an ordinary grant.
 */
async function repairBirthdayAutomaticSource(
  userId: string,
  rule: StoredRetentionRule,
  now: Date,
): Promise<void> {
  const birthday = rule.ruleType === 'BIRTHDAY_ZODIAC'
    ? await prisma.user.findUnique({ where: { id: userId }, select: { birthMonth: true, birthDay: true } })
    : null
  if (rule.ruleType === 'BIRTHDAY_ZODIAC' && (!birthday || !isBirthdayAutomaticSourceRepairEligible({
    badgeId: rule.badgeId,
    ruleType: rule.ruleType,
    configJson: rule.configJson,
    birthMonth: birthday.birthMonth,
    birthDay: birthday.birthDay,
    now,
  }))) return

  const holdings = await prisma.userBadge.findMany({
    where: { userId, badgeId: rule.badgeId, ...activeUserBadgeWhere(now) },
    select: { id: true, sourceType: true, sourceId: true },
  })
  const candidates = new Map<string, BirthdayAutomaticSource>()
  for (const holding of holdings) {
    const source = inferBirthdayAutomaticSource(rule, holding)
    if (source) candidates.set(`${source.sourceType}:${source.sourceId || ''}`, source)
  }
  for (const source of candidates.values()) {
    await grantBadge({
      userId,
      badgeId: rule.badgeId,
      sourceType: source.sourceType,
      sourceId: source.sourceId,
      grantReason: '生日变更后修复自动勋章来源',
      deferPhase3Effects: true,
    })
  }
}

async function loadRevokeRuleContext(badgeId: string) {
  const badge = await prisma.badge.findUnique({
    where: { id: badgeId },
    select: { id: true, name: true, slug: true, iconUrl: true, grantType: true, isEnabled: true, isActive: true },
  })
  if (!badge) throw new Error('勋章不存在')
  if (badge.grantType !== 'AUTO') throw new Error('只有系统自动授予勋章可以预览收回')
  if (!badge.isEnabled || !badge.isActive) throw new Error('勋章当前未启用，无法预览收回')

  const rules = (await loadRecyclableRules({ badgeIds: [badgeId] })).filter((rule) => rule.badgeId === badgeId)
  if (!rules.length) throw new Error('勋章没有可用于资格收回的启用自动规则')
  return {
    badge,
    contexts: rules.map<RevokeRuleContext>((rule) => ({
      rule,
      retentionPolicy: resolveBadgeRetentionPolicy(rule),
    })),
  }
}

async function loadActiveBadgeOwners(
  badgeId: string,
  contexts: readonly RevokeRuleContext[],
  now: Date,
): Promise<ActiveBadgeOwner[]> {
  const sourceWhere = {
    isActive: true,
    OR: contexts.map(({ rule }) => sourcePredicate(rule)),
  }
  const owners = new Map<string, ActiveBadgeOwner>()
  let cursor: string | undefined
  while (true) {
    const page = await prisma.userBadge.findMany({
      where: {
        badgeId,
        ...activeUserBadgeWhere(now),
        User: ACTIVE_RELATION_USER_WHERE,
        ...(cursor ? { id: { gt: cursor } } : {}),
      },
      orderBy: { id: 'asc' },
      take: REVOKE_PREVIEW_BATCH_SIZE,
      select: {
        id: true,
        awardedAt: true,
        obtainedAt: true,
        expiresAt: true,
        User: {
          select: {
            id: true,
            uid: true,
            username: true,
            nickname: true,
            avatarUrl: true,
            birthMonth: true,
            birthDay: true,
            Profile: { select: { displayName: true, avatarUrl: true } },
          },
        },
        UserBadgeSource: { where: sourceWhere, select: { id: true, sourceType: true, sourceId: true } },
      },
    })
    if (!page.length) break
    for (const row of page) {
      const normalized: ActiveBadgeOwner = {
        recordId: row.id,
        awardedAt: row.awardedAt,
        obtainedAt: row.obtainedAt,
        expiresAt: row.expiresAt,
        user: row.User,
        sources: row.UserBadgeSource,
      }
      const existing = owners.get(row.User.id)
      if (!existing) {
        owners.set(row.User.id, normalized)
      } else {
        const sourceIds = new Set(existing.sources.map((source) => source.id))
        const mergedSources = [...existing.sources, ...row.UserBadgeSource.filter((source) => !sourceIds.has(source.id))]
        if (row.awardedAt > existing.awardedAt) {
          owners.set(row.User.id, { ...normalized, sources: mergedSources })
        } else {
          existing.sources = mergedSources
        }
      }
    }
    cursor = page.at(-1)?.id
    if (page.length < REVOKE_PREVIEW_BATCH_SIZE) break
  }
  return [...owners.values()]
}

function formatBirthday(month: number | null, day: number | null) {
  return month != null && day != null ? `${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}` : null
}

function describeUnsatisfiedRule(rule: StoredRetentionRule, user: Pick<ActiveBadgeOwner['user'], 'birthMonth' | 'birthDay'>) {
  if (rule.ruleType === 'BIRTHDAY_ZODIAC') {
    const birthday = user.birthMonth != null && user.birthDay != null
      ? { month: user.birthMonth, day: user.birthDay }
      : null
    if (!birthday) return '用户未设置有效生日'
    const birthdayZodiac = birthday ? resolveZodiac(birthday.month, birthday.day) : null
    const configuredZodiac = getZodiacFromRuleConfig(rule.configJson)
    if (!birthdayZodiac) return `当前生日 ${formatBirthday(user.birthMonth, user.birthDay)} 无对应星座`
    if (!configuredZodiac) return '当前配置规则缺少有效星座'
    if (birthdayZodiac !== configuredZodiac) return `用户生日所属星座为${ZODIAC_LABELS[birthdayZodiac]}，规则要求${ZODIAC_LABELS[configuredZodiac]}`
  }
  if (rule.ruleType === 'BIRTHDAY_TODAY') return '当前生日并非今天'
  if (rule.ruleType === 'ACTIVITY_PARTICIPATION') return '用户已不满足活动参与资格'
  if (rule.ruleType === 'BADGE_OWNERSHIP') return '用户已不满足前置勋章拥有规则'
  return `当前${BADGE_RULE_REGISTRY[rule.ruleType]?.label || '规则'}资格已失效`
}

async function evaluateOwnerForRevocation(owner: ActiveBadgeOwner, contexts: readonly RevokeRuleContext[], now: Date): Promise<RevokeOwnerDecision> {
  const decisions: Array<{
    context: RevokeRuleContext
    sources: Array<{ id: string; sourceType: string; sourceId: string | null }>
    satisfied: boolean
    canRevoke: boolean
    reason: string
  }> = []
  for (const context of contexts) {
    const sources = owner.sources.filter((source) => sourceBelongsToRule(source, context.rule))
    const satisfied = await isBadgeRuleSatisfied(owner.user.id, context.rule, now)
    const availability = getBadgeAvailability({ availableFrom: context.rule.availableFrom, availableUntil: context.rule.availableUntil }, now)
    const canRevoke = !satisfied
      && sources.length > 0
      && !isAcquisitionOnlyBadgeRule(context.rule.ruleType)
      && supportsBadgeRetentionPolicy(context.rule.ruleType)
      && context.retentionPolicy === 'RETAIN_WHILE_ELIGIBLE'
      && availability !== 'ENDED'
      && availability !== 'UPCOMING'
    const reason = satisfied
      ? `仍符合「${BADGE_RULE_REGISTRY[context.rule.ruleType]?.label || context.rule.ruleType}」规则`
      : canRevoke
        ? describeUnsatisfiedRule(context.rule, owner.user)
        : sources.length === 0
          ? '当前持有记录没有可回收的自动来源，管理员或其他来源将保留'
          : !supportsBadgeRetentionPolicy(context.rule.ruleType)
            ? '该规则类型不支持按资格持续回收'
            : context.retentionPolicy !== 'RETAIN_WHILE_ELIGIBLE'
              ? `资格已失效，但当前保留策略为${context.retentionPolicy === 'PERMANENT_AFTER_GRANT' ? '永久保留' : context.retentionPolicy}`
              : availability === 'ENDED' || availability === 'UPCOMING'
                ? '限定勋章已不在可回收的有效窗口内'
                : describeUnsatisfiedRule(context.rule, owner.user)
    decisions.push({ context, sources, satisfied, canRevoke, reason })
  }

  const revokeSources = new Map<string, { id: string; sourceType: string; sourceId: string | null }>()
  for (const decision of decisions) {
    if (decision.canRevoke) for (const source of decision.sources) revokeSources.set(source.id, source)
  }
  const selected = decisions.find((decision) => decision.canRevoke)
    || decisions.find((decision) => !decision.satisfied)
    || decisions[0]
  const ruleMatches = decisions.length > 0 && decisions.every((decision) => decision.satisfied)
  if (revokeSources.size) {
    return {
      status: 'PENDING_REVOKE',
      ruleMatches,
      reason: decisions.filter((decision) => decision.canRevoke).map((decision) => decision.reason).join('；'),
      retentionPolicy: selected.context.retentionPolicy,
      revokeSources: [...revokeSources.values()],
    }
  }
  if (ruleMatches) {
    return {
      status: 'STILL_ELIGIBLE',
      ruleMatches: true,
      reason: selected.reason,
      retentionPolicy: selected.context.retentionPolicy,
      revokeSources: [],
    }
  }
  return {
    status: 'RETAINED_INELIGIBLE',
    ruleMatches: false,
    reason: selected.reason,
    retentionPolicy: selected.context.retentionPolicy,
    revokeSources: [],
  }
}

function previewRowFromOwner(
  owner: ActiveBadgeOwner,
  badge: { id: string; name: string; slug: string; iconUrl: string | null },
  context: RevokeRuleContext,
  decision: RevokeOwnerDecision,
) {
  return {
    recordId: owner.recordId,
    user: {
      id: owner.user.id,
      uid: owner.user.uid,
      username: owner.user.username,
      displayName: getPublicUserDisplayName(owner.user),
      avatarUrl: owner.user.Profile?.avatarUrl || owner.user.avatarUrl,
    },
    currentBirthday: owner.user.birthMonth != null && owner.user.birthDay != null
      ? { month: owner.user.birthMonth, day: owner.user.birthDay }
      : null,
    badge,
    rule: {
      id: context.rule.id,
      ruleType: context.rule.ruleType,
      description: generateBadgeAcquisitionDescription(context.rule.ruleType, context.rule.threshold, context.rule.configJson),
    },
    obtainedAt: owner.obtainedAt,
    awardedAt: owner.awardedAt,
    expiresAt: owner.expiresAt,
    ruleMatches: decision.ruleMatches,
    status: decision.status,
    reason: decision.reason,
    retentionPolicy: decision.retentionPolicy,
  } satisfies BadgeRevokePreviewRow
}

function normalizeRevokePreviewStatus(value: BadgeRevokePreviewStatus | undefined): BadgeRevokePreviewStatus {
  return value && BADGE_REVOKE_PREVIEW_STATUSES.includes(value) ? value : 'ALL'
}

function matchesRevokePreviewFilter(row: BadgeRevokePreviewRow, query: string, status: BadgeRevokePreviewStatus) {
  const normalizedQuery = query.trim().toLowerCase()
  const matchesQuery = !normalizedQuery || [
    row.user.displayName,
    row.user.username,
    String(row.user.uid),
    row.user.id,
    row.currentBirthday ? `${row.currentBirthday.month}-${row.currentBirthday.day}` : '',
  ].some((value) => value.toLowerCase().includes(normalizedQuery))
  return matchesQuery && (status === 'ALL' || row.status === status)
}

/**
 * Read-only preview of active badge holders whose current rule state permits
 * source revocation. It uses the same live resolver as the retention worker;
 * this function never writes a UserBadge, source, notification, or audit row.
 */
export async function previewBadgeRuleRevocations(
  badgeId: string,
  options: { now?: Date; query?: string; status?: BadgeRevokePreviewStatus } = {},
): Promise<BadgeRevokePreviewResult> {
  const now = options.now || new Date()
  const { badge, contexts } = await loadRevokeRuleContext(badgeId)
  const owners = await loadActiveBadgeOwners(badgeId, contexts, now)
  const rows: BadgeRevokePreviewRow[] = []
  let stillEligibleCount = 0
  let pendingRevokeCount = 0
  let retainedIneligibleCount = 0
  const selectedStatus = normalizeRevokePreviewStatus(options.status)
  const selectedContext = contexts[0]
  for (const owner of owners) {
    const decision = await evaluateOwnerForRevocation(owner, contexts, now)
    if (decision.status === 'STILL_ELIGIBLE') stillEligibleCount += 1
    else if (decision.status === 'PENDING_REVOKE') pendingRevokeCount += 1
    else retainedIneligibleCount += 1
    const row = previewRowFromOwner(owner, badge, selectedContext, decision)
    if (matchesRevokePreviewFilter(row, options.query || '', selectedStatus)) rows.push(row)
  }
  return {
    generatedAt: now,
    badge,
    rule: {
      id: selectedContext.rule.id,
      ruleType: selectedContext.rule.ruleType,
      description: generateBadgeAcquisitionDescription(selectedContext.rule.ruleType, selectedContext.rule.threshold, selectedContext.rule.configJson),
      retentionPolicy: selectedContext.retentionPolicy,
    },
    currentOwnersCount: owners.length,
    stillEligibleCount,
    pendingRevokeCount,
    retainedIneligibleCount,
    rows,
  }
}

function addCount(target: Map<string, number>, reason: string) {
  target.set(reason, (target.get(reason) || 0) + 1)
}

/**
 * Re-evaluate the preview cohort immediately before each source revoke. The
 * preview IDs are only a cohort hint; the current database state and policy
 * decide whether a source is actually touched.
 */
export async function executeBadgeRuleRevocations(
  badgeId: string,
  options: { now?: Date; query?: string } = {},
): Promise<BadgeRevokeExecutionResult> {
  const now = options.now || new Date()
  const initialPreview = await previewBadgeRuleRevocations(badgeId, { now, query: options.query, status: 'PENDING_REVOKE' })
  const previewUserIds = new Set(initialPreview.rows.map((row) => row.user.id))
  const { contexts } = await loadRevokeRuleContext(badgeId)
  const owners = await loadActiveBadgeOwners(badgeId, contexts, now)
  const ownersByUserId = new Map(owners.map((owner) => [owner.user.id, owner]))
  const skipCounts = new Map<string, number>()
  const failures: Array<{ userId: string; message: string }> = []
  const revokedUsers: Array<{ id: string; uid: number }> = []
  let actualRevoked = 0
  let failed = 0

  for (const userId of previewUserIds) {
    const owner = ownersByUserId.get(userId)
    if (!owner) {
      addCount(skipCounts, '勋章已被收回或当前已不再有效')
      continue
    }
    const decision = await evaluateOwnerForRevocation(owner, contexts, now)
    if (decision.status !== 'PENDING_REVOKE' || !decision.revokeSources.length) {
      addCount(skipCounts, decision.ruleMatches ? '用户重新符合规则' : decision.reason)
      continue
    }

    let revoked = false
    let userFailed = false
    for (const source of decision.revokeSources) {
      try {
        const result = await revokeBadgeAcquisitionSource({
          userId,
          badgeId,
          sourceType: source.sourceType,
          sourceId: source.sourceId || '',
          reason: `ADMIN_REVOKE_PREVIEW_EXECUTION：${decision.reason}`,
          revokeReason: 'ADMIN_REVOKED',
        })
        if (result.revoked) revoked = true
      } catch (error) {
        userFailed = true
        failures.push({ userId, message: error instanceof Error ? error.message : '收回失败' })
      }
    }
    if (revoked) {
      actualRevoked += 1
      revokedUsers.push({ id: owner.user.id, uid: owner.user.uid })
    } else if (!userFailed) {
      addCount(skipCounts, '勋章来源已被其他管理员收回')
    }
    if (userFailed) {
      failed += 1
      if (failures.length > 100) failures.splice(100)
    }
  }

  return {
    executedAt: now,
    previewCount: initialPreview.rows.length,
    actualRevoked,
    skipped: [...skipCounts.values()].reduce((total, count) => total + count, 0),
    failed,
    skippedReasons: [...skipCounts.entries()].map(([reason, count]) => ({ reason, count })),
    failures,
    revokedUsers,
  }
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
    // BIRTHDAY_TODAY is an acquisition window only; tomorrow's false result
    // is never a reason to touch an already granted ownership.
    if (isAcquisitionOnlyBadgeRule(rule.ruleType)) {
      summary.skipped += 1
      continue
    }
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
    const sourceIdFilter = !rule.legacyBirthdaySource && isBirthdayRetentionRule(rule) ? { sourceId: rule.id } : {}
    let sources = await prisma.userBadgeSource.findMany({
      where: { userId, badgeId: rule.badgeId, isActive: true, sourceType: { in: [...sourceTypes] }, ...legacySourceFilter, ...sourceIdFilter },
      select: { id: true, sourceType: true, sourceId: true },
    })
    // Reconcile from the current aggregate as well as the source index. This
    // repairs the historical partial state in which an active birthday badge
    // lost its source row, allowing the normal retention path to revoke it if
    // the newly saved birthday is no longer eligible.
    if (!sources.length && isBirthdayRetentionRule(rule)) {
      await repairBirthdayAutomaticSource(userId, rule, now)
      sources = await prisma.userBadgeSource.findMany({
        where: { userId, badgeId: rule.badgeId, isActive: true, sourceType: { in: [...sourceTypes] }, ...legacySourceFilter, ...sourceIdFilter },
        select: { id: true, sourceType: true, sourceId: true },
      })
    }
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
          revokeReason: 'SYSTEM_REVOKED',
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
