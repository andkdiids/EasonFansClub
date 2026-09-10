export const BADGE_REVOKE_REASONS = [
  'INCIDENT_INVALID_ZODIAC_PERIOD_GRANT',
  'NORMAL_EXPIRED',
  'ADMIN_REVOKED',
  'SYSTEM_REVOKED',
] as const

export type BadgeRevokeReason = typeof BADGE_REVOKE_REASONS[number]

export const INCIDENT_INVALID_ZODIAC_PERIOD_GRANT: BadgeRevokeReason = 'INCIDENT_INVALID_ZODIAC_PERIOD_GRANT'

export const BADGE_REVOKE_REASON_LABELS: Record<BadgeRevokeReason, string> = {
  INCIDENT_INVALID_ZODIAC_PERIOD_GRANT: '星座周期错误发放（事故撤回）',
  NORMAL_EXPIRED: '正常过期',
  ADMIN_REVOKED: '管理员撤回',
  SYSTEM_REVOKED: '系统撤回',
}

export function isBadgeRevokeReason(value: unknown): value is BadgeRevokeReason {
  return typeof value === 'string' && (BADGE_REVOKE_REASONS as readonly string[]).includes(value)
}

export function normalizeBadgeRevokeReason(value: unknown, fallback: BadgeRevokeReason): BadgeRevokeReason {
  return isBadgeRevokeReason(value) ? value : fallback
}

export type AutomaticRegrantHistorySource = {
  isActive: boolean
  sourceType?: string | null
  sourceId?: string | null
  expiresAt?: Date | null
  revokeReason?: string | null
}

export type AutomaticRegrantHistoryRecord = {
  status: string
  expiresAt?: Date | null
  sourceType?: string | null
  sourceId?: string | null
  revokeReason?: string | null
  UserBadgeSource?: readonly AutomaticRegrantHistorySource[]
}

export type AutomaticRegrantDecision = {
  allowed: boolean
  reason: 'ACTIVE_OWNERSHIP' | 'INCIDENT_REVOKED' | 'NORMAL_REVOKED' | 'NEVER_OR_EXPIRED'
  revokeReason: BadgeRevokeReason | null
}

function isActiveRecord(record: AutomaticRegrantHistoryRecord, now: Date) {
  if (record.status !== 'ACTIVE') return false
  return !record.expiresAt || record.expiresAt.getTime() > now.getTime()
}

/**
 * Automatic grants may only cross a revoked history boundary when the
 * boundary was explicitly classified as the known zodiac-period incident.
 * Unknown legacy revokes stay blocked until an administrator classifies them.
 */
export function resolveAutomaticRegrantEligibility(
  records: readonly AutomaticRegrantHistoryRecord[],
  now = new Date(),
): AutomaticRegrantDecision {
  if (records.some((record) => isActiveRecord(record, now))) {
    return { allowed: false, reason: 'ACTIVE_OWNERSHIP', revokeReason: null }
  }

  const revokeEvents: Array<{ reason: string | null; automatic: boolean }> = []
  for (const record of records) {
    const sources = record.UserBadgeSource || []
    const matchingAutomaticSource = sources.some((source) => source.sourceType === 'AUTO_RULE')
    if (record.status === 'REVOKED') {
      revokeEvents.push({
        reason: record.revokeReason || null,
        automatic: record.sourceType === 'AUTO_RULE' || matchingAutomaticSource,
      })
    }
    for (const source of sources) {
      if (!source.isActive && source.revokeReason != null) {
        revokeEvents.push({ reason: source.revokeReason, automatic: source.sourceType === 'AUTO_RULE' })
      }
    }
  }

  const blocking = revokeEvents.find((event) => event.reason !== INCIDENT_INVALID_ZODIAC_PERIOD_GRANT || !event.automatic)
  if (blocking || revokeEvents.some((event) => !event.reason)) {
    return {
      allowed: false,
      reason: 'NORMAL_REVOKED',
      revokeReason: isBadgeRevokeReason(blocking?.reason) ? blocking.reason : null,
    }
  }

  const incident = revokeEvents.find((event) => event.automatic && event.reason === INCIDENT_INVALID_ZODIAC_PERIOD_GRANT)
  if (incident) {
    return { allowed: true, reason: 'INCIDENT_REVOKED', revokeReason: INCIDENT_INVALID_ZODIAC_PERIOD_GRANT }
  }

  return { allowed: true, reason: 'NEVER_OR_EXPIRED', revokeReason: null }
}
