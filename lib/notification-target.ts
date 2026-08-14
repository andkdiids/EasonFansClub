import { legacyLocalhostUrlToInternalPath, safeInternalPathOrNull } from '@/lib/url-safety'

export type NotificationTargetInput = {
  id: string
  source: 'personal' | 'system'
  type: string
  link: string | null
  targetUrl: string | null
}

export type NotificationReplyTarget =
  | { kind: 'post'; resourceId: string; parentId: string }
  | { kind: 'daily-message'; resourceId: string; parentId: string }
  | { kind: 'feedback'; resourceId: string; parentId: string }
  | { kind: 'profile-wall'; resourceId: string; parentId: string }

function normalizeNotificationTarget(value: unknown) {
  return safeInternalPathOrNull(value) || legacyLocalhostUrlToInternalPath(value)
}

export function parseNotificationReplyTarget(input: NotificationTargetInput): NotificationReplyTarget | null {
  const target = getNotificationTarget(input)
  if (!target?.startsWith('/')) return null
  const url = new URL(target, 'https://local.invalid')
  const focus = url.searchParams.get('focus')
  if (!focus) return null

  const post = url.pathname.match(/^\/posts\/([^/]+)$/)
  if (post) return { kind: 'post', resourceId: post[1], parentId: focus }
  if (url.pathname === '/checkin') {
    const messageId = url.searchParams.get('message')
    if (messageId) return { kind: 'daily-message', resourceId: messageId, parentId: focus }
  }
  const feedback = url.pathname.match(/^\/feedback\/([^/]+)$/)
  if (feedback) return { kind: 'feedback', resourceId: feedback[1], parentId: focus }
  const wall = url.pathname.match(/^\/user\/(\d+)\/wall$/)
  if (wall) return { kind: 'profile-wall', resourceId: wall[1], parentId: focus }
  return null
}

export function getNotificationTarget(notification: NotificationTargetInput) {
  const explicit = notification.targetUrl || notification.link
  const normalizedExplicit = normalizeNotificationTarget(explicit)
  if (normalizedExplicit) return normalizedExplicit
  if (notification.type === 'FRIEND_REQUEST' || notification.type === 'FOLLOW') return '/friends#received-requests'
  if (notification.type === 'GUESS_SONG_DUEL_INVITE') return '/games/guess-song/duel'
  if (notification.type === 'ACTIVITY') return '/activities'
  // Legacy personal moderation notifications may have been created without a
  // link. Keep them actionable with the existing user-owned sticker list.
  if (notification.source === 'personal' && notification.type === 'ADMIN') return '/profile/stickers'
  if (notification.source === 'system') return `/notifications#notification-${notification.id}`
  return null
}
