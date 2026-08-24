import { PUBLIC_COS_HOST, toStoredMediaUrl } from '@/lib/media-url'

const ACTIVITY_SOURCE_PATH = /^\/activities\/([^/]+)\/source\.webp$/i

export type ActivityImageInput = {
  provided: boolean
  valid: boolean
  value: string | null
}

/** Accept only source URLs emitted by the activity image upload endpoint. */
export function storedActivityImageUrl(value: unknown) {
  if (typeof value !== 'string' || !value.trim()) return null
  const stored = toStoredMediaUrl(value.trim())
  if (!stored) return null
  try {
    const parsed = new URL(stored)
    if (parsed.protocol !== 'https:' || parsed.hostname.toLowerCase() !== PUBLIC_COS_HOST) return null
    if (!ACTIVITY_SOURCE_PATH.test(parsed.pathname)) return null
    return `${parsed.origin}${parsed.pathname}${parsed.search}${parsed.hash}`
  } catch {
    return null
  }
}

export function parseActivityImageInput(value: unknown, existingValue?: string | null): ActivityImageInput {
  if (value === undefined) return { provided: false, valid: true, value: existingValue ?? null }
  if (value === null || value === '') return { provided: true, valid: true, value: null }
  if (existingValue && value === existingValue) return { provided: true, valid: true, value: existingValue }
  const normalized = storedActivityImageUrl(value)
  return normalized
    ? { provided: true, valid: true, value: normalized }
    : { provided: true, valid: false, value: null }
}
