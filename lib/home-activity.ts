import { getActivityDisplayStatus, type ActivityStatusValue } from '@/lib/activity'
import { getActivityRegistrationState } from '@/lib/activity-registration-shared'

export type HomeActivitySchedule = {
  status: ActivityStatusValue
  startsAt: Date | string | null | undefined
  endsAt: Date | string | null | undefined
  registrationStartAt: Date | string | null | undefined
  registrationEndAt: Date | string | null | undefined
  signupLimit: number | null | undefined
  signupCount: number
}

export type HomeActivityStatusLabel = '进行中' | '报名中' | '报名已截止' | '报名已满'

function timestamp(value: Date | string | null | undefined) {
  if (!value) return null
  const result = value instanceof Date ? value.getTime() : new Date(value).getTime()
  return Number.isFinite(result) ? result : null
}

/**
 * The homepage combines the activity timeline with the existing registration
 * window. The registration helper remains the source of truth for CLOSED and
 * FULL; this function only chooses the compact label shown on the card.
 */
export function getHomeActivityStatusLabel(activity: HomeActivitySchedule, now: Date = new Date()): HomeActivityStatusLabel {
  const registration = getActivityRegistrationState(activity, activity.signupCount, now)
  if (registration.state === 'CLOSED') return '报名已截止'

  const activityStatus = getActivityDisplayStatus(activity, now)
  if (activityStatus === 'ONGOING') return '进行中'
  if (registration.state === 'FULL') return '报名已满'
  return '报名中'
}

function homeActivityPriority(activity: HomeActivitySchedule, now: Date) {
  return getActivityDisplayStatus(activity, now) === 'ONGOING' ? 0 : 1
}

/**
 * Sort only the bounded homepage candidate set: ongoing activities first,
 * then upcoming activities by activity start time, with a stable id tie-break.
 */
export function sortHomeActivities<T extends HomeActivitySchedule & { id: string }>(items: readonly T[], now: Date = new Date()) {
  return [...items].sort((left, right) => {
    const priorityDifference = homeActivityPriority(left, now) - homeActivityPriority(right, now)
    if (priorityDifference) return priorityDifference

    const startDifference = (timestamp(left.startsAt) ?? Number.MAX_SAFE_INTEGER) - (timestamp(right.startsAt) ?? Number.MAX_SAFE_INTEGER)
    if (startDifference) return startDifference
    return left.id.localeCompare(right.id)
  })
}
