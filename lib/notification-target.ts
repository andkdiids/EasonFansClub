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
  if (notification.type === 'MESSAGE') return '/notifications?category=message'
  if (notification.type === 'ACTIVITY') return '/forum'
  return `/notifications?detail=${encodeURIComponent(notification.source)}:${encodeURIComponent(notification.id)}`
}
