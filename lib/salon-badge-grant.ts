import { grantBadge } from '@/lib/badge-service'

/**
 * One narrow adapter for the Salon shortcut. Badge ownership, idempotency,
 * audit, history and notification remain inside the canonical grant service.
 * This function is intentionally not callable until a real Salon badge
 * classifier is available to the server route.
 */
export async function grantSalonBadge(input: { salonId: string; userId: string; badgeId: string; adminUserId: string }) {
  return grantBadge({
    userId: input.userId,
    badgeId: input.badgeId,
    actorId: input.adminUserId,
    sourceType: 'SALON_ADMIN_GRANT',
    sourceId: input.salonId,
    grantKey: `salon-admin:${input.salonId}:${input.badgeId}`,
    grantReason: '沙龙管理员派发',
  })
}
