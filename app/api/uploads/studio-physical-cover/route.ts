import { randomUUID } from 'node:crypto'
import sharp from 'sharp'
import { NextResponse } from 'next/server'
import { publicImageUrl } from '@/lib/images'
import { uploadSiteImage, SiteMediaStorageError } from '@/lib/site-media-storage'
import { enforceApiRateLimit, rejectInvalidRequestOrigin, requireUser } from '@/lib/security'

export const runtime = 'nodejs'

// Keep the cover path aligned with the existing Studio reference uploader:
// decode and normalize on the server, then persist only the public COS media
// URL in project metadata.
const MAX_FILE_SIZE = 8 * 1024 * 1024
const MAX_INPUT_PIXELS = 64_000_000
const MAX_OUTPUT_EDGE = 2400
const ALLOWED_FORMATS = new Set(['jpeg', 'png', 'webp', 'gif', 'avif', 'heif'])

function isMultipartFile(value: FormDataEntryValue | null): value is File {
  return Boolean(value && typeof value !== 'string' && typeof value.size === 'number' && typeof value.arrayBuffer === 'function')
}

export async function POST(request: Request) {
  const originError = rejectInvalidRequestOrigin(request)
  if (originError) return originError
  const guard = await requireUser()
  if (!guard.user) return guard.response
  const limited = await enforceApiRateLimit(request, guard.user.id, {
    endpoint: '/api/uploads/studio-physical-cover',
    ip: { limit: 30, windowSeconds: 60 * 60 },
    user: { limit: 15, windowSeconds: 60 * 60 },
  }, '实物封面上传过于频繁，请稍后再试')
  if (limited) return limited

  const form = await request.formData().catch(() => null)
  const file = form?.get('file') || null
  if (!isMultipartFile(file)) return NextResponse.json({ code: 'FILE_REQUIRED', message: '未收到有效的实物封面图片' }, { status: 400 })
  if (file.size > MAX_FILE_SIZE) return NextResponse.json({ code: 'FILE_TOO_LARGE', message: '实物封面不能超过 8MB' }, { status: 413 })

  let input: Buffer
  try {
    input = Buffer.from(await file.arrayBuffer())
  } catch {
    return NextResponse.json({ code: 'FILE_READ_FAILED', message: '读取实物封面失败，请重新选择图片' }, { status: 400 })
  }
  if (!input.length) return NextResponse.json({ code: 'EMPTY_FILE', message: '实物封面内容为空' }, { status: 400 })

  let output: Buffer
  let dimensions: { width: number; height: number }
  try {
    const image = sharp(input, { animated: true, failOn: 'none', limitInputPixels: MAX_INPUT_PIXELS })
    const metadata = await image.metadata()
    if (!metadata.format || !ALLOWED_FORMATS.has(metadata.format)) return NextResponse.json({ code: 'UNSUPPORTED_FORMAT', message: '实物封面仅支持 JPG、PNG、WebP、GIF、AVIF 或 HEIF 图片' }, { status: 400 })
    output = await image
      .rotate()
      .resize({ width: MAX_OUTPUT_EDGE, height: MAX_OUTPUT_EDGE, fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 84 })
      .toBuffer()
    const outputMetadata = await sharp(output).metadata()
    dimensions = { width: outputMetadata.width || 0, height: outputMetadata.height || 0 }
  } catch (error) {
    console.error('[studio-physical-cover.sharp]', { errorName: error instanceof Error ? error.name : 'UNKNOWN_ERROR' })
    return NextResponse.json({ code: 'IMAGE_PROCESSING_FAILED', message: '实物封面处理失败，请换一张图片再试' }, { status: 422 })
  }

  try {
    const key = `studio/physical-covers/${guard.user.id}/${randomUUID()}.webp`
    const url = await uploadSiteImage({ key, body: output, contentType: 'image/webp' })
    const publicUrl = publicImageUrl(url)
    if (!publicUrl) return NextResponse.json({ code: 'MEDIA_URL_INVALID', message: '实物封面地址无效，请稍后重试' }, { status: 502 })
    return NextResponse.json({ ok: true, url: publicUrl, mimeType: 'image/webp', ...dimensions })
  } catch (error) {
    if (error instanceof SiteMediaStorageError) return NextResponse.json({ code: 'UPLOAD_FAILED', message: error.message }, { status: 502 })
    console.error('[studio-physical-cover.upload]', { errorName: error instanceof Error ? error.name : 'UNKNOWN_ERROR' })
    return NextResponse.json({ code: 'UPLOAD_FAILED', message: '实物封面上传失败，请稍后重试' }, { status: 502 })
  }
}
