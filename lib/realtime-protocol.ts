import type { UnreadSummary } from '@/lib/notifications'

export const realtimeChangeValues = ['notification', 'message', 'friend-request', 'feedback'] as const
export type RealtimeChange = typeof realtimeChangeValues[number]

export type RealtimeEvent = {
  type: 'unread-summary'
  summary: UnreadSummary
  changed: RealtimeChange[]
  conversationIds?: string[]
  feedbackIds?: string[]
  requestIds?: string[]
  updatedAt: string
  initial?: boolean
} | {
  type: 'notification-changed'
  changed: RealtimeChange[]
  updatedAt: string
}

const summaryKeys: Array<keyof UnreadSummary> = [
  'notifications',
  'system',
  'replies',
  'likes',
  'feedbackReplies',
  'feedback',
  'friendRequests',
  'directMessages',
  'messages',
  'total',
]

function isUnreadSummary(value: unknown): value is UnreadSummary {
  if (!value || typeof value !== 'object') return false
  const summary = value as Record<string, unknown>
  return summaryKeys.every((key) => typeof summary[key] === 'number' && Number.isFinite(summary[key]))
}

function isChange(value: unknown): value is RealtimeChange {
  return typeof value === 'string' && (realtimeChangeValues as readonly string[]).includes(value)
}

function isStringArray(value: unknown) {
  return value === undefined || (Array.isArray(value) && value.every((item) => typeof item === 'string' && item.length <= 120))
}

export function isRealtimeEvent(value: unknown): value is RealtimeEvent {
  if (!value || typeof value !== 'object') return false
  const event = value as Record<string, unknown>
  if (typeof event.updatedAt !== 'string' || !Array.isArray(event.changed) || !event.changed.every(isChange)) return false

  if (event.type === 'notification-changed') return true
  if (event.type !== 'unread-summary' || !isUnreadSummary(event.summary)) return false
  return isStringArray(event.conversationIds) && isStringArray(event.feedbackIds) && isStringArray(event.requestIds)
}
