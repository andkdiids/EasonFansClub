/**
 * Pure post-media normalisation. This module deliberately imports nothing so
 * the mapping can be unit-tested without a bundler; the URL resolution is
 * injected by `post-media-view.ts`.
 */

/**
 * Post media a visitor may see. `VIDEO` is excluded on purpose: the public post
 * pages never rendered uploads of that type.
 *
 * Every post-facing query must use this tuple instead of hard-coding
 * `type: 'IMAGE'`. A lone `'IMAGE'` filter silently drops live photos and, since
 * a live photo's `url` is also its static cover, the page loses the image
 * completely instead of degrading to a still.
 */
export const POST_MEDIA_VISIBLE_TYPES = ['IMAGE', 'LIVE_PHOTO'] as const
export type PostMediaVisibleType = (typeof POST_MEDIA_VISIBLE_TYPES)[number]

export type PostMediaDisplayType = 'IMAGE' | 'VIDEO' | 'LIVE_PHOTO'

export type PostMediaRecordShape = {
  id: string
  type: string
  url: string
  thumbnail?: string | null
  width?: number | null
  height?: number | null
  sortOrder?: number | null
  livePhotoId?: string | null
}

export type PostMediaDisplayItem = {
  id: string
  mediaType: PostMediaDisplayType
  /** Always readable by visitors: a live photo cover is served by the guarded
   * media route, so it works as a plain image src. */
  coverUrl: string
  thumbnailUrl: string | null
  /** Present only when the dynamic clip can actually be played. */
  videoUrl: string | null
  width: number | null
  height: number | null
  sortOrder: number
}

export type PostMediaUrlResolver = {
  cover: (raw: string) => string | null
  thumbnail: (raw: string) => string | null
  video: (assetId: string) => string
}

/** Mirrors `live-photo-markers.ts`, kept here so this module stays import-free. */
const LIVE_PHOTO_ID_PATTERN = /^[a-zA-Z0-9_-]{8,64}$/
const LIVE_PHOTO_URL_PATTERN = /\/api\/media\/live-photo\/([a-zA-Z0-9_-]{8,64})\/(?:cover|video)/

export function livePhotoIdFromMediaUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const match = value.match(LIVE_PHOTO_URL_PATTERN)
  return match && LIVE_PHOTO_ID_PATTERN.test(match[1]) ? match[1] : null
}

export function livePhotoAssetIdForRecord(record: Pick<PostMediaRecordShape, 'url' | 'thumbnail' | 'livePhotoId'>) {
  return record.livePhotoId || livePhotoIdFromMediaUrl(record.url) || livePhotoIdFromMediaUrl(record.thumbnail) || null
}

/**
 * Normalise one stored row for every surface (feed, detail, profile, topic,
 * search, share card). The `url` column already holds the static cover for live
 * photos, so a still is always available even when the clip is gone.
 */
export function toPostMediaDisplayItem(
  record: PostMediaRecordShape,
  resolve: PostMediaUrlResolver,
): PostMediaDisplayItem | null {
  const mediaType: PostMediaDisplayType = record.type === 'LIVE_PHOTO'
    ? 'LIVE_PHOTO'
    : record.type === 'VIDEO'
      ? 'VIDEO'
      : 'IMAGE'
  const assetId = mediaType === 'LIVE_PHOTO' ? livePhotoAssetIdForRecord(record) : null
  const coverUrl = resolve.cover(record.url) || record.url
  if (!coverUrl) return null
  return {
    id: record.id,
    mediaType,
    coverUrl,
    thumbnailUrl: record.thumbnail ? resolve.thumbnail(record.thumbnail) : null,
    videoUrl: assetId ? resolve.video(assetId) : null,
    width: record.width ?? null,
    height: record.height ?? null,
    sortOrder: record.sortOrder ?? 0,
  }
}

/**
 * Map a post's media once, for every renderer. Order is preserved and a repeated
 * asset (legacy rows can point at the same cover twice) collapses to one slide,
 * so a live photo is never displayed twice.
 */
export function mapPostMediaRows(
  records: readonly PostMediaRecordShape[],
  resolve: PostMediaUrlResolver,
): PostMediaDisplayItem[] {
  const seen = new Set<string>()
  const items: PostMediaDisplayItem[] = []
  for (const record of records) {
    if (!POST_MEDIA_VISIBLE_TYPES.includes(record.type as PostMediaVisibleType)) continue
    const item = toPostMediaDisplayItem(record, resolve)
    if (!item) continue
    const key = item.videoUrl ? `live:${item.videoUrl}` : `image:${item.coverUrl}`
    if (seen.has(key)) continue
    seen.add(key)
    items.push(item)
  }
  return items
}
