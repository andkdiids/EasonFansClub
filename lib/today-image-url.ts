import { PUBLIC_COS_HOST, toStoredMediaUrl } from '@/lib/media-url'

const TODAY_SOURCE_PATH = /^\/today\/([^/]+)\/([^/]+)\/source\.webp$/i

export type TodayImageInput = {
  provided: boolean
  valid: boolean
  value: string | null
}

/**
 * Only accept source images produced by /api/uploads/today-image.  The
 * database still stores the original COS URL, while browser-facing upload
 * responses may use the public media gateway URL.
 */
export function storedTodayImageUrl(value: unknown, ownerId?: string) {
  if (typeof value !== 'string' || !value.trim()) return null

  const stored = toStoredMediaUrl(value.trim())
  if (!stored) return null
  try {
    const parsed = new URL(stored)
    if (parsed.protocol !== 'https:' || parsed.hostname.toLowerCase() !== PUBLIC_COS_HOST) return null
    const match = parsed.pathname.match(TODAY_SOURCE_PATH)
    if (!match) return null
    if (ownerId && decodeURIComponent(match[1]) !== ownerId) return null
    return `${parsed.origin}${parsed.pathname}${parsed.search}${parsed.hash}`
  } catch {
    return null
  }
}

export function parseTodayImageInput(value: unknown, ownerId?: string): TodayImageInput {
  if (value === undefined) return { provided: false, valid: true, value: null }
  if (value === null || value === '') return { provided: true, valid: true, value: null }

  const normalized = storedTodayImageUrl(value, ownerId)
  return normalized
    ? { provided: true, valid: true, value: normalized }
    : { provided: true, valid: false, value: null }
}
