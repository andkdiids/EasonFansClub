import type { BadgeRuleOperator, Prisma } from '@prisma/client'
import { badgeAvailabilityWhere } from '@/lib/badge-phase2'
import { evaluateBadgeMetric } from '@/lib/badge-rule-engine'
import { processBadgeGrantEffects } from '@/lib/badge-phase3'
import { grantBadge } from '@/lib/badge-service'
import { prisma } from '@/lib/prisma'
import { activeUserBadgeWhere } from '@/lib/badge-validity'

export type ConcertAttendanceFact = { concertId: string; tourId: string; createdAt: Date }

export type ConcertBadgeDefinition = {
  id: string
  code: string
  slug: string
  name: string
  musicTourId: string | null
  ruleId: string | null
  operator: BadgeRuleOperator | null
  threshold: number | null
  ruleType: 'CONCERT_ATTENDANCE_COUNT' | 'CONCERT_SHOW_ATTENDED' | 'CONCERT_TOUR_ATTENDED' | null
  targetConcertId: string | null
  targetTourId: string | null
}

export type PlannedConcertBadgeAward = {
  badge: ConcertBadgeDefinition
  sourceType: 'EVENT' | 'AUTO_RULE'
  sourceId: string
  grantReason: string
  obtainedAt: Date
}

export type ConcertBadgeEvaluationSummary = {
  attendanceCount: number
  eligible: number
  granted: number
  alreadyOwned: number
  failed: number
  failures: string[]
  awards: PlannedConcertBadgeAward[]
}

const CONCERT_BADGE_SELECT = {
  id: true,
  code: true,
  slug: true,
  name: true,
  musicTourId: true,
  BadgeRule: { select: { id: true, ruleType: true, operator: true, threshold: true, configJson: true, isEnabled: true } },
} as const

type ConcertBadgeRow = Prisma.BadgeGetPayload<{ select: typeof CONCERT_BADGE_SELECT }>

function toDefinition(badge: ConcertBadgeRow): ConcertBadgeDefinition {
  const structuredRule = badge.BadgeRule?.isEnabled && ['CONCERT_ATTENDANCE_COUNT', 'CONCERT_SHOW_ATTENDED', 'CONCERT_TOUR_ATTENDED'].includes(badge.BadgeRule.ruleType)
    ? badge.BadgeRule
    : null
  const config = structuredRule?.configJson && typeof structuredRule.configJson === 'object' && !Array.isArray(structuredRule.configJson)
    ? structuredRule.configJson as { concertId?: unknown; tourId?: unknown }
    : null
  return {
    id: badge.id,
    code: badge.code,
    slug: badge.slug,
    name: badge.name,
    musicTourId: badge.musicTourId,
    ruleId: structuredRule?.id || null,
    operator: structuredRule?.operator || null,
    threshold: structuredRule?.threshold ?? null,
    ruleType: structuredRule?.ruleType as ConcertBadgeDefinition['ruleType'] || null,
    targetConcertId: typeof config?.concertId === 'string' ? config.concertId : null,
    targetTourId: typeof config?.tourId === 'string' ? config.tourId : null,
  }
}

/** Authoritative catalog for both structured count rules and legacy tour badges. */
export async function loadConcertBadgeDefinitions(now = new Date()): Promise<ConcertBadgeDefinition[]> {
  const badges = await prisma.badge.findMany({
    where: {
      isEnabled: true,
      isActive: true,
      AND: [
        badgeAvailabilityWhere(now),
        { OR: [
          { category: 'CONCERT', musicTourId: { not: null } },
          { grantType: 'AUTO', BadgeRule: { is: { isEnabled: true, ruleType: { in: ['CONCERT_ATTENDANCE_COUNT', 'CONCERT_SHOW_ATTENDED', 'CONCERT_TOUR_ATTENDED'] } } } },
        ] },
      ],
    },
    orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
    select: CONCERT_BADGE_SELECT,
  })
  return badges.map(toDefinition)
}

/** Pure fact-state planner shared by live evaluation, tests and backfill audit. */
export function planConcertBadgeAwards({
  attendances,
  badges,
  ownedBadgeIds,
  triggerConcertId,
}: {
  attendances: readonly ConcertAttendanceFact[]
  badges: readonly ConcertBadgeDefinition[]
  ownedBadgeIds?: ReadonlySet<string>
  /** The newly recorded event. Omit for historical reconciliation/backfill. */
  triggerConcertId?: string | null
}) {
  const facts = [...attendances].sort((left, right) => left.createdAt.getTime() - right.createdAt.getTime() || left.concertId.localeCompare(right.concertId))
  const owned = ownedBadgeIds || new Set<string>()
  const triggerFact = triggerConcertId ? facts.find((fact) => fact.concertId === triggerConcertId) : undefined
  const awards: PlannedConcertBadgeAward[] = []

  for (const badge of badges) {
    if (owned.has(badge.id)) continue

    // A structured rule is authoritative whenever one exists. Legacy/event
    // badges have no BadgeRule and continue to match their MusicTour relation.
    if (badge.ruleId) {
      let achievementFact: ConcertAttendanceFact | undefined
      if (badge.ruleType === 'CONCERT_SHOW_ATTENDED') achievementFact = triggerConcertId ? (triggerFact && triggerFact.concertId === badge.targetConcertId ? triggerFact : undefined) : badge.targetConcertId ? facts.find((fact) => fact.concertId === badge.targetConcertId) : undefined
      else if (badge.ruleType === 'CONCERT_TOUR_ATTENDED') achievementFact = triggerConcertId ? (triggerFact && triggerFact.tourId === badge.targetTourId ? triggerFact : undefined) : badge.targetTourId ? facts.find((fact) => fact.tourId === badge.targetTourId) : undefined
      else {
        if (badge.threshold === null || !badge.operator || !evaluateBadgeMetric(facts.length, badge.operator, badge.threshold)) continue
        achievementFact = triggerConcertId ? triggerFact : badge.operator === 'GTE' ? facts[Math.min(facts.length - 1, Math.max(0, badge.threshold - 1))] : facts.at(-1)
      }
      if (!achievementFact) continue
      awards.push({
        badge,
        sourceType: 'AUTO_RULE',
        sourceId: achievementFact.concertId,
        grantReason: badge.ruleType === 'CONCERT_SHOW_ATTENDED'
          ? '自动达成：观看指定演唱会后获得'
          : badge.ruleType === 'CONCERT_TOUR_ATTENDED'
            ? '自动达成：观看指定巡演任意一场后获得'
            : `自动达成：累计观看 ${badge.threshold} 场演唱会后获得`,
        obtainedAt: achievementFact.createdAt,
      })
      continue
    }

    if (!badge.musicTourId) continue
    const achievementFact = facts.find((fact) => fact.tourId === badge.musicTourId)
    if (!achievementFact) continue
    awards.push({
      badge,
      sourceType: 'EVENT',
      sourceId: achievementFact.concertId,
      grantReason: '现场巡演纪念',
      obtainedAt: achievementFact.createdAt,
    })
  }

  return awards
}

/** Recalculate additive awards from the current UserMusicConcert facts. */
export async function evaluateConcertBadges(userId: string, triggerConcertId?: string | null): Promise<ConcertBadgeEvaluationSummary> {
  const [attendanceRows, badges] = await Promise.all([
    prisma.userMusicConcert.findMany({
      where: { userId },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      select: { concertId: true, createdAt: true, MusicConcert: { select: { tourId: true } } },
    }),
    loadConcertBadgeDefinitions(),
  ])
  const attendances = attendanceRows.map((row) => ({ concertId: row.concertId, tourId: row.MusicConcert.tourId, createdAt: row.createdAt }))
  const badgeIds = badges.map((badge) => badge.id)
  const ownedRows = badgeIds.length
    ? await prisma.userBadge.findMany({ where: { userId, badgeId: { in: badgeIds }, ...activeUserBadgeWhere() }, select: { badgeId: true } })
    : []
  const awards = planConcertBadgeAwards({ attendances, badges, ownedBadgeIds: new Set(ownedRows.map((row) => row.badgeId)), triggerConcertId })
  const summary: ConcertBadgeEvaluationSummary = {
    attendanceCount: attendances.length,
    eligible: awards.length,
    granted: 0,
    alreadyOwned: ownedRows.length,
    failed: 0,
    failures: [],
    awards,
  }
  const newlyGranted: Array<{ badgeId: string; recordId: string }> = []

  for (const award of awards) {
    try {
      const result = await grantBadge({
        userId,
        badgeId: award.badge.id,
        sourceType: award.sourceType,
        sourceId: award.sourceId,
        grantKey: `concert:${award.sourceType}:${award.sourceId}`,
        grantReason: award.grantReason,
        obtainedAt: award.obtainedAt,
        deferPhase3Effects: true,
      })
      if (result.created) {
        summary.granted += 1
        newlyGranted.push({ badgeId: result.badgeId, recordId: result.recordId })
      } else {
        summary.alreadyOwned += 1
      }
    } catch (error) {
      summary.failed += 1
      summary.failures.push(`${award.badge.code}:${error instanceof Error ? error.message : '发放失败'}`)
    }
  }

  if (newlyGranted.length) {
    await processBadgeGrantEffects({ userId, grants: newlyGranted }).catch((error) => {
      console.error('[concert-badge.effects]', { userId, error })
    })
  }
  return summary
}

/** Backward-compatible entry point for older callers. */
export async function checkConcertBadge(userId: string, concertId?: string): Promise<boolean> {
  try {
    return (await evaluateConcertBadges(userId, concertId)).granted > 0
  } catch (error) {
    console.error('[concert-badge.check]', { userId, error })
    return false
  }
}
