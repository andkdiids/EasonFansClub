import { randomUUID } from 'node:crypto'
import { NextResponse } from 'next/server'
import sharp from 'sharp'
import { publicImageUrl } from '@/lib/images'
import { requireUser } from '@/lib/security'
import { FEEDBACK_ALLOWED_IMAGE_TYPES, FEEDBACK_MAX_FILE_SIZE } from '@/lib/feedback'
import { createAnimatedImageVariants, createImageVariants, isAnimatedImageInput } from '@/lib/image-webp'
import { uploadImageVariantFamily } from '@/lib/image-variant-upload'
import { SiteMediaStorageError, uploadSiteImage } from '@/lib/site-media-storage'

export const runtime = 'nodejs'

function errorDetail(error: unknown) {
  return (error instanceof Error ? error.message : String(error || '未知错误')).slice(0, 300)
}

function developmentUploadMessage(detail: string) {
  return process.env.NODE_ENV === 'development' ? `图片上传失败：${detail}` : '图片上传失败，请稍后重试'
}

function imageContentType(format?: string | null) {
  if (format === 'jpeg') return 'image/jpeg'
  if (format === 'png') return 'image/png'
  if (format === 'gif') return 'image/gif'
  return 'image/webp'
}

export async function POST(request: Request) {
  const guard = await requireUser()
  if (!guard.user) return guard.response

  const formData = await request.formData().catch(() => null)
  const file = formData?.get('file')
  if (!(file instanceof File)) {
    return NextResponse.json({ message: '请选择要上传的图片' }, { status: 400 })
  }

  if (!FEEDBACK_ALLOWED_IMAGE_TYPES.includes(file.type as typeof FEEDBACK_ALLOWED_IMAGE_TYPES[number])) {
    return NextResponse.json({ message: '不支持的图片格式' }, { status: 400 })
  }
  if (file.size > FEEDBACK_MAX_FILE_SIZE) {
    return NextResponse.json({ message: '单张图片不能超过 10MB' }, { status: 400 })
  }

  const uploadMeta = { filename: file.name, size: file.size, type: file.type }

  let input: Buffer
  let generated: Awaited<ReturnType<typeof createImageVariants>>
  let originalContentType = 'image/webp'
  try {
    input = Buffer.from(await file.arrayBuffer())
    const image = sharp(input, { animated: true, failOn: 'none', limitInputPixels: 100_000_000 })
    const metadata = await image.metadata()
    originalContentType = imageContentType(metadata.format)
    const animated = isAnimatedImageInput(input, metadata)
    generated = animated
      ? await createAnimatedImageVariants(input, { sourceMaxWidth: 1600, variants: ['thumb-md', 'card', 'large'] })
      : await createImageVariants(input, { sourceMaxWidth: 1600, sourceQuality: 82, variants: ['thumb-md', 'card', 'large'] })
  } catch (error) {
    const detail = errorDetail(error)
    console.error('[feedback-image.normalize]', { ...uploadMeta, error: detail })
    return NextResponse.json({
      message: developmentUploadMessage(detail),
      ...(process.env.NODE_ENV === 'development' ? { detail } : {}),
    }, { status: 400 })
  }

  const objectPath = `feedback/${guard.user.id}/feedback-${randomUUID()}/source.webp`
  try {
    const family = await uploadImageVariantFamily({
      sourceObjectPath: objectPath,
      original: input,
      originalContentType,
      generated,
      upload: ({ key, body, contentType }) => uploadSiteImage({ key, body, contentType }),
    })
    const url = publicImageUrl(family.sourceUrl)
    console.log('[feedback-image.upload]', { ...uploadMeta, uploadResult: family.sourceUrl })
    if (!url) {
      return NextResponse.json({ message: '图片 URL 无效' }, { status: 500 })
    }
    return NextResponse.json({ url, mimeType: 'image/webp' })
  } catch (error) {
    const detail = error instanceof SiteMediaStorageError ? error.detail || error.message : errorDetail(error)
    console.error('[feedback-image.upload]', { ...uploadMeta, uploadResult: 'failed', error: detail })
    return NextResponse.json({
      message: developmentUploadMessage(detail),
      ...(process.env.NODE_ENV === 'development' ? { detail } : {}),
    }, { status: 502 })
  }
}
