import { Prisma } from '@prisma/client'
import { hasValidActivityParticipation, type ActivityParticipationCheckInSnapshot } from '@/lib/activity-participation'
import { grantBadge } from '@/lib/badge-service'
import { prisma } from '@/lib/prisma'

export const ACTIVITY_PARTICIPATION_BADGE_SOURCE = 'ACTIVITY_PARTICIPATION'

type ActivityBadgeGrantPlan = {
  activityId: string
  activityTitle: string
  activityEndsAt: Date | null
  badgeId: string
  badgeName: string
  reason: string
}

type ActivityBadgeRegistration = ActivityParticipationCheckInSnapshot & {
  id: string
  activityId: string
  userId: string
}

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
        Activity: { select: { id: true, title: true, endsAt: true } },
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
      badgeId: reward.badgeId,
      badgeName: reward.Badge.name,
      reason: `参加活动「${reward.Activity.title}」后获得`,
    })
  }

  const ruleActivityIds = [...new Set(activityRules.map((rule) => activityIdFromRuleConfig(rule.configJson)).filter((id): id is string => Boolean(id)))]
  const activities = ruleActivityIds.length
    ? await prisma.activity.findMany({ where: { id: { in: ruleActivityIds }, status: 'PUBLISHED' }, select: { id: true, title: true, endsAt: true } })
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
  options: GrantEligibleActivityBadgesOptions,
  now: Date,
  batchSize: number,
) {
  const rows: ActivityBadgeRegistration[] = []
  let cursor: string | undefined
  while (true) {
    const page = await prisma.activityRegistration.findMany({
      where: {
        activityId,
        status: 'ACTIVE',
        checkInSource: { in: ['MANUAL', 'QR'] },
        verifiedAt: { not: null },
        ...(options.registrationId ? { id: options.registrationId } : {}),
        ...(options.userId ? { userId: options.userId } : {}),
        ...(cursor ? { id: { gt: cursor } } : {}),
        User: { status: 'ACTIVE', isDeleted: false },
      },
      orderBy: { id: 'asc' },
      take: batchSize,
      select: { id: true, activityId: true, userId: true, status: true, verifiedAt: true, checkedInAt: true, checkInSource: true },
    })
    if (!page.length) break
    rows.push(...page.filter((row) => hasValidActivityParticipation(row, activityEndsAt, now)))
    cursor = page.at(-1)?.id
    if (page.length < batchSize || options.registrationId) break
  }
  return rows
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
    const registrations = await loadValidActivityRegistrations(activityId, plans[0].activityEndsAt, options, now, batchSize)
    summary.scannedRegistrations += registrations.length
    summary.eligibleRegistrations += registrations.length
    for (const registration of registrations) {
      for (const plan of plans) {
        try {
          const result = await grantBadge({
            userId: registration.userId,
            badgeId: plan.badgeId,
            sourceType: ACTIVITY_PARTICIPATION_BADGE_SOURCE,
            sourceId: activityId,
            grantReason: plan.reason,
            obtainedAt: now,
            availabilityMode: 'CURRENT',
          })
          if (result.created) summary.granted += 1
          else summary.alreadyOwned += 1
        } catch (error) {
          summary.failed += 1
          if (summary.failures.length < 100) summary.failures.push(`${registration.userId}:${plan.badgeId}:${error instanceof Error ? error.message : '发放失败'}`)
          console.error('[activity.badge-reward.grant]', { activityId, registrationId: registration.id, userId: registration.userId, badgeId: plan.badgeId, error })
        }
      }
    }
  }
  return summary
}

/** Read-only statistics for the activity rule preview. */
export async function getActivityParticipationBadgeStats(input: { badgeId: string; activityId: string; now?: Date }): Promise<ActivityParticipationBadgeStats> {
  const now = input.now || new Date()
  const activity = await prisma.activity.findUnique({ where: { id: input.activityId }, select: { id: true, status: true, endsAt: true } })
  if (!activity || activity.status !== 'PUBLISHED') return { eligibleCount: 0, ownedCount: 0, pendingCount: 0 }
  const registrations = await loadValidActivityRegistrations(input.activityId, activity.endsAt, {}, now, 500)
  const userIds = [...new Set(registrations.map((registration) => registration.userId))]
  if (!userIds.length) return { eligibleCount: 0, ownedCount: 0, pendingCount: 0 }
  const ownedCount = await prisma.userBadge.count({ where: { badgeId: input.badgeId, userId: { in: userIds } } })
  return { eligibleCount: userIds.length, ownedCount, pendingCount: Math.max(0, userIds.length - ownedCount) }
}
