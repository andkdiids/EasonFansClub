import type { ActivityStatusValue } from '@/lib/activity'

export const activityRegistrationStateValues = ['AVAILABLE', 'NOT_STARTED', 'CLOSED', 'FULL', 'ENDED', 'CANCELLED'] as const
export type ActivityRegistrationState = (typeof activityRegistrationStateValues)[number]

export const activityRegistrationQuestionTypeValues = ['TEXT', 'TEXTAREA', 'SINGLE_SELECT', 'MULTI_SELECT', 'NUMBER', 'PHONE', 'SELECT'] as const
export type ActivityRegistrationQuestionType = (typeof activityRegistrationQuestionTypeValues)[number]

export type ActivityRegistrationQuestionView = {
  id: string
  title: string
  type: ActivityRegistrationQuestionType
  required: boolean
  placeholder: string | null
  sortOrder: number
  options: Array<{ id: string; label: string; value: string; sortOrder: number }>
}

export type ActivityRegistrationAnswerView = {
  questionId: string
  questionTitle: string
  value: string | string[]
}

export type ActivityRegistrationView = {
  id: string
  status: 'ACTIVE' | 'CANCELLED'
  registeredAt: string
  cancelledAt: string | null
  verifiedAt: string | null
  verificationMethod: 'MANUAL' | 'QR' | null
  verificationToken: string | null
  answers: ActivityRegistrationAnswerView[]
}

type ActivityRegistrationInput = {
  status: ActivityStatusValue
  registrationStartAt?: Date | string | null
  registrationEndAt?: Date | string | null
  signupLimit?: number | null
}

function timestamp(value: Date | string | null | undefined) {
  if (!value) return null
  const result = value instanceof Date ? value.getTime() : new Date(value).getTime()
  return Number.isFinite(result) ? result : null
}

/** Registration has its own time window; activity dates do not close it. */
export function getActivityRegistrationState(
  activity: ActivityRegistrationInput,
  registrationCount: number,
  now: Date = new Date(),
): { state: ActivityRegistrationState; canRegister: boolean } {
  if (activity.status !== 'PUBLISHED') return { state: 'CANCELLED', canRegister: false }

  const nowTimestamp = now.getTime()
  // A missing registrationStartAt means that there is no registration-start
  // restriction. Publication status is checked above, but publishedAt is not
  // a hidden substitute for the registration window.
  const registrationStart = timestamp(activity.registrationStartAt)
  if (registrationStart !== null && nowTimestamp < registrationStart) return { state: 'NOT_STARTED', canRegister: false }

  const registrationEnd = timestamp(activity.registrationEndAt)
  if (registrationEnd !== null && nowTimestamp >= registrationEnd) return { state: 'CLOSED', canRegister: false }

  // Legacy signupLimit=0 historically meant unlimited. null is the canonical
  // unlimited value for new and edited activities.
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
