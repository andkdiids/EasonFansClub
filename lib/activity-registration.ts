import type { ActivityStatusValue } from '@/lib/activity'

export const activityRegistrationStateValues = ['AVAILABLE', 'NOT_STARTED', 'CLOSED', 'FULL', 'ENDED', 'CANCELLED'] as const
export type ActivityRegistrationState = (typeof activityRegistrationStateValues)[number]

export function activityRegistrationSuccessNotificationKey(activityId: string, userId: string) {
  return `activity-registration-success:${activityId}:${userId}`
}

type ActivityRegistrationInput = {
  status: ActivityStatusValue
  startsAt?: Date | string | null
  endsAt?: Date | string | null
  registrationStartAt?: Date | string | null
  registrationEndAt?: Date | string | null
  publishedAt?: Date | string | null
  signupLimit?: number | null
}

function timestamp(value: Date | string | null | undefined) {
  if (!value) return null
  const result = value instanceof Date ? value.getTime() : new Date(value).getTime()
  return Number.isFinite(result) ? result : null
}

/**
 * A missing limit (and legacy zero limits) means unlimited registration.
 * The publishedAt fallback keeps old published activities immediately open
 * even when their legacy row has no publishedAt value.
 */
export function getActivityRegistrationState(
  activity: ActivityRegistrationInput,
  registrationCount: number,
  now: Date = new Date(),
): { state: ActivityRegistrationState; canRegister: boolean } {
  if (activity.status !== 'PUBLISHED') return { state: 'CANCELLED', canRegister: false }

  const nowTimestamp = now.getTime()
  const activityEnd = timestamp(activity.endsAt)
  if (activityEnd !== null && nowTimestamp >= activityEnd) return { state: 'ENDED', canRegister: false }

  const registrationStart = timestamp(activity.registrationStartAt) ?? timestamp(activity.publishedAt)
  if (registrationStart !== null && nowTimestamp < registrationStart) return { state: 'NOT_STARTED', canRegister: false }

  const registrationEnd = timestamp(activity.registrationEndAt) ?? timestamp(activity.startsAt)
  if (registrationEnd !== null && nowTimestamp >= registrationEnd) return { state: 'CLOSED', canRegister: false }

  const signupLimit = typeof activity.signupLimit === 'number' ? activity.signupLimit : null
  if (signupLimit !== null && signupLimit > 0 && registrationCount >= signupLimit) return { state: 'FULL', canRegister: false }

  return { state: 'AVAILABLE', canRegister: true }
}

export function activityRegistrationStateMessage(state: ActivityRegistrationState) {
  switch (state) {
    case 'NOT_STARTED': return '报名未开始'
    case 'CLOSED': return '报名已结束'
    case 'FULL': return '报名已满'
    case 'ENDED': return '活动已结束'
    case 'CANCELLED': return '活动已取消'
    default: return '现在可以报名'
  }
}

export class ActivityRegistrationError extends Error {
  constructor(
    readonly code: Exclude<ActivityRegistrationState, 'AVAILABLE'> | 'ACTIVITY_NOT_FOUND',
    message: string,
    readonly status: number,
  ) {
    super(message)
    this.name = 'ActivityRegistrationError'
  }
}
