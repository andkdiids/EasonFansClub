import { randomUUID } from 'node:crypto'
import sharp, { type Metadata } from 'sharp'
import { publicImageUrl } from '@/lib/images'
import { NextResponse } from 'next/server'
import { enforceApiRateLimit, requireRequestUser } from '@/lib/security'
import { uploadSiteImage } from '@/lib/site-media-storage'
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
const CONTENT_IMAGE_TRACE_HEADER = 'x-content-image-trace-id'

type UploadTraceDetails = {
  code?: string
  status?: number
  mime?: unknown
  requestMime?: unknown
  size?: unknown
  format?: unknown
  heic?: boolean
}

function imageContentType(format?: string | null) {
  if (format === 'jpeg') return 'image/jpeg'
  if (format === 'png') return 'image/png'
  if (format === 'gif') return 'image/gif'
  if (format === 'avif') return 'image/avif'
  return 'image/webp'
}

function safeTraceCode(value: unknown) {
  return typeof value === 'string' && /^[A-Z0-9_]{1,64}$/.test(value) ? value : 'UNKNOWN_ERROR'
}

function safeTraceStage(value: string) {
  return /^[a-z0-9._-]{1,64}$/.test(value) ? value : 'unknown'
}

function safeTraceMime(value: unknown) {
  const mime = typeof value === 'string' ? value.trim().toLowerCase().split(';', 1)[0] : ''
  return /^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/.test(mime) ? mime : undefined
}

function safeTraceSize(value: unknown) {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) return undefined
  return value
}

function safeTraceStatus(value: unknown) {
  return typeof value === 'number' && Number.isInteger(value) && value >= 100 && value <= 599 ? value : undefined
}

function safeTraceFormat(value: unknown) {
  return typeof value === 'string' && /^[a-z0-9]{1,16}$/.test(value) ? value : undefined
}

function uploadFailure(traceId: string, stage: string, details: UploadTraceDetails = {}) {
  const safeDetails: Record<string, unknown> = {
    event: 'CONTENT_IMAGE_UPLOAD_FAILED',
    traceId,
    stage: safeTraceStage(stage),
    code: safeTraceCode(details.code),
  }
  const status = safeTraceStatus(details.status)
  const mime = safeTraceMime(details.mime)
  const requestMime = safeTraceMime(details.requestMime)
  const size = safeTraceSize(details.size)
  const format = safeTraceFormat(details.format)
  if (status !== undefined) safeDetails.status = status
  if (mime !== undefined) safeDetails.mime = mime
  if (requestMime !== undefined) safeDetails.requestMime = requestMime
  if (size !== undefined) safeDetails.size = size
  if (format !== undefined) safeDetails.format = format
  if (typeof details.heic === 'boolean') safeDetails.heic = details.heic
  console.error('[content-image.upload.failed]', safeDetails)
}

function withTraceHeader(response: Response, traceId: string) {
  response.headers.set(CONTENT_IMAGE_TRACE_HEADER, traceId)
  return response
}

function failureResponse(traceId: string, stage: string, code: string, message: string, status: number, details: Omit<UploadTraceDetails, 'code' | 'status'> = {}) {
  uploadFailure(traceId, stage, { ...details, code, status })
  return NextResponse.json({ code, message }, { status, headers: { [CONTENT_IMAGE_TRACE_HEADER]: traceId } })
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
  const traceId = randomUUID()
  try {
    const guard = await requireRequestUser(request)
    if (!guard.user) {
      uploadFailure(traceId, 'auth', { code: 'AUTH_REQUIRED', status: guard.response.status })
      return withTraceHeader(guard.response, traceId)
    }
    const limited = await enforceApiRateLimit(request, guard.user.id, {
      endpoint: '/api/uploads/content-image',
      ip: { limit: 60, windowSeconds: 60 * 60 },
      user: { limit: 30, windowSeconds: 60 * 60 },
    }, '图片上传过于频繁，请稍后再试')
    if (limited) {
      uploadFailure(traceId, 'rate-limit', { code: 'RATE_LIMITED', status: limited.status })
      return withTraceHeader(limited, traceId)
    }

    const requestContentType = request.headers.get('content-type') || ''
    const requestMime = safeTraceMime(requestContentType)
    if (!/^multipart\/form-data\s*(?:;|$)/i.test(requestContentType)) {
      return failureResponse(traceId, 'multipart.content-type', 'INVALID_MULTIPART', '图片上传请求无效，请重新选择图片', 400, { requestMime })
    }

    let form: FormData | null = null
    try {
      form = await request.formData()
    } catch {
      return failureResponse(traceId, 'multipart.parse', 'INVALID_MULTIPART', '图片上传请求无效，请重新选择图片', 400, { requestMime })
    }
    const file = form?.get('file')
    if (file === null || typeof file === 'string') {
      return failureResponse(traceId, 'file.required', 'FILE_REQUIRED', CONTENT_IMAGE_ERROR_MESSAGES.FILE_REQUIRED, 400, { requestMime })
    }
    if (!isMultipartFile(file)) {
      return failureResponse(traceId, 'file.invalid', 'INVALID_FILE', CONTENT_IMAGE_ERROR_MESSAGES.INVALID_FILE, 400, { requestMime })
    }
    const fileDetails = { mime: file.type, size: file.size, heic: isContentImageHeic(file) }
    if (file.size > CONTENT_IMAGE_MAX_FILE_SIZE) {
      return failureResponse(traceId, 'file.size', 'FILE_TOO_LARGE', CONTENT_IMAGE_ERROR_MESSAGES.FILE_TOO_LARGE, 413, fileDetails)
    }
    const metadataValidation = validateContentImageFileMetadata(file)
    if (!metadataValidation.ok) {
      return failureResponse(traceId, 'file.metadata', metadataValidation.code, metadataValidation.message, metadataValidation.code === 'FILE_TOO_LARGE' ? 413 : 400, fileDetails)
    }

    let buffer: Buffer
    try {
      buffer = Buffer.from(await file.arrayBuffer())
    } catch {
      return failureResponse(traceId, 'multipart.read', 'INVALID_FILE', '读取图片失败', 400, fileDetails)
    }
    if (buffer.byteLength === 0) {
      return failureResponse(traceId, 'file.empty', 'EMPTY_FILE', CONTENT_IMAGE_ERROR_MESSAGES.EMPTY_FILE, 400, fileDetails)
    }

    // 统一在服务端用 sharp 转 WebP，避免前端 tampering 与多端不一致。
    // 真实格式由 sharp 解码后白名单校验，而非信任浏览器 MIME，避免 MIME 异常误判。
    let generated: Awaited<ReturnType<typeof createImageVariants>>
    let detectedFormat: string | null = null
    let metadata: Metadata
    try {
      const image = sharp(buffer, { animated: true, failOn: 'none', limitInputPixels: 100_000_000 })
      metadata = await image.metadata()
    } catch {
      const code = fileDetails.heic ? 'HEIC_CONVERSION_FAILED' : 'IMAGE_PROCESSING_FAILED'
      return failureResponse(traceId, 'sharp.decode', code, CONTENT_IMAGE_ERROR_MESSAGES[code], 400, fileDetails)
    }

    const format = metadata.format
    detectedFormat = format || null
    if (!format || !ALLOWED_IMAGE_FORMATS.has(format)) {
      return failureResponse(traceId, 'sharp.format', 'UNSUPPORTED_FORMAT', CONTENT_IMAGE_ERROR_MESSAGES.UNSUPPORTED_FORMAT, 400, { ...fileDetails, format })
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
      const code = fileDetails.heic ? 'HEIC_CONVERSION_FAILED' : 'IMAGE_PROCESSING_FAILED'
      return failureResponse(traceId, 'sharp.transform', code, CONTENT_IMAGE_ERROR_MESSAGES[code], 400, { ...fileDetails, format })
    }

    const objectPath = `content/${guard.user.id}/${randomUUID()}/source.webp`
    try {
      const uploadResult = await uploadImageVariantFamily({
        sourceObjectPath: objectPath,
        original: buffer,
        // Content posts only need the normalized WebP source and variants. Do
        // not retain a large camera original in COS after processing.
        preserveOriginal: false,
        originalContentType: imageContentType(detectedFormat),
        generated,
        upload: ({ key, body, contentType }) => uploadSiteImage({ key, body, contentType }),
        remove: deleteFromCos,
      })
      const url = publicImageUrl(uploadResult.sourceUrl)
      return NextResponse.json({ url, mimeType: 'image/webp' }, { headers: { [CONTENT_IMAGE_TRACE_HEADER]: traceId } })
    } catch {
      return failureResponse(traceId, 'cos.upload', 'UPLOAD_FAILED', '图片上传失败，请稍后重试', 502, { ...fileDetails, format })
    }
  } catch {
    return failureResponse(traceId, 'unexpected', 'INTERNAL_ERROR', '图片上传失败，请稍后重试', 500)
  }
}
