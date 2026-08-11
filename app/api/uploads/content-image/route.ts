import { randomUUID } from 'node:crypto'
import sharp from 'sharp'
import { NextResponse } from 'next/server'
import { requireUser } from '@/lib/security'
import { uploadSiteImage, SiteMediaStorageError } from '@/lib/site-media-storage'

export const runtime = 'nodejs'

const CONTENT_IMAGE_MAX_WIDTH = 1600
const CONTENT_IMAGE_QUALITY = 82
const CONTENT_IMAGE_MAX_FILE_SIZE = 8 * 1024 * 1024 // 8MB（原始上传上限）
// 服务端以 sharp 实际解码出的格式为准，不依赖浏览器上报的 MIME（可能异常/为空）。
// 注意：sharp 的 metadata.format 为 'jpeg'/'png'/'webp'/'gif' 等，不以 'image' 开头。
const ALLOWED_IMAGE_FORMATS = new Set(['jpeg', 'png', 'webp', 'gif', 'avif'])

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

  let form: FormData | null = null
  try {
    form = await request.formData()
  } catch {
    return NextResponse.json({ message: '图片上传请求无效，请重新选择图片' }, { status: 400 })
  }
  const file = form?.get('file')
  if (file === null || typeof file === 'string') {
    return NextResponse.json({ message: '未收到图片文件' }, { status: 400 })
  }
  if (!isMultipartFile(file)) {
    return NextResponse.json({ message: '图片文件无效，请重新选择图片' }, { status: 400 })
  }
  if (file.size > CONTENT_IMAGE_MAX_FILE_SIZE) {
    return NextResponse.json({ message: '图片不能超过 8MB' }, { status: 400 })
  }

  let buffer: Buffer
  try {
    buffer = Buffer.from(await file.arrayBuffer())
  } catch {
    return NextResponse.json({ message: '读取图片失败' }, { status: 400 })
  }
  if (buffer.byteLength === 0) {
    return NextResponse.json({ message: '图片内容为空' }, { status: 400 })
  }

  // 统一在服务端用 sharp 转 WebP，避免前端 tampering 与多端不一致。
  // 真实格式由 sharp 解码后白名单校验，而非信任浏览器 MIME，避免 MIME 异常误判。
  let webp: Buffer
  try {
    const image = sharp(buffer, { failOn: 'none', limitInputPixels: 100_000_000 })
    const metadata = await image.metadata()
    const format = metadata.format
    if (!format || !ALLOWED_IMAGE_FORMATS.has(format)) {
      return NextResponse.json(
        { message: '图片格式无效，仅支持 JPG / PNG / WebP / GIF 等常见图片格式' },
        { status: 400 },
      )
    }
    webp = await image
      .rotate()
      .resize({ width: CONTENT_IMAGE_MAX_WIDTH, withoutEnlargement: true })
      .webp({ quality: CONTENT_IMAGE_QUALITY })
      .toBuffer()
  } catch {
    return NextResponse.json({ message: '图片处理失败，请换一张试试' }, { status: 400 })
  }

  const objectPath = `content/${guard.user.id}/${randomUUID()}.webp`
  try {
    const url = await uploadSiteImage({ key: objectPath, body: webp, contentType: 'image/webp' })
    return NextResponse.json({ url, mimeType: 'image/webp' })
  } catch (error) {
    if (error instanceof SiteMediaStorageError) {
      return NextResponse.json({ message: error.message }, { status: 502 })
    }
    return NextResponse.json({ message: '图片上传失败，请稍后重试' }, { status: 502 })
  }
}
