import { resolveAutomaticRegrantEligibility, type AutomaticRegrantDecision, type AutomaticRegrantHistoryRecord } from '@/lib/badge-revocation'
import { resolveZodiacGrantEligibility, type ZodiacSign } from '@/lib/zodiac'

/**
 * A zodiac grant history row is intentionally scoped to one target badge.
 * Keeping the badge id on the in-memory row makes accidental cross-zodiac
 * history queries visible to the resolver instead of silently treating every
 * birthday-zodiac record owned by a user as one shared history.
 */
export type ZodiacGrantHistoryRecord = AutomaticRegrantHistoryRecord & {
  badgeId?: string | null
}

export type ZodiacBadgeGrantEligibility = {
  badgeId: string
  birthdayZodiac: ZodiacSign | null
  targetZodiac: ZodiacSign | null
  currentZodiac: ZodiacSign | null
  isBirthdayMatch: boolean
  isCurrentPeriod: boolean
  hasActiveTargetOwnership: boolean
  hasBlockedTargetHistory: boolean
  regrantDecision: AutomaticRegrantDecision
  eligible: boolean
}

/**
 * Resolve one user's eligibility for one concrete zodiac badge.
 *
 * The caller may pass a target-scoped history slice. If rows carry a badgeId,
 * the resolver defensively filters them again so a Leo row can never block a
 * Virgo decision. Rows without badgeId are treated as already target-scoped
 * for backwards compatibility with older in-memory callers.
 */
export function resolveZodiacBadgeGrantEligibility({
  badgeId,
  birthMonth,
  birthDay,
  targetZodiac,
  history = [],
  now = new Date(),
}: {
  badgeId: string
  birthMonth: number | null | undefined
  birthDay: number | null | undefined
  targetZodiac: unknown
  history?: readonly ZodiacGrantHistoryRecord[]
  now?: Date
}): ZodiacBadgeGrantEligibility {
  const targetHistory = history.filter((record) => record.badgeId == null || record.badgeId === badgeId)
  const qualification = resolveZodiacGrantEligibility({
    birthMonth,
    birthDay,
    targetZodiac,
    now,
    timezone: 'Asia/Shanghai',
  })
  const regrantDecision = resolveAutomaticRegrantEligibility(targetHistory, now)
  const hasActiveTargetOwnership = regrantDecision.reason === 'ACTIVE_OWNERSHIP'
  const hasBlockedTargetHistory = regrantDecision.reason === 'NORMAL_REVOKED'

  return {
    badgeId,
    birthdayZodiac: qualification.birthdayZodiac,
    targetZodiac: qualification.targetZodiac,
    currentZodiac: qualification.currentZodiac,
    isBirthdayMatch: qualification.birthdayMatches,
    isCurrentPeriod: qualification.currentPeriodMatches,
    hasActiveTargetOwnership,
    hasBlockedTargetHistory,
    regrantDecision,
    eligible: qualification.eligible && regrantDecision.allowed,
  }
}

/**
 * Stable zodiac grant identity. The badge id is included in the raw key in
 * addition to the service-level user+badge namespace, and the target zodiac
 * is explicit so a rule/configuration change cannot reuse another sign's key.
 */
export function zodiacGrantKey({ badgeId, ruleId, targetZodiac }: { badgeId: string; ruleId: string; targetZodiac: ZodiacSign }) {
  return `zodiac:${badgeId}:${ruleId}:${targetZodiac}`
}
