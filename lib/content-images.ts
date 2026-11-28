import { publicImageUrl, storedImageUrl } from '@/lib/images'
import { livePhotoIdFromMarker, toLivePhotoMarker } from '@/lib/live-photo-markers'

export const MAX_CONTENT_IMAGES = 9
const contentMarker = /\n?\[\[content-image:([^\]]+)\]\]/g
const combinedMarker = /\n?\[\[(content-image|live-photo):([^\]]+)\]\]/g

export function hasTooManyContentImages(value: unknown) {
  return Array.isArray(value) && value.length > MAX_CONTENT_IMAGES
}

export function reorderContentImageUrls(urls: readonly string[], fromIndex: number, targetIndex: number) {
  if (
    fromIndex < 0
    || fromIndex >= urls.length
    || targetIndex < 0
    || targetIndex > urls.length
    || fromIndex === targetIndex
    || fromIndex + 1 === targetIndex
  ) return [...urls]

  const next = [...urls]
  const [moved] = next.splice(fromIndex, 1)
  const insertionIndex = targetIndex > fromIndex ? targetIndex - 1 : targetIndex
  next.splice(Math.max(0, Math.min(insertionIndex, next.length)), 0, moved)
  return next
}

/** Live photos use a marker in the same media slot as a normal image URL. */
export function parseContentImageUrls(value: unknown) {
  if (!Array.isArray(value)) return []
  return value.slice(0, MAX_CONTENT_IMAGES).map((item) => {
    if (typeof item !== 'string') return null
    const liveId = livePhotoIdFromMarker(item)
    return liveId ? toLivePhotoMarker(liveId) : storedImageUrl(item)
  }).filter((item): item is string => Boolean(item))
}

export function appendContentImages(content: string, urls: string[]) {
  return `${content}${urls.map((url) => {
    const liveId = livePhotoIdFromMarker(url)
    return liveId ? `\n${toLivePhotoMarker(liveId)}` : `\n[[content-image:${url}]]`
  }).join('')}`
}

/** Keep the stored marker format while preventing legacy COS URLs from crossing the public boundary. */
export function publicContentImageMarkers(content: string) {
  return content.replace(combinedMarker, (_marker, kind: string, value: string) => {
    if (kind === 'live-photo') {
      const id = livePhotoIdFromMarker(`[[live-photo:${value}]]`)
      return id ? `[[live-photo:${id}]]` : ''
    }
    const safe = publicImageUrl(value)
    return safe ? `[[content-image:${safe}]]` : ''
  })
}

export function splitContentImages(content: string) {
  const images: string[] = []
  const text = content.replace(combinedMarker, (_marker, kind: string, value: string) => {
    if (kind === 'live-photo') {
      const id = livePhotoIdFromMarker(`[[live-photo:${value}]]`)
      if (id && images.length < MAX_CONTENT_IMAGES) images.push(toLivePhotoMarker(id))
      return ''
    }
    const safe = publicImageUrl(value)
    if (safe && images.length < MAX_CONTENT_IMAGES) images.push(safe)
    return ''
  }).trim()
  return { text, images }
}

/** Retained for callers that only need ordinary content-image markers. */
export function contentImageMarkerCount(content: string) {
  return [...content.matchAll(contentMarker)].length
}
