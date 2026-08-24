import { randomUUID } from 'node:crypto'
import { NextResponse } from 'next/server'
import sharp, { type Metadata } from 'sharp'
import { activityImageContentType, ACTIVITY_IMAGE_MAX_FILE_SIZE, isActivityImageMimeType } from '@/lib/activity-image'
import { publicImageUrl } from '@/lib/images'
import { enforceApiRateLimit, requireAdmin } from '@/lib/security'
import { SiteMediaStorageError, uploadSiteImage } from '@/lib/site-media-storage'
import { createImageVariants, ImageNormalizeError } from '@/lib/image-webp'
import { uploadImageVariantFamily } from '@/lib/image-variant-upload'

export const runtime = 'nodejs'

export async function POST(request: Request) {
  const guard = await requireAdmin('activity_manage')
  if (!guard.user) return guard.response
  const limited = await enforceApiRateLimit(request, guard.user.id, {
    endpoint: '/api/uploads/activity-image',
    ip: { limit: 30, windowSeconds: 60 * 60 },
    user: { limit: 20, windowSeconds: 60 * 60 },
  }, '活动图片上传过于频繁，请稍后再试')
  if (limited) return limited

  const formData = await request.formData().catch(() => null)
  const file = formData?.get('file')
  if (!(file instanceof File)) return NextResponse.json({ message: '请选择要上传的图片' }, { status: 400 })
  const mimeType = file.type.trim().toLowerCase()
  if (!isActivityImageMimeType(mimeType)) return NextResponse.json({ message: '仅支持 JPG、PNG 或 WebP 图片' }, { status: 400 })
  if (file.size < 1) return NextResponse.json({ message: '图片内容为空' }, { status: 400 })
  if (file.size > ACTIVITY_IMAGE_MAX_FILE_SIZE) return NextResponse.json({ message: '活动图片不能超过 5MB' }, { status: 400 })

  let input: Buffer
  let metadata: Metadata
  let generated: Awaited<ReturnType<typeof createImageVariants>>
  try {
    input = Buffer.from(await file.arrayBuffer())
    const image = sharp(input, { failOn: 'error', limitInputPixels: 30_000_000 })
    metadata = await image.metadata()
    if (!metadata.format || !['jpeg', 'png', 'webp'].includes(metadata.format)) {
      return NextResponse.json({ message: '图片内容格式与文件扩展名不一致' }, { status: 400 })
    }
    generated = await createImageVariants(input, {
      sourceMaxWidth: 1600,
      sourceMaxHeight: 1400,
      sourceQuality: 84,
      variants: ['thumb-md', 'card', 'large'],
    })
  } catch (error) {
    if (!(error instanceof ImageNormalizeError)) console.error('[activity-image.normalize]', { errorName: error instanceof Error ? error.name : 'UnknownError' })
    return NextResponse.json({ message: '图片处理失败，请换一张试试' }, { status: 400 })
  }

  try {
    const uploadResult = await uploadImageVariantFamily({
      sourceObjectPath: `activities/${randomUUID()}/source.webp`,
      original: input,
      originalContentType: activityImageContentType(metadata.format),
      generated,
      upload: ({ key, body, contentType }) => uploadSiteImage({ key, body, contentType }),
    })
    const url = publicImageUrl(uploadResult.sourceUrl)
    if (!url) return NextResponse.json({ message: '图片上传结果无效，请重试' }, { status: 502 })
    return NextResponse.json({ url, mimeType: 'image/webp', format: 'webp' })
  } catch (error) {
    if (!(error instanceof SiteMediaStorageError)) console.error('[activity-image.upload]', { errorName: error instanceof Error ? error.name : 'UnknownError' })
    return NextResponse.json({ message: '图片上传失败，请稍后重试' }, { status: 502 })
  }
}
