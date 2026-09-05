/**
 * Shared constraints and metadata checks for images embedded in posts/replies.
 *
 * This module intentionally has no Node-only imports so the same rules can be
 * used by the browser uploader and the multipart route. The server still
 * validates the actual image bytes with Sharp; these checks only make browser
 * and multipart diagnostics consistent.
 */

export const CONTENT_IMAGE_MAX_FILE_SIZE = 20 * 1024 * 1024
export const CONTENT_IMAGE_COMPRESSION_THRESHOLD = 5 * 1024 * 1024
export const CONTENT_IMAGE_COMPRESSION_TARGET = 4 * 1024 * 1024

export const CONTENT_IMAGE_ALLOWED_MIME_TYPES = [
  'image/jpeg',
  'image/jpg',
  'image/pjpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'image/avif',
  'image/heic',
  'image/heif',
] as const

export const CONTENT_IMAGE_ALLOWED_EXTENSIONS = [
  'jpg',
  'jpeg',
  'png',
  'webp',
  'gif',
  'avif',
  'heic',
  'heif',
] as const

export const CONTENT_IMAGE_ACCEPT = [
  ...CONTENT_IMAGE_ALLOWED_MIME_TYPES,
  ...CONTENT_IMAGE_ALLOWED_EXTENSIONS.map((extension) => `.${extension}`),
].join(',')

export type ContentImageMimeType = typeof CONTENT_IMAGE_ALLOWED_MIME_TYPES[number]
export type ContentImageExtension = typeof CONTENT_IMAGE_ALLOWED_EXTENSIONS[number]

export type ContentImageUploadErrorCode =
  | 'FILE_REQUIRED'
  | 'EMPTY_FILE'
  | 'FILE_TOO_LARGE'
  | 'UNSUPPORTED_FORMAT'
  | 'INVALID_FILE'
  | 'HEIC_CONVERSION_FAILED'
  | 'IMAGE_PROCESSING_FAILED'
  | 'NETWORK_UPLOAD_FAILED'
  | 'UPLOAD_FAILED'
  | 'UPLOAD_RESPONSE_INVALID'

export const CONTENT_IMAGE_ERROR_MESSAGES: Record<ContentImageUploadErrorCode, string> = {
  FILE_REQUIRED: '未收到图片文件',
  EMPTY_FILE: '请选择图片',
  FILE_TOO_LARGE: '图片过大，单张图片不能超过 20MB',
  UNSUPPORTED_FORMAT: '不支持该图片格式，请上传 JPG、PNG、WebP 或 HEIC 图片',
  INVALID_FILE: '图片上传异常，请重新选择图片',
  HEIC_CONVERSION_FAILED: '照片格式转换失败，请尝试重新选择或上传 JPG 图片',
  IMAGE_PROCESSING_FAILED: '图片处理失败，请重新选择图片',
  NETWORK_UPLOAD_FAILED: '图片上传失败，请检查网络后重试',
  UPLOAD_FAILED: '图片上传失败，请稍后重试',
  UPLOAD_RESPONSE_INVALID: '图片上传异常，请重新选择图片',
}

export type ContentImageFileLike = Readonly<{
  name?: unknown
  size?: unknown
  type?: unknown
}>

function normalizedString(value: unknown) {
  return typeof value === 'string' ? value.trim().toLowerCase() : ''
}

export function contentImageExtension(name: unknown) {
  const normalized = normalizedString(name).replace(/\\/g, '/')
  const lastPart = normalized.split('/').pop() || ''
  const dot = lastPart.lastIndexOf('.')
  return dot > -1 ? lastPart.slice(dot + 1) : ''
}

export function contentImageMimeType(type: unknown) {
  return normalizedString(type).split(';', 1)[0] as ContentImageMimeType | ''
}

export function isContentImageMimeType(value: unknown): value is ContentImageMimeType {
  return (CONTENT_IMAGE_ALLOWED_MIME_TYPES as readonly string[]).includes(contentImageMimeType(value))
}

export function isContentImageExtension(value: unknown): value is ContentImageExtension {
  return (CONTENT_IMAGE_ALLOWED_EXTENSIONS as readonly string[]).includes(normalizedString(value))
}

export function isContentImageHeic(file: ContentImageFileLike | null | undefined) {
  const mimeType = contentImageMimeType(file?.type)
  return mimeType === 'image/heic'
    || mimeType === 'image/heif'
    || contentImageExtension(file?.name) === 'heic'
    || contentImageExtension(file?.name) === 'heif'
}

/**
 * Return a best-effort format hint for client-side processing. It is only a
 * hint: the route uses Sharp's decoded bytes as the final authority.
 */
export function contentImageKind(file: ContentImageFileLike | null | undefined) {
  const mimeType = contentImageMimeType(file?.type)
  const extension = contentImageExtension(file?.name)
  if (mimeType === 'image/heic' || extension === 'heic') return 'heic' as const
  if (mimeType === 'image/heif' || extension === 'heif') return 'heif' as const
  if (mimeType === 'image/jpeg' || mimeType === 'image/jpg' || mimeType === 'image/pjpeg' || extension === 'jpg' || extension === 'jpeg') return 'jpeg' as const
  if (mimeType === 'image/png' || extension === 'png') return 'png' as const
  if (mimeType === 'image/webp' || extension === 'webp') return 'webp' as const
  if (mimeType === 'image/gif' || extension === 'gif') return 'gif' as const
  if (mimeType === 'image/avif' || extension === 'avif') return 'avif' as const
  return 'unknown' as const
}

export function validateContentImageFileMetadata(file: ContentImageFileLike | null | undefined) {
  if (!file) return { ok: false as const, code: 'FILE_REQUIRED' as const, message: CONTENT_IMAGE_ERROR_MESSAGES.FILE_REQUIRED }

  const size = typeof file.size === 'number' ? file.size : Number(file.size)
  if (!Number.isFinite(size) || size <= 0) {
    return { ok: false as const, code: 'EMPTY_FILE' as const, message: CONTENT_IMAGE_ERROR_MESSAGES.EMPTY_FILE }
  }
  if (size > CONTENT_IMAGE_MAX_FILE_SIZE) {
    return { ok: false as const, code: 'FILE_TOO_LARGE' as const, message: CONTENT_IMAGE_ERROR_MESSAGES.FILE_TOO_LARGE }
  }

  const extension = contentImageExtension(file.name)
  const mimeType = contentImageMimeType(file.type)
  const extensionAllowed = !extension || isContentImageExtension(extension)
  const mimeAllowed = !mimeType || isContentImageMimeType(mimeType)

  // Empty or generic MIME values are common for Android/WeChat file pickers;
  // an accepted extension is sufficient in that case. Conversely, an image
  // MIME is sufficient when a provider omits the filename extension.
  if (!extensionAllowed && !mimeAllowed) {
    return { ok: false as const, code: 'UNSUPPORTED_FORMAT' as const, message: CONTENT_IMAGE_ERROR_MESSAGES.UNSUPPORTED_FORMAT }
  }
  if (extension && !isContentImageExtension(extension) && !isContentImageMimeType(mimeType)) {
    return { ok: false as const, code: 'UNSUPPORTED_FORMAT' as const, message: CONTENT_IMAGE_ERROR_MESSAGES.UNSUPPORTED_FORMAT }
  }
  if (mimeType && !isContentImageMimeType(mimeType) && !isContentImageExtension(extension)) {
    return { ok: false as const, code: 'UNSUPPORTED_FORMAT' as const, message: CONTENT_IMAGE_ERROR_MESSAGES.UNSUPPORTED_FORMAT }
  }

  return { ok: true as const, size, kind: contentImageKind(file) }
}
