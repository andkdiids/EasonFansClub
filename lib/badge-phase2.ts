import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { activeUserBadgeWhere } from '@/lib/badge-validity'
import { parseBeijingDateTime } from '@/lib/registration-availability'
import type { BadgeProgressView } from '@/lib/badge-types'
import { getUserBadgeMetric } from '@/lib/badge-metrics'
import { BADGE_RULE_REGISTRY, type SupportedBadgeRuleType } from '@/lib/badge-rules'

export const BADGE_AVAILABILITY_STATUSES = ['PERMANENT', 'UPCOMING', 'AVAILABLE', 'ENDED'] as const
export type BadgeAvailabilityStatus = typeof BADGE_AVAILABILITY_STATUSES[number]

export type BadgeAvailabilityInput = {
  availableFrom: Date | null
  availableUntil: Date | null
}

export function getBadgeAvailability(
  badge: Pick<BadgeAvailabilityInput, 'availableFrom' | 'availableUntil'>,
  now = new Date(),
): BadgeAvailabilityStatus {
  const from = badge.availableFrom?.getTime() ?? null
  const until = badge.availableUntil?.getTime() ?? null
  const timestamp = now.getTime()
  if (from === null && until === null) return 'PERMANENT'
  if (from !== null && timestamp < from) return 'UPCOMING'
  if (until !== null && timestamp >= until) return 'ENDED'
  return 'AVAILABLE'
}

/** Availability is evaluated on the server; the browser never decides whether a grant is legal. */
export function badgeAvailabilityWhere(now = new Date()): Prisma.BadgeWhereInput {
  return {
    OR: [
      { availableFrom: null, availableUntil: null },
      { availableFrom: null, availableUntil: { gt: now } },
      { availableFrom: { lte: now }, availableUntil: null },
      { availableFrom: { lte: now }, availableUntil: { gt: now } },
    ],
  }
}

export function parseBadgeAvailabilityDate(value: unknown, label: string) {
  if (value === null || value === undefined || value === '') return { value: null as Date | null }
  const parsed = parseBeijingDateTime(value)
  if (!parsed) return { error: `${label}必须是有效的上海时间` }
  return { value: parsed }
}

export function validateBadgeAvailability(availableFrom: Date | null, availableUntil: Date | null) {
  if (availableFrom && availableUntil && availableFrom.getTime() > availableUntil.getTime()) return '限定开始时间不能晚于结束时间'
  return null
}

export function calculateBadgeProgress(currentValue: number, operator: 'GTE' | 'LTE' | 'EQ', threshold: number | null): BadgeProgressView {
  const current = Number.isFinite(currentValue) ? Math.max(0, currentValue) : 0
  const target = Math.max(1, threshold !== null && Number.isFinite(threshold) ? threshold : 1)
  if (operator !== 'GTE') return { current, target, percentage: 0, operator, progressUnsupported: true }
  return {
    current,
    target,
    percentage: Math.max(0, Math.min(100, Math.floor((current / target) * 100))),
    operator,
  }
}

export type BadgeProgressRuleInput = {
  ruleType: string
  operator: string
  threshold: number | null
  isEnabled?: boolean
}

export type BadgeProgressBadgeInput = {
  visibility: string
  grantType: string
  isEnabled: boolean
  isActive?: boolean
  availableFrom: Date | null
  availableUntil: Date | null
  BadgeRule?: BadgeProgressRuleInput | null
}

/**
 * Numeric progress is deliberately derived from the same registry used by
 * the rule engine and Task Center. Special rules and non-GTE operators do not
 * receive a fabricated 0/target progress card.
 */
export function isBadgeProgressRule(rule: BadgeProgressRuleInput | null | undefined): rule is BadgeProgressRuleInput {
  if (!rule || rule.isEnabled === false || rule.operator !== 'GTE' || rule.threshold === null) return false
  const entry = BADGE_RULE_REGISTRY[rule.ruleType as SupportedBadgeRuleType]
  return Boolean(
    entry
    && entry.threshold !== null
    && !('seriesCompletion' in entry && entry.seriesCompletion)
    && Number.isSafeInteger(rule.threshold)
    && rule.threshold >= 1,
  )
}

/**
 * One server-side gate for every live numeric progress surface. The rule
 * engine may know how to evaluate a rule, but the client-safe DTO must also
 * enforce visibility, grant mode, enabled state and current availability.
 */
export function canExposeLiveBadgeProgress(badge: BadgeProgressBadgeInput, now = new Date()) {
  return badge.visibility === 'PUBLIC'
    && badge.grantType === 'AUTO'
    && badge.isEnabled
    && badge.isActive !== false
    && ['PERMANENT', 'AVAILABLE'].includes(getBadgeAvailability(badge, now))
    && isBadgeProgressRule(badge.BadgeRule)
}

/** Build the client-safe progress view with its registry-owned unit label. */
export function calculateBadgeRuleProgress(currentValue: number, rule: BadgeProgressRuleInput): BadgeProgressView | null {
  if (!isBadgeProgressRule(rule)) return null
  const entry = BADGE_RULE_REGISTRY[rule.ruleType as SupportedBadgeRuleType]
  return {
    ...calculateBadgeProgress(currentValue, 'GTE', rule.threshold),
    unitLabel: 'unit' in entry ? entry.unit || '' : '',
  }
}

/** Load one user's current metric for a supported BadgeRule. */
export async function getUserBadgeRuleProgress(userId: string, rule: BadgeProgressRuleInput | null | undefined) {
  if (!isBadgeProgressRule(rule)) return null
  const current = await getUserBadgeMetric(userId, rule.ruleType as SupportedBadgeRuleType)
  return calculateBadgeRuleProgress(current, rule)
}

export type BadgeOwnershipStats = {
  ownerCount: number
  totalUsers: number
  rate: number
  display: string
}

export function formatBadgeOwnershipRate(ownerCount: number, totalUsers: number) {
  if (totalUsers <= 0 || ownerCount <= 0) return { rate: 0, display: '0%' }
  const rate = (ownerCount / totalUsers) * 100
  if (rate < 0.1) return { rate, display: '<0.1%' }
  return { rate, display: `${rate.toFixed(1)}%` }
}

export function makeBadgeOwnershipStats(ownerCount: number, totalUsers: number): BadgeOwnershipStats {
  const formatted = formatBadgeOwnershipRate(ownerCount, totalUsers)
  return { ownerCount, totalUsers, rate: formatted.rate, display: formatted.display }
}

/** One grouped ownership query plus one valid-user count, shared by wall and admin views. */
export async function getBadgeOwnershipStats(badgeIds: readonly string[]) {
  const ids = [...new Set(badgeIds.filter(Boolean))]
  const result = new Map<string, BadgeOwnershipStats>()
  if (!ids.length) return result

  const now = new Date()
  const [rows, totalUsers] = await Promise.all([
    prisma.userBadge.groupBy({
      by: ['badgeId'],
      where: {
        badgeId: { in: ids },
        ...activeUserBadgeWhere(now),
        User: { status: 'ACTIVE', isDeleted: false },
      },
      _count: { _all: true },
    }),
    prisma.user.count({ where: { status: 'ACTIVE', isDeleted: false } }),
  ])
  const countByBadge = new Map(rows.map((row) => [row.badgeId, row._count._all]))
  ids.forEach((badgeId) => result.set(badgeId, makeBadgeOwnershipStats(countByBadge.get(badgeId) || 0, totalUsers)))
  return result
}
