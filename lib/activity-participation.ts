/**
 * The single qualification predicate for activity participation rewards.
 *
 * Registration alone is not attendance for activities that require check-in.
 * An activity with verificationMode NONE qualifies an active registration only
 * after its configured end time. The automatic AUTO_AFTER_ACTIVITY_END check-in
 * is deliberately excluded from MANUAL/QR activities, even though it fills the
 * same registration columns for operational cleanup.
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
  verificationMode?: string | null,
  activityStatus?: string | null,
) {
  if (!registration || registration.status !== 'ACTIVE') return false
  if (activityStatus !== undefined && activityStatus !== 'PUBLISHED') return false
  if (verificationMode === 'NONE') {
    if (!activityEndAt || Number.isNaN(activityEndAt.getTime())) return false
    return now.getTime() >= activityEndAt.getTime()
  }
  // An omitted mode preserves the historical three-argument MANUAL/QR
  // predicate used by activity lottery. Explicitly unknown/null modes cannot
  // fall back to the no-check-in NONE branch.
  if (verificationMode !== undefined && verificationMode !== 'MANUAL' && verificationMode !== 'QR') return false
  if (registration.checkInSource !== 'MANUAL' && registration.checkInSource !== 'QR') return false
  const checkedAt = registration.checkedInAt || registration.verifiedAt
  if (!checkedAt || Number.isNaN(checkedAt.getTime()) || checkedAt.getTime() > now.getTime()) return false
  return !activityEndAt || Number.isNaN(activityEndAt.getTime()) || checkedAt.getTime() < activityEndAt.getTime()
}
