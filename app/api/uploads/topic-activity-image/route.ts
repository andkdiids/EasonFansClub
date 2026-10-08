import { randomUUID } from 'node:crypto'
import { NextResponse } from 'next/server'
import { rejectInvalidRequestOrigin, requireRequestUser, enforceApiRateLimit } from '@/lib/security'
import { hasAdminPermission } from '@/lib/admin-permissions'
import { SiteMediaStorageError, uploadPrivateSiteImage } from '@/lib/site-media-storage'
import { deleteFromCos } from '@/lib/tencent-cos'
import { validateContentImageFileMetadata } from '@/lib/content-image-upload'
import { serializeTopicActivityAsset } from '@/lib/topic-activity-assets'
import {
  createTopicActivityImageDerivative,
  topicActivityOriginalObjectKey,
  TOPIC_ACTIVITY_IMAGE_MAX_FILE_SIZE,
  TOPIC_ACTIVITY_IMAGE_TOO_LARGE_MESSAGE,
} from '@/lib/topic-activity-image-original'
import { prisma } from '@/lib/prisma'
import { normalizeTopicActivityFormSchema } from '@/lib/topic-activity-form'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function jsonError(code: string, message: string, status = 400) {
  return NextResponse.json({ code, message }, { status, headers: { 'Cache-Control': 'private, no-store, max-age=0' } })
}

function isFile(value: FormDataEntryValue | null): value is File {
  return Boolean(value && typeof value !== 'string' && typeof value.size === 'number' && typeof value.arrayBuffer === 'function')
}

export async function POST(request: Request) {
  const invalidOrigin = rejectInvalidRequestOrigin(request)
  if (invalidOrigin) return invalidOrigin
  const userGuard = await requireRequestUser(request)
  if (!userGuard.user) return userGuard.response ?? jsonError('UNAUTHORIZED', '请先登录', 401)
  const user = userGuard.user
  const limited = await enforceApiRateLimit(request, user.id, {
    endpoint: '/api/uploads/topic-activity-image', ip: { limit: 40, windowSeconds: 60 * 60 }, user: { limit: 20, windowSeconds: 60 * 60 },
  }, '图片上传过于频繁，请稍后再试')
  if (limited !== null) return limited

  const contentLength = Number(request.headers.get('content-length'))
  if (Number.isFinite(contentLength) && contentLength > TOPIC_ACTIVITY_IMAGE_MAX_FILE_SIZE + 1024 * 1024) {
    return jsonError('FILE_TOO_LARGE', TOPIC_ACTIVITY_IMAGE_TOO_LARGE_MESSAGE, 413)
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
  // V6 intentionally rejects oversized originals instead of silently
  // compressing them: 图片过大，请选择较小原图。
  if (!metadataValidation.ok) return jsonError(metadataValidation.code, metadataValidation.code === 'FILE_TOO_LARGE' ? TOPIC_ACTIVITY_IMAGE_TOO_LARGE_MESSAGE : metadataValidation.message, metadataValidation.code === 'FILE_TOO_LARGE' ? 413 : 400)
  if (file.size > TOPIC_ACTIVITY_IMAGE_MAX_FILE_SIZE) return jsonError('FILE_TOO_LARGE', TOPIC_ACTIVITY_IMAGE_TOO_LARGE_MESSAGE, 413)

  const activity = await prisma.activity.findUnique({ where: { id: activityId }, select: { id: true, type: true, status: true, startsAt: true, endsAt: true, participationMode: true, allowImageAttachments: true, formSchema: true } })
  if (!activity || activity.type !== 'TOPIC_ACTIVITY') return jsonError('ACTIVITY_NOT_FOUND', '话题活动不存在', 404)
  if (purpose === 'FORM_ANSWER') {
    const schema = normalizeTopicActivityFormSchema(activity.formSchema)
    const hasImageField = schema.valid && schema.value.fields.some((field) => field.type === 'IMAGE')
    if ((!activity.allowImageAttachments && !hasImageField) || !['FORM', 'BOTH'].includes(activity.participationMode)) return jsonError('IMAGES_DISABLED', '该活动暂不接受表单图片', 403)
    const now = new Date()
    if (activity.status !== 'PUBLISHED' || (activity.startsAt && activity.startsAt > now) || (activity.endsAt && activity.endsAt < now)) return jsonError('FORM_CLOSED', '当前不在表单参与时间内', 409)
  } else {
    if (!await hasAdminPermission(user, 'activity_manage')) return jsonError('FORBIDDEN', '无权上传管理员回复图片', 403)
  }

  let original: Buffer
  try { original = Buffer.from(await file.arrayBuffer()) } catch { return jsonError('INVALID_FILE', '读取图片失败') }
  if (!original.byteLength) return jsonError('EMPTY_FILE', '请选择图片')

  let derivative: Awaited<ReturnType<typeof createTopicActivityImageDerivative>>
  try {
    // Sharp decodes the actual byte stream; client MIME and filename are hints only.
    derivative = await createTopicActivityImageDerivative(original, file.name, file.type)
  } catch (error) {
    if (error instanceof Error && error.message === 'UNSUPPORTED_FORMAT') return jsonError('UNSUPPORTED_FORMAT', '图片格式不受支持或文件已损坏')
    return jsonError('IMAGE_PROCESSING_FAILED', '图片无法解码或处理，请重新选择')
  }

  const objectPath = topicActivityOriginalObjectKey({ activityId: activity.id, purpose, uploadId: randomUUID(), filename: file.name, format: derivative.format })
  const previewKey = objectPath.replace(/\/original-[^/]+$/u, '/preview.webp')
  const thumbnailKey = objectPath.replace(/\/original-[^/]+$/u, '/thumb-md.webp')
  const uploadedKeys = [objectPath, previewKey, thumbnailKey]
  try {
    await uploadPrivateSiteImage({ key: objectPath, body: original, contentType: derivative.mimeType })
    await uploadPrivateSiteImage({ key: previewKey, body: derivative.preview, contentType: 'image/webp' })
    await uploadPrivateSiteImage({ key: thumbnailKey, body: derivative.thumbnail, contentType: 'image/webp' })
    try {
      const asset = await prisma.topicActivityImageAsset.create({
        data: {
          activityId: activity.id,
          uploadedByUserId: user.id,
          purpose,
          storageKey: objectPath,
          mimeType: derivative.mimeType,
          width: Math.max(1, Math.round(derivative.width)),
          height: Math.max(1, Math.round(derivative.height)),
          size: original.byteLength,
        },
      })
      return NextResponse.json({ asset: serializeTopicActivityAsset(asset) }, { status: 201, headers: { 'Cache-Control': 'private, no-store, max-age=0' } })
    } catch (error) {
      await Promise.allSettled(uploadedKeys.map((key) => deleteFromCos(key)))
      throw error
    }
  } catch (error) {
    // If a derivative upload failed before the DB row exists, clean every
    // private object that this request may have created.
    await Promise.allSettled(uploadedKeys.map((key) => deleteFromCos(key)))
    console.error('[topic-activity.image-upload.failed]', { activityId, purpose, error: error instanceof Error ? error.name : 'UNKNOWN' })
    return NextResponse.json({ code: 'UPLOAD_FAILED', message: error instanceof SiteMediaStorageError ? error.message : '图片上传失败，请稍后重试' }, { status: 502, headers: { 'Cache-Control': 'private, no-store, max-age=0' } })
  }
}
