import { randomUUID } from 'node:crypto'
import { NextResponse } from 'next/server'
import sharp from 'sharp'
import { publicImageUrl } from '@/lib/images'
import { uploadSiteImage, SiteMediaStorageError } from '@/lib/site-media-storage'
import { enforceApiRateLimit, requireAdmin } from '@/lib/security'
import { createAnimatedImageVariants, createImageVariants, isAnimatedImageInput } from '@/lib/image-webp'
import { uploadImageVariantFamily } from '@/lib/image-variant-upload'

export const runtime = 'nodejs'

const maxFileSize = 10 * 1024 * 1024
const allowedTypes = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif'])

function imageContentType(format?: string | null) {
  if (format === 'jpeg') return 'image/jpeg'
  if (format === 'png') return 'image/png'
  if (format === 'gif') return 'image/gif'
  return 'image/webp'
}

async function requireSiteImageAdmin() {
  const siteConfigGuard = await requireAdmin('site_config_manage')
  if (siteConfigGuard.user) return siteConfigGuard

  const homeGuard = await requireAdmin('home_manage')
  return homeGuard.user ? homeGuard : siteConfigGuard
}

export async function POST(request: Request) {
  const guard = await requireSiteImageAdmin()
  if (!guard.user) return guard.response
  const limited = await enforceApiRateLimit(request, guard.user.id, {
    endpoint: '/api/uploads/site-image',
    ip: { limit: 40, windowSeconds: 60 * 60 },
    user: { limit: 20, windowSeconds: 60 * 60 },
  }, '图片上传过于频繁，请稍后再试')
  if (limited) return limited

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

  let input: Buffer
  let generated: Awaited<ReturnType<typeof createImageVariants>>
  try {
    input = Buffer.from(await file.arrayBuffer())
    const image = sharp(input, { animated: true, failOn: 'none', limitInputPixels: 50_000_000 })
    const metadata = await image.metadata()
    const animated = isAnimatedImageInput(input, metadata)
    generated = animated
      ? await createAnimatedImageVariants(input, {
        sourceMaxWidth: 2400,
        variants: ['thumb-sm', 'thumb-md', 'card', 'large'],
      })
      : await createImageVariants(input, {
        sourceMaxWidth: 2400,
        sourceMaxHeight: 1600,
        sourceQuality: 84,
        variants: ['thumb-sm', 'thumb-md', 'card', 'large'],
      })
  } catch (error) {
    console.error('[site-image.sharp]', { errorName: error instanceof Error ? error.name : 'UnknownError' })
    return NextResponse.json({ message: '图片转换为 WebP 失败，请检查图片后重试' }, { status: 422 })
  }

  try {
    const objectPath = `site/${randomUUID()}/source.webp`
    const metadata = await sharp(input, { animated: true, failOn: 'none', limitInputPixels: 50_000_000 }).metadata()
    const uploadResult = await uploadImageVariantFamily({
      sourceObjectPath: objectPath,
      original: input,
      originalContentType: imageContentType(metadata.format),
      generated,
      upload: ({ key, body, contentType }) => uploadSiteImage({ key, body, contentType }),
    })
    const url = publicImageUrl(uploadResult.sourceUrl)
    if (!url) return NextResponse.json({ message: '图片地址无效' }, { status: 500 })
    return NextResponse.json({ url, mimeType: 'image/webp', format: 'webp', originalSize: input.byteLength, size: generated.source.byteLength })
  } catch (error) {
    if (!(error instanceof SiteMediaStorageError)) {
      console.error('[site-image.upload]', { errorName: error instanceof Error ? error.name : 'UnknownError' })
    }
    return NextResponse.json({ message: error instanceof Error ? error.message : '图片上传失败，请稍后重试' }, { status: 502 })
  }
}
