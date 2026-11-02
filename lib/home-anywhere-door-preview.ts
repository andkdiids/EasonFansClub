import type { SocialPostMediaView } from '@/lib/social-posts'

export const HOME_ANYWHERE_DOOR_MEDIA_PREVIEW_LIMIT = 4

export function buildHomeAnywhereDoorMediaPreview(
  media: readonly SocialPostMediaView[],
  totalMediaCount = media.length,
) {
  const ordered = [...media].sort((left, right) => left.sortOrder - right.sortOrder)
  const items = ordered.slice(0, HOME_ANYWHERE_DOOR_MEDIA_PREVIEW_LIMIT)
  const knownTotal = Math.max(totalMediaCount, ordered.length)
  return { items, overflowCount: Math.max(0, knownTotal - items.length) }
}
