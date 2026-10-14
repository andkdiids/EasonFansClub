import sharp, { type Metadata } from 'sharp'

/** Topic activity source images are deliberately less aggressive than forum images. */
export const TOPIC_ACTIVITY_IMAGE_MAX_FILE_SIZE = 20 * 1024 * 1024
export const TOPIC_ACTIVITY_IMAGE_TOO_LARGE_MESSAGE = '图片过大，请选择较小原图'

export const TOPIC_ACTIVITY_IMAGE_FORMATS = new Set(['jpeg', 'png', 'webp', 'gif', 'heif'])

const ORIGINAL_KEY_PART = /^original-(.+)$/u
const SAFE_KEY_PART = /^[A-Za-z0-9_-]{1,191}$/u
const SAFE_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/heic', 'image/heif'])

export type TopicActivityImagePurpose = 'FORM_ANSWER' | 'ADMIN_REPLY'
export type TopicActivityImageDerivative = {
  format: string
  mimeType: string
  width: number
  height: number
  preview: Buffer
  thumbnail: Buffer
}

function extension(value: string) {
  const normalized = value.trim().toLowerCase()
  const basename = normalized.replace(/\\/g, '/').split('/').pop() || ''
  const dot = basename.lastIndexOf('.')
  return dot > 0 ? basename.slice(dot + 1) : ''
}

function formatExtension(format: string) {
  if (format === 'jpeg') return 'jpg'
  if (format === 'heif') return 'heif'
  return format
}

function formatMimeType(format: string, filename: string, providedType?: string) {
  if (format === 'jpeg') return 'image/jpeg'
  if (format === 'png') return 'image/png'
  if (format === 'webp') return 'image/webp'
  if (format === 'gif') return 'image/gif'
  if (format === 'heif') {
    const provided = providedType?.trim().toLowerCase().split(';', 1)[0]
    if (provided === 'image/heic' || provided === 'image/heif') return provided
    return extension(filename) === 'heic' ? 'image/heic' : 'image/heif'
  }
  return 'application/octet-stream'
}

function safeKeyPart(value: string, fallback: string) {
  const sanitized = value.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 191)
  return sanitized || fallback
}

const MAX_ORIGINAL_STORAGE_KEY_LENGTH = 500

function encodedFilenameWithinLimit(filename: string, maxLength: number) {
  const extensionMatch = filename.match(/(\.[A-Za-z0-9]{1,8})$/u)
  const extension = extensionMatch?.[1] || ''
  const stem = extension ? filename.slice(0, -extension.length) : filename
  const codePoints = Array.from(stem)
  let best = extension && encodeURIComponent(extension).length <= maxLength ? extension : ''
  for (let length = 1; length <= codePoints.length; length += 1) {
    const candidate = `${codePoints.slice(0, length).join('')}${extension}`
    if (encodeURIComponent(candidate).length > maxLength) break
    best = candidate
  }
  return encodeURIComponent(best || 'image')
}

/** Keep a reasonable display filename while removing path/header characters. */
export function sanitizeTopicActivityFilename(value: unknown, fallback: string, mimeType?: string | null) {
  const candidate = typeof value === 'string' ? value : ''
  const basename = candidate.normalize('NFKC').replace(/\\/g, '/').split('/').pop() || ''
  const cleanedCandidate = basename
    .replace(/[\u0000-\u001f\u007f"']/g, '_')
    .replace(/\.{2,}/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
  const extensionByMime = mimeType === 'image/png' ? 'png' : mimeType === 'image/webp' ? 'webp' : mimeType === 'image/gif' ? 'gif' : mimeType === 'image/heic' ? 'heic' : mimeType === 'image/heif' ? 'heif' : 'jpg'
  const cleanedExtension = cleanedCandidate.match(/(\.[A-Za-z0-9]{1,8})$/u)?.[1] || ''
  const cleanedStem = cleanedExtension ? cleanedCandidate.slice(0, -cleanedExtension.length) : cleanedCandidate
  const cleaned = `${Array.from(cleanedStem).slice(0, Math.max(0, 160 - cleanedExtension.length)).join('')}${cleanedExtension}`
  if (cleaned) return /\.[A-Za-z0-9]{1,8}$/u.test(cleaned) ? cleaned : `${cleaned}.${extensionByMime}`

  const fallbackName = fallback.normalize('NFKC').replace(/[\\/\u0000-\u001f\u007f"']/g, '_').replace(/\.{2,}/g, '_').trim().slice(0, 120) || 'topic-activity-image'
  if (/\.[A-Za-z0-9]{1,8}$/u.test(fallbackName)) return fallbackName
  return `${fallbackName}.${extensionByMime}`
}

export function topicActivityImageMimeType(format: string, filename: string, providedType?: string) {
  const mimeType = formatMimeType(format, filename, providedType)
  return SAFE_MIME_TYPES.has(mimeType) ? mimeType : 'application/octet-stream'
}

export function topicActivityOriginalObjectKey(input: {
  activityId: string
  purpose: TopicActivityImagePurpose
  uploadId: string
  filename: string
  format: string
}) {
  const folder = input.purpose === 'ADMIN_REPLY' ? 'replies' : 'submissions'
  const safeName = sanitizeTopicActivityFilename(input.filename, `topic-activity-image.${formatExtension(input.format)}`)
  const prefix = `topic-activity/${safeKeyPart(input.activityId, 'activity')}/${folder}/${safeKeyPart(input.uploadId, 'upload')}/original-`
  const encodedName = encodedFilenameWithinLimit(safeName, Math.max(1, MAX_ORIGINAL_STORAGE_KEY_LENGTH - prefix.length))
  return `${prefix}${encodedName}`
}

function keyParts(storageKey: string) {
  const normalized = storageKey.trim().replace(/^\/+/, '')
  const parts = normalized.split('/')
  if (parts.length !== 5 || parts[0] !== 'topic-activity') return null
  const original = parts[4].match(ORIGINAL_KEY_PART)
  if (!original || !SAFE_KEY_PART.test(parts[1]) || !['submissions', 'replies'].includes(parts[2]) || !SAFE_KEY_PART.test(parts[3])) return null
  return { normalized, parts, encodedFilename: original[1] }
}

/** Only original objects generated by this uploader are valid download targets. */
export function isTopicActivityOriginalObjectKey(storageKey: string, activityId: string, purpose: TopicActivityImagePurpose = 'ADMIN_REPLY') {
  const parsed = keyParts(storageKey)
  if (!parsed || parsed.parts[1] !== activityId) return false
  return parsed.parts[2] === (purpose === 'ADMIN_REPLY' ? 'replies' : 'submissions')
}

export function topicActivityPreviewObjectPath(storageKey: string, variant: 'preview' | 'thumbnail' = 'preview') {
  const parsed = keyParts(storageKey)
  if (!parsed) return null
  return `${parsed.parts.slice(0, 4).join('/')}/${variant === 'thumbnail' ? 'thumb-md.webp' : 'preview.webp'}`
}

export function topicActivityOriginalFilename(storageKey: string, fallback: string, mimeType: string | null | undefined) {
  const parsed = keyParts(storageKey)
  if (!parsed) return sanitizeTopicActivityFilename(null, fallback, mimeType)
  let decoded = parsed.encodedFilename
  try { decoded = decodeURIComponent(decoded) } catch { /* use the encoded safe fallback below */ }
  return sanitizeTopicActivityFilename(decoded, fallback, mimeType)
}

function previewFallback() {
  return sharp({
    create: { width: 1, height: 1, channels: 4, background: { r: 236, g: 239, b: 244, alpha: 1 } },
  }).webp({ quality: 80 }).toBuffer()
}

async function renderPreview(input: Buffer, width: number, quality: number) {
  return sharp(input, { animated: true, failOn: 'error', limitInputPixels: 100_000_000 })
    .rotate()
    .resize({ width, withoutEnlargement: true })
    .webp({ quality, effort: 4 })
    .toBuffer()
}

/**
 * Read the real image container and create only independent display
 * derivatives. The returned original bytes are never passed through Sharp.
 * HEIF metadata can be available even when the deployment lacks a decoder; in
 * that case we still retain the original and use a neutral preview placeholder.
 */
export async function createTopicActivityImageDerivative(input: Buffer, filename: string, providedType?: string): Promise<TopicActivityImageDerivative> {
  const image = sharp(input, { animated: true, failOn: 'error', limitInputPixels: 100_000_000 })
  const metadata: Metadata = await image.metadata()
  const format = metadata.format || ''
  if (!TOPIC_ACTIVITY_IMAGE_FORMATS.has(format) || !metadata.width || !metadata.height) throw new Error('UNSUPPORTED_FORMAT')
  // Sharp/libheif reports AVIF containers as format "heif". The encoder
  // marker is the reliable distinction from HEIC/HEVC; do not accept an
  // AVIF payload merely because a client supplied an image/heic MIME hint.
  if (format === 'heif' && metadata.compression === 'av1') throw new Error('UNSUPPORTED_FORMAT')
  const mimeType = topicActivityImageMimeType(format, filename, providedType)
  if (!SAFE_MIME_TYPES.has(mimeType)) throw new Error('UNSUPPORTED_FORMAT')

  try {
    const [preview, thumbnail] = await Promise.all([
      renderPreview(input, 1600, 84),
      renderPreview(input, 480, 78),
    ])
    return { format, mimeType, width: metadata.width, height: metadata.height, preview, thumbnail }
  } catch (error) {
    // HEIC/HEIF must not be rejected merely because libheif cannot render a
    // web preview. The original remains byte-identical and private.
    if (format !== 'heif') throw error
    const [preview, thumbnail] = await Promise.all([previewFallback(), previewFallback()])
    return { format, mimeType, width: metadata.width, height: metadata.height, preview, thumbnail }
  }
}
