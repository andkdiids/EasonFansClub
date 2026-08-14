export type NotificationRealtimeDetail = {
  initial?: boolean
  source?: string
  type?: string
  changed?: readonly string[]
}

/**
 * Summary events update the shared badge only. The list needs a new request
 * only when the event identifies a notification-row change, or when the
 * periodic HTTP fallback is the only source of new rows.
 */
export function shouldRefreshNotificationList(detail: NotificationRealtimeDetail) {
  if (detail.initial) return false
  return detail.source === 'fallback'
    || detail.type === 'notification-changed'
    || detail.changed?.includes('notification') === true
}
