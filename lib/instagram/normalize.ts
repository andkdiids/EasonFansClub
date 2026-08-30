import {
  InstagramProviderError,
  type InstagramMedia,
  type InstagramPost,
  type InstagramPostType,
  INSTAGRAM_POST_TYPES,
  normalizeInstagramUsername,
} from '@/lib/instagram/types'

type UnknownRecord = Record<string, unknown>

function record(value: unknown): UnknownRecord {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as UnknownRecord : {}
}

function stringOrNull(value: unknown) {
  if (typeof value !== 'string') return null
  const text = value.trim()
  return text ? text : null
}

function optionalImageUrl(value: unknown) {
  const result = stringOrNull(value)
  if (!result) return null
  if (result.startsWith('/')) return result
  try {
    const url = new URL(result)
    if (url.protocol !== 'https:' || url.username || url.password) return null
    return url.toString()
  } catch {
    return null
  }
}

function numberOrNull(value: unknown) {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim() && Number.isFinite(Number(value))) return Number(value)
  return null
}

function requiredString(value: unknown, field: string) {
  const result = stringOrNull(value)
  if (!result) throw new InstagramProviderError('INVALID_DATA', `Instagram 数据缺少 ${field}`)
  return result
}

function safeExternalId(value: unknown) {
  const result = requiredString(value, 'externalId')
  if (!/^[a-zA-Z0-9._:-]{1,191}$/.test(result)) throw new InstagramProviderError('INVALID_DATA', 'Instagram externalId 格式无效')
  return result
}

function safeInstagramPermalink(value: unknown) {
  const result = stringOrNull(value)
  if (!result) return null
  try {
    const url = new URL(result)
    const hostname = url.hostname.toLowerCase()
    if (url.protocol !== 'https:' || (hostname !== 'instagram.com' && !hostname.endsWith('.instagram.com')) || url.username || url.password) return null
    return url.toString()
  } catch {
    return null
  }
}

function parsePublishedAt(value: unknown) {
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(String(value || ''))
  if (!Number.isFinite(date.getTime())) throw new InstagramProviderError('INVALID_DATA', 'Instagram 数据发布时间无效')
  return date
}

function normalizeMedia(value: unknown, index: number): InstagramMedia {
  const item = record(value)
  const sourceUrl = requiredString(item.sourceUrl ?? item.url, `media[${index}].sourceUrl`)
  const rawType = stringOrNull(item.type)?.toUpperCase()
  const type = rawType === 'VIDEO' ? 'VIDEO' : rawType === 'IMAGE' ? 'IMAGE' : null
  if (!type) throw new InstagramProviderError('INVALID_DATA', `Instagram media[${index}] 类型无效`)

  return {
    type,
    sourceUrl,
    thumbnailUrl: stringOrNull(item.thumbnailUrl ?? item.thumbnail),
    width: numberOrNull(item.width),
    height: numberOrNull(item.height),
    duration: numberOrNull(item.duration ?? item.durationSeconds),
    sortOrder: numberOrNull(item.sortOrder) ?? index,
  }
}

export function normalizeInstagramPost(value: unknown): InstagramPost {
  const item = record(value)
  const rawType = stringOrNull(item.mediaType ?? item.type)?.toUpperCase() || 'IMAGE'
  if (!(INSTAGRAM_POST_TYPES as readonly string[]).includes(rawType)) {
    throw new InstagramProviderError('INVALID_DATA', 'Instagram 帖子类型无效')
  }

  const mediaValue = Array.isArray(item.media) ? item.media : []
  if (!mediaValue.length) throw new InstagramProviderError('INVALID_DATA', 'Instagram 帖子没有媒体项')
  const media = mediaValue
    .map((entry, index) => ({ media: normalizeMedia(entry, index), inputOrder: index }))
    .sort((a, b) => a.media.sortOrder - b.media.sortOrder || a.inputOrder - b.inputOrder)
    .map(({ media }) => media)
    .map((entry, index) => ({ ...entry, sortOrder: index }))

  const normalized: InstagramPost = {
    externalId: safeExternalId(item.externalId ?? item.id),
    shortcode: stringOrNull(item.shortcode),
    username: normalizeInstagramUsername(requiredString(item.username ?? item.ownerUsername, 'username')),
    authorAvatarUrl: optionalImageUrl(
      item.authorAvatarUrl
      ?? item.ownerAvatarUrl
      ?? item.ownerProfilePicUrl
      ?? item.ownerProfilePicUrlHD
      ?? item.profilePicUrlHD
      ?? item.profilePicUrl
      ?? item.profileImageUrl
      ?? item.avatarUrl,
    ),
    caption: stringOrNull(item.caption),
    publishedAt: parsePublishedAt(item.publishedAt ?? item.timestamp ?? item.takenAt),
    permalink: safeInstagramPermalink(item.permalink ?? item.url),
    mediaType: rawType as InstagramPostType,
    media,
  }

  if (normalized.mediaType === 'CAROUSEL' && normalized.media.length < 2) {
    throw new InstagramProviderError('INVALID_DATA', '轮播帖子媒体项不足')
  }
  return normalized
}

export function sortInstagramPostsByPublishedAtDesc(posts: readonly InstagramPost[]) {
  return [...posts].sort((a, b) => b.publishedAt.getTime() - a.publishedAt.getTime() || b.externalId.localeCompare(a.externalId))
}

/** De-duplicate by provider identity before sorting, so pinned cards cannot displace newer posts. */
export function dedupeAndSortInstagramPosts(posts: readonly InstagramPost[], limit = 3) {
  const byExternalId = new Map<string, InstagramPost>()
  for (const post of posts) {
    const current = byExternalId.get(post.externalId)
    if (!current || post.publishedAt > current.publishedAt) byExternalId.set(post.externalId, post)
  }
  return sortInstagramPostsByPublishedAtDesc([...byExternalId.values()]).slice(0, Math.max(1, Math.floor(limit)))
}
