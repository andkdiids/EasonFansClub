import { randomUUID } from 'node:crypto'
import sharp from 'sharp'
import { NextResponse } from 'next/server'
import { publicImageUrl } from '@/lib/images'
import { SiteMediaStorageError, uploadSiteImage } from '@/lib/site-media-storage'
import { requireAdmin } from '@/lib/security'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 120

const MAX_BADGE_IMAGE_BYTES = 2 * 1024 * 1024

function hasPngSignature(buffer: Buffer) {
  return buffer.length >= 8
    && buffer[0] === 0x89
    && buffer[1] === 0x50
    && buffer[2] === 0x4e
    && buffer[3] === 0x47
    && buffer[4] === 0x0d
    && buffer[5] === 0x0a
    && buffer[6] === 0x1a
    && buffer[7] === 0x0a
}

function hasWebpSignature(buffer: Buffer) {
  return buffer.length >= 12
    && buffer.subarray(0, 4).toString('ascii') === 'RIFF'
    && buffer.subarray(8, 12).toString('ascii') === 'WEBP'
}

export async function POST(request: Request) {
  const guard = await requireAdmin('achievement_manage')
  if (!guard.user) return guard.response
  const formData = await request.formData().catch(() => null)
  if (!formData) return NextResponse.json({ message: '上传请求无效' }, { status: 400 })
  const file = formData.get('file')
  if (!(file instanceof File)) return NextResponse.json({ message: '请选择 PNG 或 WebP 图片' }, { status: 400 })
  const contentType = file.type.toLowerCase()
  if (!['image/png', 'image/webp'].includes(contentType)) return NextResponse.json({ message: '只允许 PNG 或 WebP 图片' }, { status: 400 })
  const extension = file.name.split('.').pop()?.toLowerCase()
  if ((contentType === 'image/png' && extension !== 'png') || (contentType === 'image/webp' && extension !== 'webp')) return NextResponse.json({ message: '图片扩展名与 MIME 类型不一致' }, { status: 400 })
  if (file.size <= 0) return NextResponse.json({ message: '图片文件不能为空' }, { status: 400 })
  if (file.size > MAX_BADGE_IMAGE_BYTES) return NextResponse.json({ message: '勋章图片不能超过 2MB' }, { status: 413 })

  const buffer = Buffer.from(await file.arrayBuffer())
  if (contentType === 'image/png' ? !hasPngSignature(buffer) : !hasWebpSignature(buffer)) return NextResponse.json({ message: '图片内容与文件类型不一致' }, { status: 400 })
  try {
    const metadata = await sharp(buffer, { failOn: 'error', limitInputPixels: 2048 * 2048 }).metadata()
    const expectedFormat = contentType === 'image/png' ? 'png' : 'webp'
    if (metadata.format !== expectedFormat || !metadata.width || !metadata.height) return NextResponse.json({ message: '图片内容与文件类型不一致' }, { status: 400 })
    if (metadata.width > 2048 || metadata.height > 2048) return NextResponse.json({ message: '请使用不超过 2048×2048 的图片' }, { status: 400 })

    const outputExtension = expectedFormat === 'png' ? 'png' : 'webp'
    const key = `badges/${guard.user.id}/${randomUUID()}.${outputExtension}`
    const url = publicImageUrl(await uploadSiteImage({ key, body: buffer, contentType }))
    return NextResponse.json({ url, format: expectedFormat, width: metadata.width, height: metadata.height })
  } catch (error) {
    if (error instanceof SiteMediaStorageError) return NextResponse.json({ message: error.message }, { status: 502 })
    console.error('[badge-upload.invalid-image]', error)
    return NextResponse.json({ message: '图片校验或上传失败，请稍后重试' }, { status: 400 })
  }
}
