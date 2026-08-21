import { randomUUID } from 'node:crypto'
import sharp from 'sharp'
import { NextResponse } from 'next/server'
import { publicImageUrl } from '@/lib/images'
import { SiteMediaStorageError, uploadSiteImage } from '@/lib/site-media-storage'
import { requireAdmin } from '@/lib/security'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 120

const MAX_BADGE_PNG_BYTES = 2 * 1024 * 1024

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

export async function POST(request: Request) {
  const guard = await requireAdmin('achievement_manage')
  if (!guard.user) return guard.response
  const formData = await request.formData().catch(() => null)
  if (!formData) return NextResponse.json({ message: '上传请求无效' }, { status: 400 })
  const file = formData.get('file')
  if (!(file instanceof File)) return NextResponse.json({ message: '请选择 PNG 图片' }, { status: 400 })
  if (file.type.toLowerCase() !== 'image/png') return NextResponse.json({ message: '只允许 MIME 类型为 image/png 的文件' }, { status: 400 })
  if (file.size <= 0) return NextResponse.json({ message: '图片文件不能为空' }, { status: 400 })
  if (file.size > MAX_BADGE_PNG_BYTES) return NextResponse.json({ message: '勋章 PNG 不能超过 2MB' }, { status: 413 })

  const buffer = Buffer.from(await file.arrayBuffer())
  if (!hasPngSignature(buffer)) return NextResponse.json({ message: '图片内容不是有效 PNG' }, { status: 400 })
  try {
    const metadata = await sharp(buffer, { failOn: 'error', limitInputPixels: 2048 * 2048 }).metadata()
    if (metadata.format !== 'png' || !metadata.width || !metadata.height) return NextResponse.json({ message: '图片内容不是有效 PNG' }, { status: 400 })
    if (metadata.width > 2048 || metadata.height > 2048) return NextResponse.json({ message: '建议使用不超过 2048×2048 的 PNG' }, { status: 400 })

    const key = `badges/${guard.user.id}/${randomUUID()}.png`
    const url = publicImageUrl(await uploadSiteImage({ key, body: buffer, contentType: 'image/png' }))
    return NextResponse.json({ url, format: 'png', width: metadata.width, height: metadata.height })
  } catch (error) {
    if (error instanceof SiteMediaStorageError) return NextResponse.json({ message: error.message }, { status: 502 })
    console.error('[badge-upload.invalid-png]', error)
    return NextResponse.json({ message: 'PNG 校验或上传失败，请稍后重试' }, { status: 400 })
  }
}
