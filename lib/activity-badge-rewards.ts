import { Prisma } from '@prisma/client'
import { hasValidActivityParticipation, type ActivityParticipationCheckInSnapshot } from '@/lib/activity-participation'
import { grantBadgeWithTransaction, type BadgeOperationResult } from '@/lib/badge-service'
import { prisma } from '@/lib/prisma'
import { activeUserBadgeWhere } from '@/lib/badge-validity'

export const ACTIVITY_PARTICIPATION_BADGE_SOURCE = 'ACTIVITY_PARTICIPATION'

type ActivityBadgeGrantPlan = {
  activityId: string
  activityTitle: string
  activityEndsAt: Date | null
  activityStatus: string
  activityVerificationMode: string | null
  badgeId: string
  badgeName: string
  reason: string
}

type ActivityBadgeRegistration = ActivityParticipationCheckInSnapshot & {
  id: string
  activityId: string
  userId: string
}

type ActivityBadgeGrantOutcome =
  | { eligible: false }
  | { eligible: true; result: BadgeOperationResult }

export type GrantEligibleActivityBadgesOptions = {
  activityId?: string
  registrationId?: string
  userId?: string
  badgeId?: string
  now?: Date
  batchSize?: number
}

export type GrantEligibleActivityBadgesSummary = {
  scannedActivities: number
  scannedRegistrations: number
  eligibleRegistrations: number
  granted: number
  alreadyOwned: number
  failed: number
  failures: string[]
}

export type ActivityParticipationBadgeStats = {
  eligibleCount: number
  ownedCount: number
  pendingCount: number
}

const activityParticipationRuleType = 'ACTIVITY_PARTICIPATION' as const

function activityIdFromRuleConfig(value: Prisma.JsonValue | null | undefined) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const activityId = (value as Record<string, unknown>).activityId
  return typeof activityId === 'string' && /^[A-Za-z0-9_-]{1,191}$/.test(activityId.trim()) ? activityId.trim() : null
}

function clampBatchSize(value: number | undefined) {
  return Math.min(Math.max(Number.isSafeInteger(value) ? value! : 200, 1), 500)
}

async function loadActivityBadgePlans(options: GrantEligibleActivityBadgesOptions, now: Date) {
  const [scheduledRewards, activityRules] = await Promise.all([
    prisma.activityReward.findMany({
      where: {
        type: 'BADGE',
        enabled: true,
        badgeGrantAt: { not: null, lte: now },
        ...(options.activityId ? { activityId: options.activityId } : {}),
        Activity: { status: 'PUBLISHED' },
        Badge: { isEnabled: true, isActive: true },
        ...(options.badgeId ? { badgeId: options.badgeId } : {}),
      },
      select: {
        activityId: true,
        badgeId: true,
        Activity: { select: { id: true, title: true, status: true, endsAt: true, verificationMode: true } },
        Badge: { select: { id: true, name: true } },
      },
    }),
    prisma.badgeRule.findMany({
      where: {
        ruleType: activityParticipationRuleType,
        isEnabled: true,
        ...(options.badgeId ? { badgeId: options.badgeId } : {}),
        Badge: { isEnabled: true, isActive: true, grantType: 'AUTO' },
      },
      select: {
        badgeId: true,
        configJson: true,
        Badge: { select: { id: true, name: true } },
      },
    }),
  ])

  const activityIds = new Set<string>()
  const plansByActivity = new Map<string, Map<string, ActivityBadgeGrantPlan>>()
  const addPlan = (plan: ActivityBadgeGrantPlan) => {
    activityIds.add(plan.activityId)
    const badgePlans = plansByActivity.get(plan.activityId) || new Map<string, ActivityBadgeGrantPlan>()
    if (!badgePlans.has(plan.badgeId)) badgePlans.set(plan.badgeId, plan)
    plansByActivity.set(plan.activityId, badgePlans)
  }

  for (const reward of scheduledRewards) {
    addPlan({
      activityId: reward.activityId,
      activityTitle: reward.Activity.title,
      activityEndsAt: reward.Activity.endsAt,
      activityStatus: reward.Activity.status,
      activityVerificationMode: reward.Activity.verificationMode,
      badgeId: reward.badgeId,
      badgeName: reward.Badge.name,
      reason: `参加活动「${reward.Activity.title}」后获得`,
    })
  }

  const ruleActivityIds = [...new Set(activityRules.map((rule) => activityIdFromRuleConfig(rule.configJson)).filter((id): id is string => Boolean(id)))]
  const activities = ruleActivityIds.length
    ? await prisma.activity.findMany({ where: { id: { in: ruleActivityIds }, status: 'PUBLISHED' }, select: { id: true, title: true, status: true, endsAt: true, verificationMode: true } })
    : []
  const activityById = new Map(activities.map((activity) => [activity.id, activity]))
  for (const rule of activityRules) {
    const targetActivityId = activityIdFromRuleConfig(rule.configJson)
    const activity = targetActivityId ? activityById.get(targetActivityId) : null
    if (!activity || (options.activityId && activity.id !== options.activityId)) continue
    addPlan({
      activityId: activity.id,
      activityTitle: activity.title,
      activityEndsAt: activity.endsAt,
      activityStatus: activity.status,
      activityVerificationMode: activity.verificationMode,
      badgeId: rule.badgeId,
      badgeName: rule.Badge.name,
      reason: `参加活动「${activity.title}」后获得「${rule.Badge.name}」`,
    })
  }

  return { activityIds: [...activityIds], plansByActivity }
}

async function loadValidActivityRegistrations(
  activityId: string,
  activityEndsAt: Date | null,
  activityVerificationMode: string | null | undefined,
  activityStatus: string | null | undefined,
  options: GrantEligibleActivityBadgesOptions,
  now: Date,
  batchSize: number,
) {
  // A missing/unknown mode must never become the no-check-in NONE branch.
  if (activityVerificationMode !== 'NONE' && activityVerificationMode !== 'MANUAL' && activityVerificationMode !== 'QR') return []
  if (activityVerificationMode === 'NONE' && (!activityEndsAt || !Number.isFinite(activityEndsAt.getTime()) || now < activityEndsAt)) return []
  const rows: ActivityBadgeRegistration[] = []
  let cursor: string | undefined
  while (true) {
    const where: Prisma.ActivityRegistrationWhereInput = {
      activityId,
      status: 'ACTIVE',
      ...(activityVerificationMode === 'NONE' ? {} : { checkInSource: { in: ['MANUAL', 'QR'] as const }, verifiedAt: { not: null } }),
      ...(options.registrationId ? { id: options.registrationId } : {}),
      ...(options.userId ? { userId: options.userId } : {}),
      ...(cursor ? { id: { gt: cursor } } : {}),
      User: { status: 'ACTIVE', isDeleted: false },
    }
    const page = await prisma.activityRegistration.findMany({
      where,
      orderBy: { id: 'asc' },
      take: batchSize,
      select: { id: true, activityId: true, userId: true, status: true, verifiedAt: true, checkedInAt: true, checkInSource: true },
    })
    if (!page.length) break
    rows.push(...page.filter((row) => hasValidActivityParticipation(row, activityEndsAt, now, activityVerificationMode, activityStatus)))
    cursor = page.at(-1)?.id
    if (page.length < batchSize || options.registrationId) break
  }
  return rows
}

async function grantActivityBadgeWithEligibilityRecheck(
  registration: ActivityBadgeRegistration,
  plan: ActivityBadgeGrantPlan,
  now: Date,
): Promise<ActivityBadgeGrantOutcome> {
  return prisma.$transaction(async (tx): Promise<ActivityBadgeGrantOutcome> => {
    const activityLock = await tx.$queryRaw<Array<{ id: string }>>`SELECT \`id\` FROM \`Activity\` WHERE \`id\` = ${plan.activityId} FOR UPDATE`
    if (!activityLock.length) return { eligible: false }
    const registrationLock = await tx.$queryRaw<Array<{ id: string }>>`SELECT \`id\` FROM \`ActivityRegistration\` WHERE \`id\` = ${registration.id} FOR UPDATE`
    if (!registrationLock.length) return { eligible: false }

    const activity = await tx.activity.findUnique({
      where: { id: plan.activityId },
      select: { id: true, status: true, endsAt: true, verificationMode: true },
    })
    const currentRegistration = await tx.activityRegistration.findUnique({
      where: { id: registration.id },
      select: { id: true, activityId: true, userId: true, status: true, verifiedAt: true, checkedInAt: true, checkInSource: true },
    })
    if (!activity || !currentRegistration || currentRegistration.activityId !== plan.activityId || currentRegistration.userId !== registration.userId) return { eligible: false }
    if (!hasValidActivityParticipation(currentRegistration, activity.endsAt, now, activity.verificationMode, activity.status)) return { eligible: false }

    const result = await grantBadgeWithTransaction(tx, {
      userId: currentRegistration.userId,
      badgeId: plan.badgeId,
      sourceType: ACTIVITY_PARTICIPATION_BADGE_SOURCE,
      sourceId: plan.activityId,
      grantReason: plan.reason,
      grantKey: `activity:${plan.activityId}`,
      obtainedAt: now,
      availabilityMode: 'CURRENT',
    })
    return { eligible: true, result }
  })
}

async function processActivityBadgeGrantEffects(result: BadgeOperationResult) {
  const grants = result.created
    ? [{ badgeId: result.badgeId, recordId: result.recordId }, ...(result.derivedGrants || [])]
    : (result.derivedGrants || [])
  if (!grants.length) return
  try {
    const { processBadgeGrantEffects } = await import('@/lib/badge-phase3')
    await processBadgeGrantEffects({ userId: result.userId, grants })
  } catch (error) {
    // The durable badge grant is already committed; this records the
    // presentation-effect failure without adding a new retry queue.
    console.error('[activity.badge-reward.phase3]', { userId: result.userId, badgeId: result.badgeId, error })
  }
}

/**
 * Shared activity qualification and grant path. It is used by the global
 * minute scheduler, post-check-in hooks, and overdue/startup compensation.
 * The query intentionally ignores legacy ActivityReward rows without an
 * explicit grant time; those rows keep their old immediate verification flow.
 */
export async function grantEligibleActivityBadges(options: GrantEligibleActivityBadgesOptions = {}): Promise<GrantEligibleActivityBadgesSummary> {
  const now = options.now || new Date()
  const batchSize = clampBatchSize(options.batchSize)
  const { activityIds, plansByActivity } = await loadActivityBadgePlans(options, now)
  const summary: GrantEligibleActivityBadgesSummary = { scannedActivities: activityIds.length, scannedRegistrations: 0, eligibleRegistrations: 0, granted: 0, alreadyOwned: 0, failed: 0, failures: [] }

  for (const activityId of activityIds) {
    const plans = [...(plansByActivity.get(activityId)?.values() || [])]
    if (!plans.length) continue
    const registrations = await loadValidActivityRegistrations(activityId, plans[0].activityEndsAt, plans[0].activityVerificationMode, plans[0].activityStatus, options, now, batchSize)
    summary.scannedRegistrations += registrations.length
    for (const registration of registrations) {
      let activityEligible = false
      for (const plan of plans) {
        try {
          const outcome = await grantActivityBadgeWithEligibilityRecheck(registration, plan, now)
          if (!outcome.eligible) continue
          activityEligible = true
          const result = outcome.result
          await processActivityBadgeGrantEffects(result)
          if (result.created) summary.granted += 1
          else summary.alreadyOwned += 1
        } catch (error) {
          summary.failed += 1
          if (summary.failures.length < 100) summary.failures.push(`${registration.userId}:${plan.badgeId}:${error instanceof Error ? error.message : '发放失败'}`)
          console.error('[activity.badge-reward.grant]', { activityId, registrationId: registration.id, userId: registration.userId, badgeId: plan.badgeId, error })
        }
      }
      if (activityEligible) summary.eligibleRegistrations += 1
    }
  }
  return summary
}

/** Read-only statistics for the activity rule preview. */
export async function getActivityParticipationBadgeStats(input: { badgeId: string; activityId: string; now?: Date }): Promise<ActivityParticipationBadgeStats> {
  const now = input.now || new Date()
  const activity = await prisma.activity.findUnique({ where: { id: input.activityId }, select: { id: true, status: true, endsAt: true, verificationMode: true } })
  if (!activity || activity.status !== 'PUBLISHED') return { eligibleCount: 0, ownedCount: 0, pendingCount: 0 }
  const registrations = await loadValidActivityRegistrations(input.activityId, activity.endsAt, activity.verificationMode, activity.status, {}, now, 500)
  const userIds = [...new Set(registrations.map((registration) => registration.userId))]
  if (!userIds.length) return { eligibleCount: 0, ownedCount: 0, pendingCount: 0 }
  const ownedCount = await prisma.userBadge.count({ where: { badgeId: input.badgeId, userId: { in: userIds }, ...activeUserBadgeWhere(now) } })
  return { eligibleCount: userIds.length, ownedCount, pendingCount: Math.max(0, userIds.length - ownedCount) }
}
