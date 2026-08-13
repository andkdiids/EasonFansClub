import { publicImageUrl, storedImageUrl } from '@/lib/images'

export const MAX_CONTENT_IMAGES = 4
const imageMarker = /\n?\[\[content-image:([^\]]+)\]\]/g

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

export function parseContentImageUrls(value: unknown) {
  if (!Array.isArray(value)) return []
  return value.slice(0, MAX_CONTENT_IMAGES).map((item) => storedImageUrl(item)).filter((item): item is string => Boolean(item))
}

export function appendContentImages(content: string, urls: string[]) {
  return `${content}${urls.map((url) => `\n[[content-image:${url}]]`).join('')}`
}

/** Keep the stored marker format while preventing legacy COS URLs from crossing the public boundary. */
export function publicContentImageMarkers(content: string) {
  return content.replace(imageMarker, (_marker, url: string) => {
    const safe = publicImageUrl(url)
    return safe ? `[[content-image:${safe}]]` : ''
  })
}

export function splitContentImages(content: string) {
  const images: string[] = []
  const text = content.replace(imageMarker, (_marker, url: string) => {
    const safe = publicImageUrl(url)
    if (safe && images.length < MAX_CONTENT_IMAGES) images.push(safe)
    return ''
  }).trim()
  return { text, images }
}
