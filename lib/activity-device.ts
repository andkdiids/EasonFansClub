import { createUUID } from '@/lib/utils/uuid'

export const ACTIVITY_DEVICE_STORAGE_KEY = 'ecfc.activity.device-id.v1'

type StorageLike = Pick<Storage, 'getItem' | 'setItem'>

function validDeviceId(value: string | null) {
  return Boolean(value && /^[A-Za-z0-9._:-]{8,128}$/.test(value.trim()))
}

/**
 * Use only a first-party random identifier. This is intentionally not a
 * browser fingerprint: no canvas, font, WebGL, audio, cookie scraping, or
 * cross-site identifier is collected.
 */
export function getOrCreateActivityDeviceId(storage?: StorageLike | null) {
  const target = storage || (typeof window !== 'undefined' ? window.localStorage : null)
  if (!target) return null
  try {
    const existing = target.getItem(ACTIVITY_DEVICE_STORAGE_KEY)?.trim() || null
    if (validDeviceId(existing)) return existing
    const created = createUUID()
    target.setItem(ACTIVITY_DEVICE_STORAGE_KEY, created)
    return created
  } catch {
    return null
  }
}
