import { BadgeServiceError, grantBadge } from '@/lib/badge-service'
import { findSalonAssignableBadge } from '@/lib/salon-badges'

/**
 * One narrow adapter for the Salon shortcut. Badge ownership, idempotency,
 * audit, history and notification remain inside the canonical grant service.
 * The adapter checks the explicit catalog opt-in before entering the
 * canonical grant service. The service then repeats the classification check
 * and serializes current ownership for a race-safe duplicate guard.
 */
export async function grantSalonBadge(input: { salonId: string; userId: string; badgeId: string; adminUserId: string }) {
  const badge = await findSalonAssignableBadge(input.badgeId)
  if (!badge) throw new BadgeServiceError('BADGE_NOT_SALON_ASSIGNABLE', '该勋章未配置为可从沙龙派发或当前不可用')
  return grantBadge({
    userId: input.userId,
    badgeId: input.badgeId,
    actorId: input.adminUserId,
    sourceType: 'SALON_ADMIN_GRANT',
    sourceId: input.salonId,
    grantKey: `salon-admin:${input.salonId}:${input.badgeId}`,
    grantReason: '沙龙管理员派发',
    requireSalonAssignable: true,
    rejectIfAlreadyOwned: true,
  })
}
