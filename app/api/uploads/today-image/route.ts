import { randomUUID } from 'node:crypto'
import { NextResponse } from 'next/server'
import sharp, { type Metadata } from 'sharp'
import { publicImageUrl } from '@/lib/images'
import { enforceApiRateLimit, requireAdmin, requireUser } from '@/lib/security'
import { SiteMediaStorageError, uploadSiteImage } from '@/lib/site-media-storage'
import { createAnimatedImageVariants, createImageVariants, ImageNormalizeError, isAnimatedImageInput } from '@/lib/image-webp'
import { uploadImageVariantFamily } from '@/lib/image-variant-upload'
import { TODAY_IMAGE_MAX_FILE_SIZE, isTodayImageMimeType } from '@/lib/today-image'

export const runtime = 'nodejs'

function imageContentType(format?: string | null) {
  if (format === 'jpeg') return 'image/jpeg'
  if (format === 'png') return 'image/png'
  if (format === 'gif') return 'image/gif'
  return 'image/webp'
}

export async function POST(request: Request) {
  const scope = new URL(request.url).searchParams.get('scope')
  const guard = scope === 'admin' ? await requireAdmin('today_manage') : await requireUser()
  if (!guard.user) return guard.response
  const limited = await enforceApiRateLimit(request, guard.user.id, {
    endpoint: '/api/uploads/today-image',
    ip: { limit: 40, windowSeconds: 60 * 60 },
    user: { limit: 20, windowSeconds: 60 * 60 },
  }, '图片上传过于频繁，请稍后再试')
  if (limited) return limited

  const formData = await request.formData().catch(() => null)
  const file = formData?.get('file')
  if (!(file instanceof File)) return NextResponse.json({ message: '请选择要上传的图片' }, { status: 400 })

  const mimeType = file.type.trim().toLowerCase()
  if (!isTodayImageMimeType(mimeType)) return NextResponse.json({ message: '仅支持常见图片格式' }, { status: 400 })
  if (file.size < 1) return NextResponse.json({ message: '图片内容为空' }, { status: 400 })
  if (file.size > TODAY_IMAGE_MAX_FILE_SIZE) return NextResponse.json({ message: '图片不能超过 10MB' }, { status: 400 })

  let input: Buffer
  let metadata: Metadata
  let generated: Awaited<ReturnType<typeof createImageVariants>>
  try {
    input = Buffer.from(await file.arrayBuffer())
    const image = sharp(input, { animated: true, failOn: 'none', limitInputPixels: 30_000_000 })
    metadata = await image.metadata()
    const animated = isAnimatedImageInput(input, metadata)
    generated = animated
      ? await createAnimatedImageVariants(input, { sourceMaxWidth: 2000, variants: ['thumb-md', 'card', 'large'] })
      : await createImageVariants(input, { sourceMaxWidth: 2000, sourceMaxHeight: 1400, sourceQuality: 84, variants: ['thumb-md', 'card', 'large'] })
  } catch (error) {
    if (!(error instanceof ImageNormalizeError)) {
      console.error('[today-image.normalize]', { errorName: error instanceof Error ? error.name : 'UnknownError' })
    }
    return NextResponse.json({ message: '图片处理失败，请换一张试试' }, { status: 400 })
  }

  try {
    const uploadResult = await uploadImageVariantFamily({
      sourceObjectPath: `today/${guard.user.id}/${randomUUID()}/source.webp`,
      original: input,
      originalContentType: imageContentType(metadata.format),
      generated,
      upload: ({ key, body, contentType }) => uploadSiteImage({ key, body, contentType }),
    })
    const url = publicImageUrl(uploadResult.sourceUrl)
    if (!url) return NextResponse.json({ message: '图片上传结果无效，请重试' }, { status: 502 })
    return NextResponse.json({ url, mimeType: 'image/webp', format: 'webp' })
  } catch (error) {
    if (!(error instanceof SiteMediaStorageError)) {
      console.error('[today-image.upload]', { errorName: error instanceof Error ? error.name : 'UnknownError' })
    }
    return NextResponse.json({ message: '图片上传失败，请稍后重试' }, { status: 502 })
  }
}
