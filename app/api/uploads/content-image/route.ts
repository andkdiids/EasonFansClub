import { randomUUID } from 'node:crypto'
import sharp, { type Metadata } from 'sharp'
import { publicImageUrl } from '@/lib/images'
import { NextResponse } from 'next/server'
import { enforceApiRateLimit, requireUser } from '@/lib/security'
import { uploadSiteImage, SiteMediaStorageError } from '@/lib/site-media-storage'
import { createAnimatedImageVariants, createImageVariants, isAnimatedImageInput } from '@/lib/image-webp'
import { uploadImageVariantFamily } from '@/lib/image-variant-upload'
import { deleteFromCos } from '@/lib/tencent-cos'
import {
  CONTENT_IMAGE_ERROR_MESSAGES,
  CONTENT_IMAGE_MAX_FILE_SIZE as CONTENT_IMAGE_MAX_FILE_SIZE_BYTES,
  isContentImageHeic,
  validateContentImageFileMetadata,
} from '@/lib/content-image-upload'

export const runtime = 'nodejs'

const CONTENT_IMAGE_MAX_WIDTH = 1600
const CONTENT_IMAGE_QUALITY = 82
const CONTENT_IMAGE_MAX_FILE_SIZE = CONTENT_IMAGE_MAX_FILE_SIZE_BYTES
// 服务端以 sharp 实际解码出的格式为准，不依赖浏览器上报的 MIME（可能异常/为空）。
// 注意：sharp 的 metadata.format 为 'jpeg'/'png'/'webp'/'gif' 等，不以 'image' 开头。
const ALLOWED_IMAGE_FORMATS = new Set(['jpeg', 'png', 'webp', 'gif', 'avif', 'heif'])

function imageContentType(format?: string | null) {
  if (format === 'jpeg') return 'image/jpeg'
  if (format === 'png') return 'image/png'
  if (format === 'gif') return 'image/gif'
  if (format === 'avif') return 'image/avif'
  return 'image/webp'
}

function uploadFailure(stage: string, details: Record<string, unknown> = {}) {
  console.error('[content-image.upload.failed]', {
    event: 'CONTENT_IMAGE_UPLOAD_FAILED',
    stage,
    ...details,
  })
}

function jsonError(code: string, message: string, status = 400) {
  return NextResponse.json({ code, message }, { status })
}

function isMultipartFile(value: FormDataEntryValue | null): value is File {
  return Boolean(
    value
      && typeof value !== 'string'
      && typeof value.size === 'number'
      && typeof value.arrayBuffer === 'function',
  )
}

export async function POST(request: Request) {
  const guard = await requireUser()
  if (!guard.user) return guard.response
  const limited = await enforceApiRateLimit(request, guard.user.id, {
    endpoint: '/api/uploads/content-image',
    ip: { limit: 60, windowSeconds: 60 * 60 },
    user: { limit: 30, windowSeconds: 60 * 60 },
  }, '图片上传过于频繁，请稍后再试')
  if (limited) return limited

  const requestContentType = request.headers.get('content-type') || ''
  if (!/^multipart\/form-data\s*(?:;|$)/i.test(requestContentType)) {
    return jsonError('INVALID_MULTIPART', '图片上传请求无效，请重新选择图片')
  }

  let form: FormData | null = null
  try {
    form = await request.formData()
  } catch {
    uploadFailure('multipart.parse')
    return jsonError('INVALID_MULTIPART', '图片上传请求无效，请重新选择图片')
  }
  const file = form?.get('file')
  if (file === null || typeof file === 'string') {
    return jsonError('FILE_REQUIRED', CONTENT_IMAGE_ERROR_MESSAGES.FILE_REQUIRED)
  }
  if (!isMultipartFile(file)) {
    return jsonError('INVALID_FILE', CONTENT_IMAGE_ERROR_MESSAGES.INVALID_FILE)
  }
  if (file.size > CONTENT_IMAGE_MAX_FILE_SIZE) {
    return jsonError('FILE_TOO_LARGE', CONTENT_IMAGE_ERROR_MESSAGES.FILE_TOO_LARGE, 413)
  }
  const metadataValidation = validateContentImageFileMetadata(file)
  if (!metadataValidation.ok) {
    return jsonError(metadataValidation.code, metadataValidation.message, metadataValidation.code === 'FILE_TOO_LARGE' ? 413 : 400)
  }

  let buffer: Buffer
  try {
    buffer = Buffer.from(await file.arrayBuffer())
  } catch {
    uploadFailure('multipart.read')
    return jsonError('INVALID_FILE', '读取图片失败')
  }
  if (buffer.byteLength === 0) {
    return jsonError('EMPTY_FILE', CONTENT_IMAGE_ERROR_MESSAGES.EMPTY_FILE)
  }

  // 统一在服务端用 sharp 转 WebP，避免前端 tampering 与多端不一致。
  // 真实格式由 sharp 解码后白名单校验，而非信任浏览器 MIME，避免 MIME 异常误判。
  let rawBuffer: Buffer
  let generated: Awaited<ReturnType<typeof createImageVariants>>
  let detectedFormat: string | null = null
  let metadata: Metadata
  try {
    rawBuffer = buffer
    const image = sharp(buffer, { animated: true, failOn: 'none', limitInputPixels: 100_000_000 })
    metadata = await image.metadata()
  } catch {
    uploadFailure('sharp.decode', { heic: isContentImageHeic(file) })
    return jsonError(
      isContentImageHeic(file) ? 'HEIC_CONVERSION_FAILED' : 'IMAGE_PROCESSING_FAILED',
      isContentImageHeic(file) ? CONTENT_IMAGE_ERROR_MESSAGES.HEIC_CONVERSION_FAILED : CONTENT_IMAGE_ERROR_MESSAGES.IMAGE_PROCESSING_FAILED,
    )
  }

  const format = metadata.format
  detectedFormat = format || null
  if (!format || !ALLOWED_IMAGE_FORMATS.has(format)) {
    return jsonError('UNSUPPORTED_FORMAT', CONTENT_IMAGE_ERROR_MESSAGES.UNSUPPORTED_FORMAT)
  }

  try {
    const animated = isAnimatedImageInput(buffer, metadata)
    generated = animated
      ? await createAnimatedImageVariants(buffer, {
        sourceMaxWidth: CONTENT_IMAGE_MAX_WIDTH,
        sourceQuality: CONTENT_IMAGE_QUALITY,
        variants: ['thumb-md', 'card', 'large'],
      })
      : await createImageVariants(buffer, {
        sourceMaxWidth: CONTENT_IMAGE_MAX_WIDTH,
        sourceQuality: CONTENT_IMAGE_QUALITY,
        variants: ['thumb-md', 'card', 'large'],
      })
  } catch {
    uploadFailure('sharp.transform', { heic: isContentImageHeic(file), format })
    return jsonError(
      isContentImageHeic(file) ? 'HEIC_CONVERSION_FAILED' : 'IMAGE_PROCESSING_FAILED',
      isContentImageHeic(file) ? CONTENT_IMAGE_ERROR_MESSAGES.HEIC_CONVERSION_FAILED : CONTENT_IMAGE_ERROR_MESSAGES.IMAGE_PROCESSING_FAILED,
    )
  }

  const objectPath = `content/${guard.user.id}/${randomUUID()}/source.webp`
  try {
    const uploadResult = await uploadImageVariantFamily({
      sourceObjectPath: objectPath,
      original: rawBuffer,
      // Content posts only need the normalized WebP source and variants. Do
      // not retain a large camera original in COS after processing.
      preserveOriginal: false,
      originalContentType: imageContentType(detectedFormat),
      generated,
      upload: ({ key, body, contentType }) => uploadSiteImage({ key, body, contentType }),
      remove: deleteFromCos,
    })
    const url = publicImageUrl(uploadResult.sourceUrl)
    return NextResponse.json({ url, mimeType: 'image/webp' })
  } catch (error) {
    uploadFailure('cos.upload', {
      errorName: error instanceof Error ? error.name : 'UNKNOWN_ERROR',
    })
    if (error instanceof SiteMediaStorageError) {
      return NextResponse.json({ code: 'UPLOAD_FAILED', message: error.message }, { status: 502 })
    }
    return NextResponse.json({ code: 'UPLOAD_FAILED', message: '图片上传失败，请稍后重试' }, { status: 502 })
  }
}
