import { randomUUID } from 'node:crypto'
import { NextResponse } from 'next/server'
import { publicImageUrl } from '@/lib/images'
import { requireUser } from '@/lib/security'
import { FEEDBACK_ALLOWED_IMAGE_TYPES, FEEDBACK_MAX_FILE_SIZE } from '@/lib/feedback'
import { normalizeImageToWebp, ImageNormalizeError } from '@/lib/image-webp'
import { SiteMediaStorageError, uploadSiteImage } from '@/lib/site-media-storage'

export const runtime = 'nodejs'

function errorDetail(error: unknown) {
  return (error instanceof Error ? error.message : String(error || '未知错误')).slice(0, 300)
}

function developmentUploadMessage(detail: string) {
  return process.env.NODE_ENV === 'development' ? `图片上传失败：${detail}` : '图片上传失败，请稍后重试'
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

  // 统一在服务端转 WebP + 压缩，禁止原样存储 jpg/png/gif。
  let webpBuffer: Buffer
  try {
    webpBuffer = await normalizeImageToWebp(
      Buffer.from(await file.arrayBuffer()),
      { maxWidth: 1600, quality: 82 },
    )
  } catch (error) {
    if (error instanceof ImageNormalizeError) {
      return NextResponse.json({ message: error.message }, { status: 400 })
    }
    const detail = errorDetail(error)
    console.error('[feedback-image.normalize]', { ...uploadMeta, error: detail })
    return NextResponse.json({
      message: developmentUploadMessage(detail),
      ...(process.env.NODE_ENV === 'development' ? { detail } : {}),
    }, { status: 400 })
  }

  const objectPath = `feedback/${guard.user.id}/feedback-${randomUUID()}.webp`
  try {
    const uploadResult = await uploadSiteImage({ key: objectPath, body: webpBuffer, contentType: 'image/webp' })
    const url = publicImageUrl(uploadResult)
    console.log('[feedback-image.upload]', { ...uploadMeta, uploadResult })
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
