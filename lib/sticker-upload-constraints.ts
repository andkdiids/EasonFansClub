export const STICKER_MAX_FILE_SIZE = 20 * 1024 * 1024

export const STICKER_FILE_TOO_LARGE_MESSAGE = '文件超过20MB限制'
export const STICKER_UNSUPPORTED_FORMAT_MESSAGE = '暂不支持该图片格式'
export const STICKER_IMAGE_UNSUPPORTED_FORMAT_MESSAGE = '暂不支持该表情图片格式'
export const STICKER_FILE_UNRECOGNIZED_MESSAGE = '无法识别这张图片，请重新选择'
export const STICKER_COVER_UNSUPPORTED_FORMAT_MESSAGE = '封面仅支持静态 JPG、PNG 或 WebP 图片'
export const STICKER_COVER_ANIMATED_MESSAGE = '封面不能使用动态图片，请上传静态 JPG、PNG 或 WebP'
export const STICKER_UPLOAD_FAILED_MESSAGE = '上传失败，请稍后重试'

export const STATIC_IMAGE_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
] as const

export const STATIC_IMAGE_EXTENSIONS = ['jpg', 'jpeg', 'png', 'webp'] as const

export const STICKER_UPLOAD_MIME_TYPES = [
  ...STATIC_IMAGE_MIME_TYPES,
  'image/apng',
  'image/gif',
] as const

export const STICKER_UPLOAD_EXTENSIONS = ['jpg', 'jpeg', 'png', 'apng', 'webp', 'gif'] as const

export const STATIC_IMAGE_ACCEPT = [
  ...STATIC_IMAGE_EXTENSIONS.map((extension) => '.' + extension),
  ...STATIC_IMAGE_MIME_TYPES,
  'image/jpg',
].join(',')

export const STICKER_UPLOAD_ACCEPT = [
  ...STICKER_UPLOAD_EXTENSIONS.map((extension) => '.' + extension),
  ...STICKER_UPLOAD_MIME_TYPES,
  'image/jpg',
].join(',')

type ImageFileLike = {
  name?: string | null
  type?: string | null
}

function normalizedMimeValue(value: string | null | undefined) {
  const mime = String(value || '').trim().toLowerCase()
  return mime === 'image/jpg' ? 'image/jpeg' : mime
}

function fileExtension(name: string | null | undefined) {
  return String(name || '').trim().toLowerCase().split('.').pop() || ''
}

function mimeFromExtension(extension: string) {
  if (extension === 'jpg' || extension === 'jpeg') return 'image/jpeg'
  if (extension === 'png') return 'image/png'
  if (extension === 'webp') return 'image/webp'
  if (extension === 'apng') return 'image/apng'
  if (extension === 'gif') return 'image/gif'
  return null
}

/**
 * Normalize a static image candidate without trusting an empty browser MIME.
 * A non-empty, unknown MIME remains rejected; the extension fallback is only
 * used for empty MIME values and application/octet-stream uploads.
 */
export function normalizeImageMime(file: ImageFileLike): (typeof STATIC_IMAGE_MIME_TYPES)[number] | null {
  const mime = normalizedMimeValue(file.type)
  if ((STATIC_IMAGE_MIME_TYPES as readonly string[]).includes(mime)) {
    return mime as (typeof STATIC_IMAGE_MIME_TYPES)[number]
  }
  if (mime && mime !== 'application/octet-stream') return null

  const extensionMime = mimeFromExtension(fileExtension(file.name))
  return (STATIC_IMAGE_MIME_TYPES as readonly string[]).includes(extensionMime || '')
    ? extensionMime as (typeof STATIC_IMAGE_MIME_TYPES)[number]
    : null
}

/**
 * Normalize all image types accepted by the sticker body uploader. The
 * canonical JPEG MIME is always image/jpeg, including image/jpg and .jpg.
 */
export function normalizeStickerMime(file: ImageFileLike): (typeof STICKER_UPLOAD_MIME_TYPES)[number] | null {
  const staticMime = normalizeImageMime(file)
  if (staticMime) return staticMime

  const mime = normalizedMimeValue(file.type)
  if (mime === 'image/gif' || mime === 'image/apng') return mime
  if (mime && mime !== 'application/octet-stream') return null

  const extensionMime = mimeFromExtension(fileExtension(file.name))
  return (STICKER_UPLOAD_MIME_TYPES as readonly string[]).includes(extensionMime || '')
    ? extensionMime as (typeof STICKER_UPLOAD_MIME_TYPES)[number]
    : null
}

/**
 * File.type is empty or application/octet-stream in some browsers and drag/drop
 * paths. The server still validates the actual bytes with Sharp; this is only
 * the client-side candidate filter and MIME normalization used for FormData.
 */
export function isSupportedStickerFile(file: ImageFileLike): boolean {
  return normalizeStickerMime(file) !== null
}

export function isStickerMimeAllowed(mime: string, type: 'STATIC' | 'GIF'): boolean {
  if (type !== 'STATIC' && type !== 'GIF') return false
  const normalized = normalizedMimeValue(mime)
  return Boolean(normalized) && (STICKER_UPLOAD_MIME_TYPES as readonly string[]).includes(normalized)
}
