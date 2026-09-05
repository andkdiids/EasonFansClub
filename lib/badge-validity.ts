export type BadgeValidityTypeValue = 'PERMANENT' | 'DAYS'
export type UserBadgeStatusValue = 'ACTIVE' | 'EXPIRED' | 'REVOKED'

export const BADGE_VALIDITY_TYPES: readonly BadgeValidityTypeValue[] = ['PERMANENT', 'DAYS']
export const USER_BADGE_STATUSES: readonly UserBadgeStatusValue[] = ['ACTIVE', 'EXPIRED', 'REVOKED']
export const BADGE_DAY_MS = 24 * 60 * 60 * 1000

export function isBadgeValidityType(value: unknown): value is BadgeValidityTypeValue {
  return value === 'PERMANENT' || value === 'DAYS'
}

export function normalizeBadgeValidity(type: unknown, days: unknown): { validityType: BadgeValidityTypeValue; validityDays: number | null } {
  const validityType = type === 'DAYS' ? 'DAYS' : 'PERMANENT'
  if (validityType === 'PERMANENT') return { validityType, validityDays: null }
  const value = typeof days === 'number'
    ? days
    : typeof days === 'string' && /^\d+$/.test(days.trim())
      ? Number(days.trim())
      : Number.NaN
  if (!Number.isSafeInteger(value) || value <= 0) throw new RangeError('有效天数必须是正整数')
  return { validityType, validityDays: value }
}

/** Snapshot the Badge configuration at the moment the UserBadge is awarded. */
export function calculateBadgeExpiresAt(awardedAt: Date, validityType: unknown, validityDays: unknown): Date | null {
  const normalized = normalizeBadgeValidity(validityType, validityDays)
  if (normalized.validityType === 'PERMANENT') return null
  return new Date(awardedAt.getTime() + normalized.validityDays! * BADGE_DAY_MS)
}

export function isUserBadgeActive(record: { status?: string | null; expiresAt?: Date | string | null }, now = new Date()) {
  if (record.status !== 'ACTIVE') return false
  if (!record.expiresAt) return true
  const expiresAt = record.expiresAt instanceof Date ? record.expiresAt : new Date(record.expiresAt)
  return !Number.isNaN(expiresAt.getTime()) && expiresAt.getTime() > now.getTime()
}

/** Prisma-ready runtime fallback. Cron updates status, but reads must not trust a stale ACTIVE flag. */
export function activeUserBadgeWhere(now = new Date()) {
  return {
    status: 'ACTIVE' as const,
    OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
  }
}

export function remainingBadgeDays(expiresAt: Date | string | null, now = new Date()) {
  if (!expiresAt) return null
  const value = expiresAt instanceof Date ? expiresAt : new Date(expiresAt)
  const remaining = value.getTime() - now.getTime()
  return remaining > 0 ? Math.ceil(remaining / BADGE_DAY_MS) : 0
}

export function badgeValidityLabel(validityType: unknown, validityDays: unknown) {
  return validityType === 'DAYS' && Number.isSafeInteger(validityDays) && Number(validityDays) > 0
    ? `获得后 ${Number(validityDays)} 天有效`
    : '永久有效'
}
