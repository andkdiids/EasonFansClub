const LIVEPhoto_ID_PATTERN = /^[a-zA-Z0-9_-]{8,64}$/

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
  return LIVEPhoto_ID_PATTERN.test(id) ? id : null
}

export function isLivePhotoMarker(value: unknown): value is string {
  return livePhotoIdFromMarker(value) !== null
}
