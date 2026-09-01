/**
 * The single qualification predicate for activity participation rewards.
 *
 * Registration alone is not attendance. Only an active registration with a
 * real manual or QR check-in before the activity ends qualifies. The automatic
 * AUTO_AFTER_ACTIVITY_END check-in is deliberately excluded, even though it fills the same
 * registration columns for operational cleanup.
 */
export type ActivityParticipationCheckInSnapshot = {
  status: string
  verifiedAt: Date | null
  checkedInAt: Date | null
  checkInSource: string | null
}

export function hasValidActivityParticipation(
  registration: ActivityParticipationCheckInSnapshot | null | undefined,
  activityEndAt: Date | null | undefined,
  now = new Date(),
) {
  if (!registration || registration.status !== 'ACTIVE') return false
  if (registration.checkInSource !== 'MANUAL' && registration.checkInSource !== 'QR') return false
  const checkedAt = registration.checkedInAt || registration.verifiedAt
  if (!checkedAt || Number.isNaN(checkedAt.getTime()) || checkedAt.getTime() > now.getTime()) return false
  return !activityEndAt || Number.isNaN(activityEndAt.getTime()) || checkedAt.getTime() < activityEndAt.getTime()
}
