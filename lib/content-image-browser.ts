'use client'

import {
  CONTENT_IMAGE_COMPRESSION_TARGET,
  CONTENT_IMAGE_COMPRESSION_THRESHOLD,
  CONTENT_IMAGE_ERROR_MESSAGES,
  contentImageKind,
  isContentImageHeic,
  isContentImageMimeType,
  type ContentImageUploadErrorCode,
} from '@/lib/content-image-upload'
import { validateContentImageFileMetadata } from '@/lib/content-image-upload'

const MAX_COMPRESSION_DIMENSION = 4096
const MAX_COMPRESSION_PASSES = 7

export type ContentImageProcessingPhase = 'processing' | 'compressing'
export type ContentImageUploadPhase = ContentImageProcessingPhase | 'uploading'

export type ClipboardImageReadErrorCode = 'UNSUPPORTED' | 'PERMISSION'

export class ClipboardImageReadError extends Error {
  constructor(public readonly code: ClipboardImageReadErrorCode) {
    super(code)
    this.name = 'ClipboardImageReadError'
  }
}

export class ContentImageClientError extends Error {
  constructor(public readonly code: ContentImageUploadErrorCode, message: string) {
    super(message)
    this.name = 'ContentImageClientError'
  }
}

type DecodedImage = {
  source: CanvasImageSource
  width: number
  height: number
  cleanup: () => void
}

function clientError(code: ContentImageUploadErrorCode) {
  return new ContentImageClientError(code, CONTENT_IMAGE_ERROR_MESSAGES[code])
}

function fileBaseName(name: string) {
  const normalized = name.replace(/\\/g, '/').split('/').pop() || 'image'
  const dot = normalized.lastIndexOf('.')
  return (dot > 0 ? normalized.slice(0, dot) : normalized).slice(0, 120) || 'image'
}

function compressionOutputType(file: File) {
  const kind = contentImageKind(file)
  if (kind === 'png' || kind === 'webp') return 'image/webp' as const
  return 'image/jpeg' as const
}

function compressionOutputExtension(contentType: string) {
  return contentType === 'image/webp' ? 'webp' : 'jpg'
}

async function decodeImage(file: File): Promise<DecodedImage> {
  const objectUrl = URL.createObjectURL(file)

  if (typeof createImageBitmap === 'function') {
    try {
      const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
      URL.revokeObjectURL(objectUrl)
      return {
        source: bitmap,
        width: bitmap.width,
        height: bitmap.height,
        cleanup: () => bitmap.close(),
      }
    } catch {
      // Some Safari/WebView versions cannot create an ImageBitmap for HEIC;
      // the HTMLImageElement path below still works where native decoding does.
    }
  }

  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const element = new Image()
      element.decoding = 'async'
      element.onload = () => resolve(element)
      element.onerror = () => reject(new Error('IMAGE_DECODE_FAILED'))
      element.src = objectUrl
    })
    return {
      source: image,
      width: image.naturalWidth,
      height: image.naturalHeight,
      cleanup: () => URL.revokeObjectURL(objectUrl),
    }
  } catch (error) {
    URL.revokeObjectURL(objectUrl)
    throw error
  }
}

function scaledDimensions(width: number, height: number, scale: number) {
  const boundedScale = Math.min(
    scale,
    MAX_COMPRESSION_DIMENSION / Math.max(width, height),
  )
  return {
    width: Math.max(1, Math.round(width * boundedScale)),
    height: Math.max(1, Math.round(height * boundedScale)),
  }
}

function canvasBlob(canvas: HTMLCanvasElement, contentType: string, quality: number) {
  return new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, contentType, quality))
}

async function encodeAtQuality(
  canvas: HTMLCanvasElement,
  preferredType: string,
  quality: number,
) {
  const preferred = await canvasBlob(canvas, preferredType, quality)
  if (preferred && preferred.size > 0) return preferred
  if (preferredType === 'image/jpeg') return null
  return canvasBlob(canvas, 'image/jpeg', quality)
}

async function compressImageFile(file: File) {
  const decoded = await decodeImage(file)
  try {
    if (!decoded.width || !decoded.height) throw new Error('IMAGE_DIMENSIONS_INVALID')
    const canvas = document.createElement('canvas')
    const contentType = compressionOutputType(file)
    let scale = 1
    let best: Blob | null = null

    for (let pass = 0; pass < MAX_COMPRESSION_PASSES; pass += 1) {
      const dimensions = scaledDimensions(decoded.width, decoded.height, scale)
      canvas.width = dimensions.width
      canvas.height = dimensions.height
      const context = canvas.getContext('2d', { alpha: true })
      if (!context) throw new Error('CANVAS_UNAVAILABLE')
      context.clearRect(0, 0, dimensions.width, dimensions.height)
      context.drawImage(decoded.source, 0, 0, dimensions.width, dimensions.height)

      for (const quality of [0.84, 0.74, 0.64, 0.54, 0.44]) {
        const blob = await encodeAtQuality(canvas, contentType, quality)
        if (!blob) continue
        if (!best || blob.size < best.size) best = blob
        if (blob.size <= CONTENT_IMAGE_COMPRESSION_TARGET) {
          return new File(
            [blob],
            `${fileBaseName(file.name)}.${compressionOutputExtension(blob.type)}`,
            { type: blob.type, lastModified: file.lastModified || Date.now() },
          )
        }
      }

      // Keep the aspect ratio and reduce dimensions only when quality alone
      // cannot reach the target. No crop or forced square conversion occurs.
      scale *= 0.8
    }

    if (!best || best.size > CONTENT_IMAGE_COMPRESSION_TARGET) {
      throw new Error('COMPRESSION_TARGET_NOT_REACHED')
    }
    return new File(
      [best],
      `${fileBaseName(file.name)}.${compressionOutputExtension(best.type)}`,
      { type: best.type, lastModified: file.lastModified || Date.now() },
    )
  } finally {
    decoded.cleanup()
  }
}

/**
 * Validate a selected browser file, convert natively decodable HEIC/HEIF to
 * JPEG, and compress files above 5MB to a display-safe <=4MB upload. The
 * server remains the final byte-level validator.
 */
export async function prepareContentImageFile(
  file: File,
  onPhase?: (phase: ContentImageProcessingPhase) => void,
) {
  const validation = validateContentImageFileMetadata(file)
  if (!validation.ok) throw clientError(validation.code)

  const heic = isContentImageHeic(file)
  const shouldCompress = file.size > CONTENT_IMAGE_COMPRESSION_THRESHOLD
  const kind = contentImageKind(file)

  // Preserve animated GIFs. The server's existing animated pipeline handles
  // them without flattening the animation in a browser canvas.
  if (!heic && !shouldCompress) return file
  if (!heic && (kind === 'gif')) return file

  onPhase?.('compressing')
  try {
    return await compressImageFile(file)
  } catch {
    throw clientError(heic ? 'HEIC_CONVERSION_FAILED' : 'IMAGE_PROCESSING_FAILED')
  }
}

function clipboardImageExtension(type: string) {
  const normalized = type.toLowerCase().split(';', 1)[0]
  if (normalized === 'image/jpeg' || normalized === 'image/jpg' || normalized === 'image/pjpeg') return 'jpg'
  if (normalized === 'image/webp') return 'webp'
  if (normalized === 'image/gif') return 'gif'
  if (normalized === 'image/avif') return 'avif'
  if (normalized === 'image/heic') return 'heic'
  if (normalized === 'image/heif') return 'heif'
  return 'png'
}

export function createClipboardImageFile(blob: Blob, type: string, index: number, timestamp = Date.now()) {
  const normalizedType = type.trim().toLowerCase() || blob.type || 'image/png'
  return new File(
    [blob],
    `clipboard-${timestamp}-${index + 1}.${clipboardImageExtension(normalizedType)}`,
    { type: normalizedType, lastModified: timestamp },
  )
}

export function clipboardImageFilesFromPaste(event: ClipboardEvent) {
  const items = event.clipboardData?.items
  if (!items) return []

  const timestamp = Date.now()
  const files: File[] = []
  for (let index = 0; index < items.length; index += 1) {
    const item = items[index]
    const itemType = item.type.trim().toLowerCase()
    if (item.kind !== 'file' || !itemType.startsWith('image/')) continue
    const source = item.getAsFile()
    if (!source) continue
    files.push(createClipboardImageFile(source, itemType || source.type || 'image/png', files.length, timestamp))
  }
  return files
}

type ClipboardWithRead = Clipboard & {
  read?: () => Promise<readonly ClipboardItem[]>
}

function isClipboardPermissionError(error: unknown) {
  if (error instanceof Error && ['NotAllowedError', 'SecurityError'].includes(error.name)) return true
  return typeof DOMException !== 'undefined'
    && error instanceof DOMException
    && ['NotAllowedError', 'SecurityError'].includes(error.name)
}

export async function readClipboardImageFiles() {
  const clipboard = typeof navigator !== 'undefined' && navigator.clipboard
    ? navigator.clipboard as ClipboardWithRead
    : null
  if (!clipboard || typeof clipboard.read !== 'function') throw new ClipboardImageReadError('UNSUPPORTED')

  try {
    const items = await clipboard.read()
    const timestamp = Date.now()
    const files: File[] = []
    for (const item of items) {
      const type = item.types.find((candidate) => isContentImageMimeType(candidate))
      if (!type) continue
      try {
        const blob = await item.getType(type)
        if (blob.size <= 0) continue
        files.push(createClipboardImageFile(blob, type, files.length, timestamp))
      } catch (error) {
        if (isClipboardPermissionError(error)) throw new ClipboardImageReadError('PERMISSION')
      }
    }
    return files
  } catch (error) {
    if (error instanceof ClipboardImageReadError) throw error
    throw new ClipboardImageReadError('PERMISSION')
  }
}

const KNOWN_CONTENT_IMAGE_ERROR_CODES = new Set<ContentImageUploadErrorCode>([
  'FILE_REQUIRED',
  'EMPTY_FILE',
  'FILE_TOO_LARGE',
  'UNSUPPORTED_FORMAT',
  'INVALID_FILE',
  'HEIC_CONVERSION_FAILED',
  'IMAGE_PROCESSING_FAILED',
  'NETWORK_UPLOAD_FAILED',
  'UPLOAD_FAILED',
  'UPLOAD_RESPONSE_INVALID',
])

function isKnownContentImageErrorCode(value: unknown): value is ContentImageUploadErrorCode {
  return typeof value === 'string' && KNOWN_CONTENT_IMAGE_ERROR_CODES.has(value as ContentImageUploadErrorCode)
}

function uploadErrorFromResponse(data: unknown, response: Response) {
  const payload = data && typeof data === 'object' ? data as Record<string, unknown> : {}
  const code = isKnownContentImageErrorCode(payload.code)
    ? payload.code
    : response.status === 413
      ? 'FILE_TOO_LARGE'
      : 'UPLOAD_FAILED'
  const message = typeof payload.message === 'string' && payload.message.trim()
    ? payload.message
    : CONTENT_IMAGE_ERROR_MESSAGES[code]
  return new ContentImageClientError(code, message)
}

/**
 * The one browser-to-server content-image upload path. File selection,
 * clipboard paste, and any future editor image entry point all use this
 * helper so validation, compression, multipart fields, and diagnostics stay
 * identical.
 */
export async function uploadContentImage(
  file: File,
  onPhase?: (phase: ContentImageUploadPhase) => void,
) {
  onPhase?.('processing')
  const preparedFile = await prepareContentImageFile(file, (phase) => onPhase?.(phase))
  onPhase?.('uploading')

  const form = new FormData()
  // Do not set Content-Type manually: the browser must add the multipart
  // boundary, which is especially important in mobile WebViews.
  form.set('file', preparedFile)

  let response: Response
  try {
    response = await fetch('/api/uploads/content-image', {
      method: 'POST',
      body: form,
      cache: 'no-store',
    })
  } catch {
    throw new ContentImageClientError('NETWORK_UPLOAD_FAILED', CONTENT_IMAGE_ERROR_MESSAGES.NETWORK_UPLOAD_FAILED)
  }

  const data = await response.json().catch(() => null) as { url?: unknown; mimeType?: unknown; code?: unknown; message?: unknown } | null
  if (!response.ok) throw uploadErrorFromResponse(data, response)
  if (!data || typeof data.url !== 'string' || !data.url.trim()) {
    throw new ContentImageClientError('UPLOAD_RESPONSE_INVALID', CONTENT_IMAGE_ERROR_MESSAGES.UPLOAD_RESPONSE_INVALID)
  }

  return {
    url: data.url,
    mimeType: typeof data.mimeType === 'string' ? data.mimeType : undefined,
  }
}
