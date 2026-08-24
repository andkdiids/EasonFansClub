import { randomUUID } from 'node:crypto'
import sharp from 'sharp'
import { NextResponse } from 'next/server'
import { uploadSiteImage, SiteMediaStorageError } from '@/lib/site-media-storage'
import { rejectInvalidRequestOrigin, requireAdmin } from '@/lib/security'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 120

const MAX_IMAGE_BYTES = 8 * 1024 * 1024

export async function POST(request: Request) {
  const originError = rejectInvalidRequestOrigin(request)
  if (originError) return originError
  const guard = await requireAdmin('material_redemption_manage')
  if (!guard.user) return guard.response
  const formData = await request.formData().catch(() => null)
  const file = formData?.get('file')
  if (!(file instanceof File)) return NextResponse.json({ ok: false, message: '请选择图片' }, { status: 400 })
  if (file.size <= 0 || file.size > MAX_IMAGE_BYTES) return NextResponse.json({ ok: false, message: '图片大小必须在 1B 至 8MB 之间' }, { status: 413 })
  try {
    const input = Buffer.from(await file.arrayBuffer())
    const image = sharp(input, { failOn: 'error', limitInputPixels: 4096 * 4096 })
    const metadata = await image.metadata()
    if (!metadata.width || !metadata.height || !metadata.format || !['jpeg', 'png', 'webp', 'gif', 'avif'].includes(metadata.format)) return NextResponse.json({ ok: false, message: '只允许 JPG、PNG、WebP、GIF 或 AVIF 图片' }, { status: 400 })
    if (metadata.width > 4096 || metadata.height > 4096) return NextResponse.json({ ok: false, message: '图片尺寸不能超过 4096×4096' }, { status: 400 })
    const output = await image.rotate().resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true }).webp({ quality: 84 }).toBuffer()
    const url = await uploadSiteImage({ key: `material-redemptions/${randomUUID()}.webp`, body: output, contentType: 'image/webp' })
    return NextResponse.json({ ok: true, url })
  } catch (error) {
    if (error instanceof SiteMediaStorageError) return NextResponse.json({ ok: false, message: error.message }, { status: 502 })
    console.error('[admin.material-redemption.upload]', error)
    return NextResponse.json({ ok: false, message: '图片处理失败，请重试' }, { status: 400 })
  }
}
