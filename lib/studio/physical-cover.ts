import { isPublicMediaProxyUrl } from '@/lib/media-url'
import { publicImageUrl, storedImageUrl } from '@/lib/images'

const MAX_STUDIO_PHYSICAL_COVER_URL_LENGTH = 2048

function isStoredCosUrl(value: string) {
  try {
    const hostname = new URL(value).hostname.toLowerCase()
    return hostname === 'ecfc-1306412725.cos.ap-guangzhou.myqcloud.com' || /\.cos\.[^.]+\.myqcloud\.com$/i.test(hostname)
  } catch {
    return false
  }
}

/**
 * Validate a previously uploaded media URL without allowing arbitrary remote
 * images to become public project metadata. `undefined` means the caller did
 * not request a metadata change; `null` explicitly clears the cover.
 */
export function parseStudioPhysicalCover(value: unknown): { valid: true; value?: string | null } | { valid: false } {
  if (value === undefined) return { valid: true }
  if (value === null || value === '') return { valid: true, value: null }
  if (typeof value !== 'string') return { valid: false }
  const candidate = value.trim()
  if (!candidate || candidate.length > MAX_STUDIO_PHYSICAL_COVER_URL_LENGTH || candidate.startsWith('data:') || candidate.startsWith('blob:')) return { valid: false }
  const stored = storedImageUrl(candidate)
  if (!stored || !(isPublicMediaProxyUrl(candidate) || isStoredCosUrl(stored))) return { valid: false }
  return { valid: true, value: stored }
}

export function publicStudioPhysicalCover(value?: string | null) {
  return publicImageUrl(value)
}
