export const MANUAL_POST_MAX_MEDIA = 10
export const MANUAL_POST_MAX_VIDEO_BYTES = 50 * 1024 * 1024
export const MANUAL_POST_DEFAULT_IMAGE_MAX_BYTES = 20 * 1024 * 1024
export const MANUAL_POST_ABSOLUTE_IMAGE_MAX_BYTES = 100 * 1024 * 1024
export const MANUAL_POST_UPLOAD_TTL_SECONDS = 2 * 60 * 60

export type ManualPostMediaKind = 'IMAGE' | 'VIDEO'

export function manualPostImageLimitBytes(configuredValue?: string) {
  const configuredMb = Number(configuredValue)
  const mb = Number.isFinite(configuredMb) && configuredMb > 0
    ? Math.min(configuredMb, MANUAL_POST_ABSOLUTE_IMAGE_MAX_BYTES / (1024 * 1024))
    : MANUAL_POST_DEFAULT_IMAGE_MAX_BYTES / (1024 * 1024)
  return Math.floor(mb * 1024 * 1024)
}

export function isManualPostImageMimeType(value: string) {
  return ['image/jpeg', 'image/png', 'image/webp'].includes(value.trim().toLowerCase())
}
