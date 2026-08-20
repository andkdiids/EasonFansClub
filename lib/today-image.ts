export const TODAY_IMAGE_MAX_FILE_SIZE = 10 * 1024 * 1024

export const TODAY_IMAGE_ALLOWED_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
] as const

export type TodayImageMimeType = typeof TODAY_IMAGE_ALLOWED_MIME_TYPES[number]

export function isTodayImageMimeType(value: unknown): value is TodayImageMimeType {
  return typeof value === 'string'
    && TODAY_IMAGE_ALLOWED_MIME_TYPES.includes(value.trim().toLowerCase() as TodayImageMimeType)
}

export function todayImageFileError(file: { type: string; size: number }) {
  if (!isTodayImageMimeType(file.type)) return '仅支持常见图片格式'
  if (file.size < 1) return '图片内容为空'
  if (file.size > TODAY_IMAGE_MAX_FILE_SIZE) return '图片不能超过 10MB'
  return null
}

export function todayImageFileKey(file: Pick<File, 'name' | 'size' | 'lastModified' | 'type'>) {
  return [file.name, file.size, file.lastModified, file.type].join(':')
}
