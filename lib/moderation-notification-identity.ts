export const SYSTEM_REVIEW_SENDER_NAME = '私家E院'
export const SYSTEM_REVIEW_SENDER_ROLE = '系统审核通知'

export type ModerationNotificationIdentityInput = {
  type: string
  link?: string | null
  key?: string | null
}

/**
 * Match user-facing moderation results only. Administrator queue notifications
 * use REVIEW or an /admin route and must keep their existing behavior.
 */
export function isModerationResultNotification({ type, link, key }: ModerationNotificationIdentityInput) {
  if (!key) return false
  const path = (link || '').split(/[?#]/, 1)[0]
  if (type === 'ACTIVITY' && key.startsWith('topic-activity-review:')) return true
  if (type === 'SYSTEM' && key.startsWith('topic-v2-review:')) return true
  if (type !== 'ADMIN') return false
  if (/^\/admin(?:\/|$)/.test(path)) return false
  if (key.startsWith('post-review-result:')) return true
  if (key.startsWith('post-review:')) return /^\/posts\/[^/]+/.test(path) || /^post-review:[^:]+:[^:]+/.test(key)
  if (key.startsWith('salon-review:')) return true
  if (key.startsWith('sticker-pack-review:')) return true
  if (key.startsWith('studio-review:') || key.startsWith('creator-review:')) return true
  return false
}
