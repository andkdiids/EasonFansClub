import { randomUUID } from 'node:crypto'
import { NextResponse } from 'next/server'
import sharp from 'sharp'
import { publicImageUrl } from '@/lib/images'
import { uploadSiteImage, SiteMediaStorageError } from '@/lib/site-media-storage'
import { requireAdmin } from '@/lib/security'

export const runtime = 'nodejs'

const maxFileSize = 10 * 1024 * 1024
const allowedTypes = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif'])

async function requireSiteImageAdmin() {
  const siteConfigGuard = await requireAdmin('site_config_manage')
  if (siteConfigGuard.user) return siteConfigGuard

  const homeGuard = await requireAdmin('home_manage')
  return homeGuard.user ? homeGuard : siteConfigGuard
}

export async function POST(request: Request) {
  const guard = await requireSiteImageAdmin()
  if (!guard.user) return guard.response

  const formData = await request.formData().catch(() => null)
  const file = formData?.get('file')
  if (!(file instanceof File)) {
    return NextResponse.json({ message: '请选择要上传的图片' }, { status: 400 })
  }
  if (!allowedTypes.has(file.type)) {
    return NextResponse.json({ message: '仅支持 JPG、PNG、WebP 或 GIF 图片' }, { status: 400 })
  }
  if (file.size > maxFileSize) {
    return NextResponse.json({ message: '图片不能超过 10MB' }, { status: 400 })
  }

  let output: Buffer
  try {
    output = await sharp(Buffer.from(await file.arrayBuffer()), { failOn: 'none', limitInputPixels: 50_000_000 })
      .rotate()
      .resize({ width: 2400, height: 1600, fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 84 })
      .toBuffer()
  } catch (error) {
    console.error('[site-image.sharp]', error)
    return NextResponse.json({ message: '图片转换为 WebP 失败，请检查图片后重试' }, { status: 422 })
  }

  try {
    const objectPath = `site/${randomUUID()}.webp`
    const url = publicImageUrl(await uploadSiteImage({ key: objectPath, body: output }))
    if (!url) return NextResponse.json({ message: '图片地址无效' }, { status: 500 })
    return NextResponse.json({ url, mimeType: 'image/webp', format: 'webp' })
  } catch (error) {
    if (!(error instanceof SiteMediaStorageError)) console.error('[site-image.upload]', error)
    return NextResponse.json({ message: error instanceof Error ? error.message : '图片上传失败，请稍后重试' }, { status: 502 })
  }
}
