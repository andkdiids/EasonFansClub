const LIVE_PHOTO_ID_PATTERN = /^[a-zA-Z0-9_-]{8,64}$/

/** A live photo occupies one media slot. Its marker keeps drafts and old
 * `imageUrls` payloads compatible while carrying the asset id for new clients. */
export function toLivePhotoMarker(assetId: string) {
  return `[[live-photo:${assetId}]]`
}

export function livePhotoIdFromMarker(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const match = value.trim().match(/^\[\[live-photo:([^\]]+)\]\]$/)
  if (!match) return null
  const id = match[1].trim()
  return LIVE_PHOTO_ID_PATTERN.test(id) ? id : null
}

export function isLivePhotoMarker(value: unknown): value is string {
  return livePhotoIdFromMarker(value) !== null
}

/** The asset id is also encoded in the controlled media URL, so older
 * databases that predate the livePhotoId column can still serialize posts. */
export function livePhotoIdFromUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const match = value.match(/\/api\/media\/live-photo\/([a-zA-Z0-9_-]{8,64})\/(?:cover|video)/)
  return match && LIVE_PHOTO_ID_PATTERN.test(match[1]) ? match[1] : null
}
