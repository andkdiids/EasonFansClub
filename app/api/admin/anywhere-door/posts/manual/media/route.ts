import { createHash, randomUUID } from 'node:crypto'
import { NextResponse } from 'next/server'
import sharp from 'sharp'
import { ANYWHERE_DOOR_TARGET, buildInstagramMediaStorageKey, getAnywhereDoorConfig, getAnywhereDoorStorageMode } from '@/lib/anywhere-door/config'
import {
  createManualPostMediaReceipt,
  getManualPostImageLimitBytes,
  verifyManualPostMediaReceipt,
} from '@/lib/anywhere-door/manual-media'
import { isManualPostImageMimeType, MANUAL_POST_MAX_VIDEO_BYTES } from '@/lib/anywhere-door/manual-media-policy'
import { prisma } from '@/lib/prisma'
import { acquireInstagramSyncLease, getInstagramSyncState, releaseInstagramSyncLease } from '@/lib/instagram/sync-state'
import { enforceApiRateLimit, rejectInvalidRequestOrigin, requireAdmin } from '@/lib/security'
import { deleteFromCos, getCosUrl, uploadToCos } from '@/lib/tencent-cos'

export const runtime = 'nodejs'
export const maxDuration = 60

function isMp4(buffer: Buffer) {
  return buffer.length >= 12 && buffer.toString('ascii', 4, 8) === 'ftyp'
}

async function authorize(request: Request, method: 'POST' | 'DELETE') {
  const originError = rejectInvalidRequestOrigin(request)
  if (originError) return { user: null, response: originError }
  const guard = await requireAdmin('social_manage')
  if (!guard.user) return { user: null, response: guard.response }
  const limited = await enforceApiRateLimit(request, guard.user.id, {
    endpoint: `/api/admin/anywhere-door/posts/manual/media:${method}`,
    ip: { limit: 120, windowSeconds: 60 * 60 },
    user: { limit: 60, windowSeconds: 60 * 60 },
  }, '媒体操作过于频繁，请稍后再试')
  return limited ? { user: null, response: limited } : { user: guard.user, response: null }
}

export async function POST(request: Request) {
  const guard = await authorize(request, 'POST')
  if (!guard.user) return guard.response
  if (!process.env.JWT_SECRET?.trim() || process.env.JWT_SECRET.trim().length < 32 || process.env.JWT_SECRET.trim() === 'dev-secret-change-before-production') {
    return NextResponse.json({ code: 'MEDIA_SIGNING_UNAVAILABLE', message: '媒体上传暂不可用，请联系技术人员' }, { status: 503 })
  }
  const config = getAnywhereDoorConfig()
  if (!config.enabled || getAnywhereDoorStorageMode() !== 'production') {
    return NextResponse.json({ code: 'STORAGE_NOT_READY', message: '正式媒体存储尚未就绪' }, { status: 503 })
  }

  const form = await request.formData().catch(() => null)
  const file = form?.get('file')
  if (!(file instanceof File) || file.size < 1) return NextResponse.json({ message: '请选择有效的图片或视频' }, { status: 400 })

  const mime = file.type.trim().toLowerCase()
  let type: 'IMAGE' | 'VIDEO'
  let contentType: string
  let body: Buffer
  let digest: string
  if (mime === 'video/mp4') {
    if (file.size > MANUAL_POST_MAX_VIDEO_BYTES) return NextResponse.json({ code: 'VIDEO_TOO_LARGE', message: '视频不能超过 50MB' }, { status: 413 })
    body = Buffer.from(await file.arrayBuffer())
    if (!isMp4(body)) return NextResponse.json({ code: 'INVALID_MEDIA', message: '视频内容无效，请上传有效的 MP4 文件' }, { status: 400 })
    type = 'VIDEO'
    contentType = 'video/mp4'
    digest = createHash('sha256').update(body).digest('hex')
  } else if (isManualPostImageMimeType(mime)) {
    if (file.size > getManualPostImageLimitBytes()) return NextResponse.json({ code: 'IMAGE_TOO_LARGE', message: `图片不能超过 ${Math.floor(getManualPostImageLimitBytes() / (1024 * 1024))}MB` }, { status: 413 })
    const input = Buffer.from(await file.arrayBuffer())
    try {
      const metadata = await sharp(input, { failOn: 'error', limitInputPixels: 100_000_000 }).metadata()
      const expectedFormat = mime === 'image/jpeg' ? 'jpeg' : mime === 'image/png' ? 'png' : 'webp'
      if (metadata.format !== expectedFormat || (metadata.pages && metadata.pages > 1)) {
        return NextResponse.json({ code: 'INVALID_MEDIA', message: '图片内容与文件格式不符，或图片包含不支持的动画' }, { status: 400 })
      }
      body = await sharp(input, { failOn: 'error', limitInputPixels: 100_000_000 })
        .rotate()
        .resize({ width: 2400, height: 2400, fit: 'inside', withoutEnlargement: true })
        .webp({ quality: 84, effort: 4 })
        .toBuffer()
    } catch (error) {
      console.error('[admin.anywhere-door.manual.media.normalize]', { errorName: error instanceof Error ? error.name : 'unknown' })
      return NextResponse.json({ code: 'INVALID_MEDIA', message: '图片无法读取，请换一张图片重试' }, { status: 422 })
    }
    type = 'IMAGE'
    contentType = 'image/webp'
    digest = createHash('sha256').update(input).digest('hex')
  } else {
    return NextResponse.json({ code: 'UNSUPPORTED_MEDIA', message: '仅支持 JPG、JPEG、PNG、WebP 图片及 MP4 视频' }, { status: 400 })
  }

  const uploadId = randomUUID()
  const key = buildInstagramMediaStorageKey({
    username: ANYWHERE_DOOR_TARGET,
    mode: 'production',
    externalId: `manual:${uploadId}`,
    kind: type === 'VIDEO' ? 'video' : 'image',
    sortOrder: 0,
  })
  let receipt: ReturnType<typeof createManualPostMediaReceipt>
  try {
    receipt = createManualPostMediaReceipt({ uploadId, userId: guard.user.id, key, type, sha256: digest, size: file.size })
  } catch (error) {
    console.error('[admin.anywhere-door.manual.media.receipt]', { errorName: error instanceof Error ? error.name : 'unknown' })
    return NextResponse.json({ code: 'MEDIA_SIGNING_UNAVAILABLE', message: '媒体上传暂不可用，请联系技术人员' }, { status: 503 })
  }

  try {
    const url = await uploadToCos({ key, body, contentType })
    if (url !== getCosUrl(key)) {
      await deleteFromCos(key).catch((error) => console.error('[admin.anywhere-door.manual.media.cleanup]', { errorName: error instanceof Error ? error.name : 'unknown' }))
      return NextResponse.json({ code: 'MEDIA_STORAGE_INVALID', message: '媒体存储结果无效，请重试' }, { status: 502 })
    }
    return NextResponse.json({ media: { uploadId, receipt: receipt.token, type } }, { status: 201, headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    await deleteFromCos(key).catch((cleanupError) => console.error('[admin.anywhere-door.manual.media.cleanup]', { errorName: cleanupError instanceof Error ? cleanupError.name : 'unknown' }))
    console.error('[admin.anywhere-door.manual.media.upload]', { errorName: error instanceof Error ? error.name : 'unknown' })
    return NextResponse.json({ code: 'MEDIA_UPLOAD_FAILED', message: '该文件上传失败，可单独重试或移除' }, { status: 502 })
  }
}

export async function DELETE(request: Request) {
  const guard = await authorize(request, 'DELETE')
  if (!guard.user) return guard.response
  const body = await request.json().catch(() => null) as { receipt?: unknown } | null
  const receipt = verifyManualPostMediaReceipt(body?.receipt, guard.user.id, Date.now(), { allowExpiredForCleanup: true })
  if (!receipt) return NextResponse.json({ code: 'MEDIA_RECEIPT_INVALID', message: '媒体上传凭证无效或已过期，请重新选择文件' }, { status: 400 })

  const storageUrl = getCosUrl(receipt.key)
  let leaseToken: string | null = null
  try {
    await getInstagramSyncState(ANYWHERE_DOOR_TARGET)
    const lease = await acquireInstagramSyncLease({ target: ANYWHERE_DOOR_TARGET })
    if (!lease.acquired) return NextResponse.json({ code: 'SYNC_BUSY', message: '自动同步或补录正在处理，请稍后重试' }, { status: 409 })
    leaseToken = lease.token
    const referenced = await prisma.socialPostMedia.findFirst({ where: { storageUrl }, select: { id: true } })
    if (referenced) return NextResponse.json({ code: 'MEDIA_ALREADY_ATTACHED', message: '媒体已关联动态，不能从存储中删除' }, { status: 409 })
    await deleteFromCos(receipt.key)
    return NextResponse.json({ deleted: true }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    console.error('[admin.anywhere-door.manual.media.delete]', { errorName: error instanceof Error ? error.name : 'unknown' })
    return NextResponse.json({ code: 'MEDIA_DELETE_FAILED', message: '暂时无法清理该上传文件，请稍后重试' }, { status: 503 })
  } finally {
    if (leaseToken) await releaseInstagramSyncLease(ANYWHERE_DOOR_TARGET, leaseToken).catch(() => false)
  }
}
