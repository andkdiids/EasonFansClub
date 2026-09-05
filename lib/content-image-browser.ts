'use client'

import {
  CONTENT_IMAGE_COMPRESSION_TARGET,
  CONTENT_IMAGE_COMPRESSION_THRESHOLD,
  CONTENT_IMAGE_ERROR_MESSAGES,
  contentImageKind,
  isContentImageHeic,
  type ContentImageUploadErrorCode,
} from '@/lib/content-image-upload'
import { validateContentImageFileMetadata } from '@/lib/content-image-upload'

const MAX_COMPRESSION_DIMENSION = 4096
const MAX_COMPRESSION_PASSES = 7

export type ContentImageProcessingPhase = 'processing' | 'compressing'

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
