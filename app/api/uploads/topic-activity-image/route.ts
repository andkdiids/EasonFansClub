import { randomUUID } from 'node:crypto'
import sharp, { type Metadata } from 'sharp'
import { NextResponse } from 'next/server'
import { requireRequestUser, enforceApiRateLimit } from '@/lib/security'
import { hasAdminPermission } from '@/lib/admin-permissions'
import { SiteMediaStorageError, uploadPrivateSiteImage } from '@/lib/site-media-storage'
import { createAnimatedImageVariants, createImageVariants, isAnimatedImageInput } from '@/lib/image-webp'
import { uploadImageVariantFamily } from '@/lib/image-variant-upload'
import { deleteFromCos } from '@/lib/tencent-cos'
import { imageVariantObjectPath } from '@/lib/image-variants'
import { CONTENT_IMAGE_MAX_FILE_SIZE, validateContentImageFileMetadata } from '@/lib/content-image-upload'
import { serializeTopicActivityAsset } from '@/lib/topic-activity-assets'
import { prisma } from '@/lib/prisma'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const allowedFormats = new Set(['jpeg', 'png', 'webp', 'gif', 'avif', 'heif'])

function jsonError(code: string, message: string, status = 400) {
  return NextResponse.json({ code, message }, { status, headers: { 'Cache-Control': 'private, no-store, max-age=0' } })
}

function isFile(value: FormDataEntryValue | null): value is File {
  return Boolean(value && typeof value !== 'string' && typeof value.size === 'number' && typeof value.arrayBuffer === 'function')
}

function actualMime(format: string) {
  if (format === 'jpeg') return 'image/jpeg'
  if (format === 'png') return 'image/png'
  if (format === 'gif') return 'image/gif'
  if (format === 'avif') return 'image/avif'
  return 'image/webp'
}

export async function POST(request: Request) {
  const userGuard = await requireRequestUser(request)
  if (!userGuard.user) return userGuard.response ?? jsonError('UNAUTHORIZED', '请先登录', 401)
  const user = userGuard.user
  const limited = await enforceApiRateLimit(request, user.id, {
    endpoint: '/api/uploads/topic-activity-image', ip: { limit: 40, windowSeconds: 60 * 60 }, user: { limit: 20, windowSeconds: 60 * 60 },
  }, '图片上传过于频繁，请稍后再试')
  if (limited !== null) return limited

  const contentLength = Number(request.headers.get('content-length'))
  if (Number.isFinite(contentLength) && contentLength > CONTENT_IMAGE_MAX_FILE_SIZE + 1024 * 1024) {
    return jsonError('FILE_TOO_LARGE', '单张图片不能超过 20MB', 413)
  }
  const contentType = request.headers.get('content-type') || ''
  if (!/^multipart\/form-data\s*(?:;|$)/i.test(contentType)) return jsonError('INVALID_MULTIPART', '请选择图片后重试')
  let form: FormData
  try { form = await request.formData() } catch { return jsonError('INVALID_MULTIPART', '图片上传请求无效') }
  const activityId = String(form.get('activityId') || '').trim()
  const purpose = String(form.get('purpose') || '')
  const file = form.get('file')
  if (!/^[A-Za-z0-9_-]{8,128}$/.test(activityId)) return jsonError('ACTIVITY_NOT_FOUND', '活动不存在', 404)
  if (purpose !== 'FORM_ANSWER' && purpose !== 'ADMIN_REPLY') return jsonError('INVALID_PURPOSE', '图片用途无效')
  if (!isFile(file)) return jsonError('FILE_REQUIRED', '请选择图片')
  const metadataValidation = validateContentImageFileMetadata(file)
  if (!metadataValidation.ok) return jsonError(metadataValidation.code, metadataValidation.message, metadataValidation.code === 'FILE_TOO_LARGE' ? 413 : 400)
  if (file.size > CONTENT_IMAGE_MAX_FILE_SIZE) return jsonError('FILE_TOO_LARGE', '单张图片不能超过 20MB', 413)

  const activity = await prisma.activity.findUnique({ where: { id: activityId }, select: { id: true, type: true, status: true, startsAt: true, endsAt: true, participationMode: true, allowImageAttachments: true } })
  if (!activity || activity.type !== 'TOPIC_ACTIVITY') return jsonError('ACTIVITY_NOT_FOUND', '话题活动不存在', 404)
  if (purpose === 'FORM_ANSWER') {
    if (!activity.allowImageAttachments || !['FORM', 'BOTH'].includes(activity.participationMode)) return jsonError('IMAGES_DISABLED', '该活动暂不接受表单图片', 403)
    const now = new Date()
    if (activity.status !== 'PUBLISHED' || (activity.startsAt && activity.startsAt > now) || (activity.endsAt && activity.endsAt < now)) return jsonError('FORM_CLOSED', '当前不在表单参与时间内', 409)
  } else {
    if (!await hasAdminPermission(user, 'activity_manage')) return jsonError('FORBIDDEN', '无权上传管理员回复图片', 403)
  }

  let original: Buffer
  try { original = Buffer.from(await file.arrayBuffer()) } catch { return jsonError('INVALID_FILE', '读取图片失败') }
  if (!original.byteLength) return jsonError('EMPTY_FILE', '请选择图片')

  let metadata: Metadata
  let generated: Awaited<ReturnType<typeof createImageVariants>>
  let format: string | null = null
  let sourceWidth = 1
  let sourceHeight = 1
  try {
    // Sharp decodes the actual byte stream; client MIME and filename are hints only.
    const image = sharp(original, { animated: true, failOn: 'error', limitInputPixels: 100_000_000 })
    metadata = await image.metadata()
    format = metadata.format || null
    if (!format || !allowedFormats.has(format) || !metadata.width || !metadata.height) return jsonError('UNSUPPORTED_FORMAT', '图片格式不受支持或文件已损坏')
    sourceWidth = metadata.width
    sourceHeight = metadata.height
    const animated = isAnimatedImageInput(original, metadata)
    generated = animated
      ? await createAnimatedImageVariants(original, { sourceMaxWidth: 1600, sourceQuality: 82, variants: ['thumb-md', 'card', 'large'] })
      : await createImageVariants(original, { sourceMaxWidth: 1600, sourceQuality: 82, variants: ['thumb-md', 'card', 'large'] })
  } catch {
    return jsonError('IMAGE_PROCESSING_FAILED', '图片无法解码或处理，请重新选择')
  }

  const folder = purpose === 'FORM_ANSWER' ? 'submissions' : 'replies'
  const objectPath = `topic-activity/${activity.id}/${folder}/${randomUUID()}/source.webp`
  try {
    const uploaded = await uploadImageVariantFamily({
      sourceObjectPath: objectPath,
      original,
      originalContentType: actualMime(format!),
      preserveOriginal: false,
      generated,
      upload: async ({ key, body, contentType: imageType }) => {
        await uploadPrivateSiteImage({ key, body, contentType: imageType })
        return key
      },
      remove: deleteFromCos,
    })
    try {
      const asset = await prisma.topicActivityImageAsset.create({
        data: {
          activityId: activity.id,
          uploadedByUserId: user.id,
          purpose,
          storageKey: uploaded.sourceObjectKey,
          mimeType: 'image/webp',
          width: Math.max(1, Math.round(sourceWidth)),
          height: Math.max(1, Math.round(sourceHeight)),
          size: generated.source.byteLength,
        },
      })
      return NextResponse.json({ asset: serializeTopicActivityAsset(asset) }, { status: 201, headers: { 'Cache-Control': 'private, no-store, max-age=0' } })
    } catch (error) {
      const keys = [uploaded.sourceObjectKey, ...Object.values(uploaded.variantObjectKeys).filter((key): key is string => Boolean(key)), ...Object.keys(generated.variants).map((variant) => imageVariantObjectPath(uploaded.sourceObjectKey, variant as 'thumb-md' | 'card' | 'large'))]
      await Promise.allSettled([...new Set(keys)].map((key) => deleteFromCos(key)))
      throw error
    }
  } catch (error) {
    console.error('[topic-activity.image-upload.failed]', { activityId, purpose, error: error instanceof Error ? error.name : 'UNKNOWN' })
    return NextResponse.json({ code: 'UPLOAD_FAILED', message: error instanceof SiteMediaStorageError ? error.message : '图片上传失败，请稍后重试' }, { status: 502, headers: { 'Cache-Control': 'private, no-store, max-age=0' } })
  }
}
