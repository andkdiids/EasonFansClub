import { randomUUID } from 'node:crypto'
import { NextResponse } from 'next/server'
import sharp from 'sharp'
import { publicImageUrl } from '@/lib/images'
import { createAnimatedImageVariants, createImageVariants, isAnimatedImageInput } from '@/lib/image-webp'
import { uploadImageVariantFamily } from '@/lib/image-variant-upload'
import { rejectInvalidRequestOrigin, enforceApiRateLimit, requireAdmin } from '@/lib/security'
import { SiteMediaStorageError, uploadSiteImage } from '@/lib/site-media-storage'

export const runtime = 'nodejs'

const MAX_FILE_SIZE = 10 * 1024 * 1024
const ALLOWED_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif'])

function imageContentType(format?: string | null) {
  if (format === 'jpeg') return 'image/jpeg'
  if (format === 'png') return 'image/png'
  if (format === 'gif') return 'image/gif'
  return 'image/webp'
}

export async function POST(request: Request) {
  const originError = rejectInvalidRequestOrigin(request)
  if (originError) return originError
  const guard = await requireAdmin('angel_gift_manage')
  if (!guard.user) return guard.response
  const limited = await enforceApiRateLimit(request, guard.user.id, {
    endpoint: '/api/admin/angel-gift/visual-image',
    ip: { limit: 30, windowSeconds: 60 * 60 },
    user: { limit: 20, windowSeconds: 60 * 60 },
  }, '主题图片上传过于频繁，请稍后再试')
  if (limited) return limited

  const formData = await request.formData().catch(() => null)
  const file = formData?.get('file')
  if (!(file instanceof File)) return NextResponse.json({ message: '请选择要上传的图片' }, { status: 400 })
  if (!ALLOWED_TYPES.has(file.type.trim().toLowerCase())) return NextResponse.json({ message: '仅支持 JPG、PNG、WebP 或 GIF 图片' }, { status: 400 })
  if (file.size < 1) return NextResponse.json({ message: '图片内容为空' }, { status: 400 })
  if (file.size > MAX_FILE_SIZE) return NextResponse.json({ message: '图片不能超过 10MB' }, { status: 400 })

  let input: Buffer
  let format: string | undefined
  let generated: Awaited<ReturnType<typeof createImageVariants>>
  try {
    input = Buffer.from(await file.arrayBuffer())
    const image = sharp(input, { animated: true, failOn: 'none', limitInputPixels: 50_000_000 })
    const metadata = await image.metadata()
    format = metadata.format
    const animated = isAnimatedImageInput(input, metadata)
    generated = animated
      ? await createAnimatedImageVariants(input, { sourceMaxWidth: 2400, variants: ['thumb-sm', 'thumb-md', 'card', 'large'] })
      : await createImageVariants(input, { sourceMaxWidth: 2400, sourceMaxHeight: 1600, sourceQuality: 84, variants: ['thumb-sm', 'thumb-md', 'card', 'large'] })
  } catch (error) {
    console.error('[angel-gift.visual-image.normalize]', { errorName: error instanceof Error ? error.name : 'UnknownError' })
    return NextResponse.json({ message: '图片处理失败，请换一张试试' }, { status: 422 })
  }

  try {
    const uploadResult = await uploadImageVariantFamily({
      sourceObjectPath: `angel-gift/${randomUUID()}/source.webp`,
      original: input,
      originalContentType: imageContentType(format),
      generated,
      upload: ({ key, body, contentType }) => uploadSiteImage({ key, body, contentType }),
    })
    const url = publicImageUrl(uploadResult.sourceUrl)
    if (!url) return NextResponse.json({ message: '图片上传结果无效，请重试' }, { status: 502 })
    return NextResponse.json({ url, mimeType: 'image/webp', format: 'webp' }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    if (!(error instanceof SiteMediaStorageError)) console.error('[angel-gift.visual-image.upload]', { errorName: error instanceof Error ? error.name : 'UnknownError' })
    return NextResponse.json({ message: '图片上传失败，请稍后重试' }, { status: 502 })
  }
}
