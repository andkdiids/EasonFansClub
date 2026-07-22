export type NotificationTargetInput = {
  id: string
  source: 'personal' | 'system'
  type: string
  link: string | null
  targetUrl: string | null
}

export function getNotificationTarget(notification: NotificationTargetInput) {
  const explicit = notification.targetUrl || notification.link
  if (explicit?.startsWith('/')) return explicit
  if (notification.type === 'FRIEND_REQUEST' || notification.type === 'FOLLOW') return '/friends#received-requests'
  if (notification.type === 'ACTIVITY') return '/activities'
  if (notification.source === 'system') return `/notifications#notification-${notification.id}`
  return null
}
