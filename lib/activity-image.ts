export const ACTIVITY_IMAGE_MAX_FILE_SIZE = 5 * 1024 * 1024
export const ACTIVITY_IMAGE_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const
export type ActivityImageMimeType = (typeof ACTIVITY_IMAGE_MIME_TYPES)[number]

export function isActivityImageMimeType(value: unknown): value is ActivityImageMimeType {
  return typeof value === 'string' && ACTIVITY_IMAGE_MIME_TYPES.includes(value.trim().toLowerCase() as ActivityImageMimeType)
}

export function activityImageContentType(format?: string | null) {
  if (format === 'jpeg') return 'image/jpeg'
  if (format === 'png') return 'image/png'
  return 'image/webp'
}
