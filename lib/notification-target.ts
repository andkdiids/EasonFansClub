import { legacyLocalhostUrlToInternalPath, safeInternalPathOrNull } from '@/lib/url-safety'
import { buildReviewCenterUrl, parseReviewSourceType, type ReviewSourceType } from '@/lib/review-center'

export type NotificationTargetInput = {
  id: string
  source: 'personal' | 'system'
  type: string
  link: string | null
  targetUrl: string | null
  key?: string | null
}

export type NotificationReplyTarget =
  | { kind: 'post'; resourceId: string; parentId: string }
  | { kind: 'daily-message'; resourceId: string; parentId: string; date?: string }
  | { kind: 'feedback'; resourceId: string; parentId: string }
  | { kind: 'profile-wall'; resourceId: string; parentId: string }

function normalizeNotificationTarget(value: unknown) {
  return safeInternalPathOrNull(value) || legacyLocalhostUrlToInternalPath(value)
}

type ReviewNotificationRoute = {
  sourceType: ReviewSourceType
  targetId: string | null
}

const reviewNotificationKeyPrefixes: Array<{ prefix: string; sourceType: ReviewSourceType }> = [
  { prefix: 'post-review:', sourceType: 'POST' },
  { prefix: 'salon-review:', sourceType: 'SALON' },
  { prefix: 'creator-review:', sourceType: 'CREATION' },
  { prefix: 'sticker-pack-review:', sourceType: 'STICKER' },
  { prefix: 'sticker-pack-resubmit:', sourceType: 'STICKER' },
  { prefix: 'today-review:', sourceType: 'TODAY' },
  { prefix: 'concert-review:', sourceType: 'CONCERT' },
]

function targetIdFromReviewKey(key: string | null | undefined): ReviewNotificationRoute | null {
  if (!key) return null
  for (const { prefix, sourceType } of reviewNotificationKeyPrefixes) {
    if (!key.startsWith(prefix)) continue
    const remainder = key.slice(prefix.length)
    const separator = remainder.indexOf(':')
    const targetId = (separator >= 0 ? remainder.slice(0, separator) : remainder).trim()
    return { sourceType, targetId: targetId || null }
  }
  return null
}

function reviewNotificationRouteFromLink(link: string | null, key: string | null | undefined): ReviewNotificationRoute | null {
  const normalizedLink = normalizeNotificationTarget(link)
  if (!normalizedLink) return null
  const url = new URL(normalizedLink, 'https://local.invalid')
  const keyRoute = targetIdFromReviewKey(key)
  const queryTargetId = (...names: string[]) => {
    for (const name of names) {
      const value = url.searchParams.get(name)?.trim()
      if (value) return value
    }
    return null
  }
  const legacyRoute = (sourceType: ReviewSourceType, targetId: string | null, allowQueueOnly = false) => {
    if (keyRoute?.sourceType === sourceType) return keyRoute
    if (targetId) return { sourceType, targetId }
    return allowQueueOnly ? { sourceType, targetId: null } : null
  }

  if (url.pathname === '/admin/review') {
    const sourceType = parseReviewSourceType(url.searchParams.get('type'))
    return sourceType === 'ALL'
      ? null
      : { sourceType, targetId: queryTargetId('targetId', 'sourceId', 'reviewId') }
  }
  if (url.pathname === '/admin/posts/review') return legacyRoute('POST', queryTargetId('postId', 'targetId'), true)
  if (url.pathname === '/admin/salon') return legacyRoute('SALON', queryTargetId('postId', 'targetId'))
  if (url.pathname === '/admin/studio') return legacyRoute('CREATION', queryTargetId('projectId', 'targetId'))
  if (url.pathname === '/admin/stickers') return legacyRoute('STICKER', queryTargetId('packId', 'targetId'))
  if (url.pathname === '/admin/today') return legacyRoute('TODAY', queryTargetId('eventId', 'targetId'))
  if (url.pathname === '/admin/music/concerts/contributions') {
    return legacyRoute('CONCERT', queryTargetId('submission', 'targetId'))
  }
  return null
}

/**
 * Resolve both current and historical administrator review notices to the
 * unified review center. This is intentionally limited to REVIEW notices and
 * recognizable legacy administrator review targets; ordinary ADMIN notices
 * keep their original destination.
 */
export function getReviewNotificationTarget(notification: NotificationTargetInput) {
  const normalizedLink = normalizeNotificationTarget(notification.targetUrl || notification.link)
  const keyRoute = targetIdFromReviewKey(notification.key)
  const routeFromLink = reviewNotificationRouteFromLink(normalizedLink, notification.key)
  // Key-only recovery is safe for the dedicated REVIEW type. ADMIN keys are
  // also used by user-facing moderation-result notices, so an ADMIN row must
  // still carry a recognizable administrator review target before it can be
  // redirected to the review center.
  const route = routeFromLink || (notification.type === 'REVIEW' ? keyRoute : null)
  const isReviewNotification = notification.type === 'REVIEW'
  const isLegacyAdminRoute = notification.type === 'ADMIN' && Boolean(route)
  if (!isReviewNotification && !isLegacyAdminRoute) return null
  if (route) return buildReviewCenterUrl(route.sourceType, route.targetId)
  // REVIEW is reserved for the administrator queue. If an old row lost its
  // link/key, still take the administrator to the safe queue entry point.
  return isReviewNotification ? '/admin/review' : null
}

export function parseNotificationReplyTarget(input: NotificationTargetInput): NotificationReplyTarget | null {
  const target = getNotificationTarget(input)
  if (!target?.startsWith('/')) return null
  const url = new URL(target, 'https://local.invalid')
  // `focus` is the current canonical parameter. The aliases keep older or
  // hand-crafted notification links actionable without relying on a page or
  // sort position that can change over time.
  const focus = url.searchParams.get('focus')
    || url.searchParams.get('replyId')
    || url.searchParams.get('commentId')
    || url.searchParams.get('reply')
  if (!focus) return null

  const post = url.pathname.match(/^\/posts\/([^/]+)$/)
  if (post) return { kind: 'post', resourceId: post[1], parentId: focus }
  if (url.pathname === '/checkin') {
    const messageId = url.searchParams.get('message')
      || url.searchParams.get('messageId')
      || url.searchParams.get('dailyMessageId')
    if (messageId) {
      const date = url.searchParams.get('date') || undefined
      return { kind: 'daily-message', resourceId: messageId, parentId: focus, ...(date ? { date } : {}) }
    }
  }
  const feedback = url.pathname.match(/^\/feedback\/([^/]+)$/)
  if (feedback) return { kind: 'feedback', resourceId: feedback[1], parentId: focus }
  const wall = url.pathname.match(/^\/user\/(\d+)\/wall$/)
  if (wall) return { kind: 'profile-wall', resourceId: wall[1], parentId: focus }
  return null
}

export function getNotificationTarget(notification: NotificationTargetInput) {
  const explicit = notification.targetUrl || notification.link
  const reviewTarget = getReviewNotificationTarget(notification)
  if (reviewTarget) return reviewTarget
  const normalizedExplicit = normalizeNotificationTarget(explicit)
  if (normalizedExplicit) return normalizedExplicit
  if (notification.type === 'FRIEND_REQUEST' || notification.type === 'FOLLOW') return '/friends#received-requests'
  if (notification.type === 'ACTIVITY') return '/activities'
  // Legacy personal moderation notifications may have been created without a
  // link. Keep them actionable with the existing user-owned sticker list.
  if (notification.source === 'personal' && notification.type === 'ADMIN') return '/profile/stickers'
  if (notification.source === 'system') return `/notifications#notification-${notification.id}`
  return null
}
