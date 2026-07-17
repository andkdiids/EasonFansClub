import { publicImageUrl } from '@/lib/images'

export const MAX_CONTENT_IMAGES = 4
const imageMarker = /\n?\[\[content-image:([^\]]+)\]\]/g

export function parseContentImageUrls(value: unknown) {
  if (!Array.isArray(value)) return []
  return value.slice(0, MAX_CONTENT_IMAGES).map((item) => publicImageUrl(item)).filter((item): item is string => Boolean(item))
}

export function appendContentImages(content: string, urls: string[]) {
  return `${content}${urls.map((url) => `\n[[content-image:${url}]]`).join('')}`
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
