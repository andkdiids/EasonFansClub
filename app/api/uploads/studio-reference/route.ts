import { randomUUID } from 'node:crypto'
import sharp from 'sharp'
import { NextResponse } from 'next/server'
import { publicImageUrl } from '@/lib/images'
import { uploadSiteImage, SiteMediaStorageError } from '@/lib/site-media-storage'
import { enforceApiRateLimit, rejectInvalidRequestOrigin, requireUser } from '@/lib/security'

export const runtime = 'nodejs'

const MAX_FILE_SIZE = 8 * 1024 * 1024
const MAX_INPUT_PIXELS = 64_000_000
const MAX_OUTPUT_EDGE = 2400
const ALLOWED_FORMATS = new Set(['jpeg', 'png', 'webp', 'gif', 'avif'])

function isMultipartFile(value: FormDataEntryValue | null): value is File {
  return Boolean(value && typeof value !== 'string' && typeof value.size === 'number' && typeof value.arrayBuffer === 'function')
}

export async function POST(request: Request) {
  const originError = rejectInvalidRequestOrigin(request)
  if (originError) return originError
  const guard = await requireUser()
  if (!guard.user) return guard.response
  const limited = await enforceApiRateLimit(request, guard.user.id, {
    endpoint: '/api/uploads/studio-reference',
    ip: { limit: 30, windowSeconds: 60 * 60 },
    user: { limit: 15, windowSeconds: 60 * 60 },
  }, '参考图上传过于频繁，请稍后再试')
  if (limited) return limited

  let form: FormData
  try {
    form = await request.formData()
  } catch {
    return NextResponse.json({ message: '参考图上传请求无效，请重新选择图片' }, { status: 400 })
  }
  const file = form.get('file')
  if (!isMultipartFile(file)) return NextResponse.json({ message: '未收到有效的参考图文件' }, { status: 400 })
  if (file.size > MAX_FILE_SIZE) return NextResponse.json({ message: '参考图不能超过 8MB' }, { status: 400 })

  let input: Buffer
  try {
    input = Buffer.from(await file.arrayBuffer())
  } catch {
    return NextResponse.json({ message: '读取参考图失败' }, { status: 400 })
  }
  if (!input.length) return NextResponse.json({ message: '参考图内容为空' }, { status: 400 })

  let output: Buffer
  let dimensions: { width: number; height: number }
  try {
    const image = sharp(input, { failOn: 'error', limitInputPixels: MAX_INPUT_PIXELS })
    const metadata = await image.metadata()
    if (!metadata.format || !ALLOWED_FORMATS.has(metadata.format)) return NextResponse.json({ message: '参考图格式无效，仅支持 JPG / PNG / WebP / GIF 等图片' }, { status: 400 })
    output = await image
      .rotate()
      .resize({ width: MAX_OUTPUT_EDGE, height: MAX_OUTPUT_EDGE, fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 84 })
      .toBuffer()
    const outputMetadata = await sharp(output).metadata()
    dimensions = { width: outputMetadata.width || 0, height: outputMetadata.height || 0 }
  } catch {
    return NextResponse.json({ message: '参考图处理失败，请换一张图片再试' }, { status: 400 })
  }

  try {
    const key = `studio/references/${guard.user.id}/${randomUUID()}.webp`
    const url = await uploadSiteImage({ key, body: output, contentType: 'image/webp' })
    return NextResponse.json({ url: publicImageUrl(url), mimeType: 'image/webp', ...dimensions })
  } catch (error) {
    if (error instanceof SiteMediaStorageError) return NextResponse.json({ message: error.message }, { status: 502 })
    return NextResponse.json({ message: '参考图上传失败，请稍后重试' }, { status: 502 })
  }
}
