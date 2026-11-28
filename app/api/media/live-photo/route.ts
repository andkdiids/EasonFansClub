import { createHash, randomUUID } from 'node:crypto'
import { NextResponse } from 'next/server'
import { enforceApiRateLimit, isAdminRole, requireRequestUser } from '@/lib/security'
import { getLivePhotoConfig } from '@/lib/live-photo-config-store'
import { publicLivePhotoConfig } from '@/lib/live-photo-config'
import { createLivePhotoAsset, listLivePhotoAssets, LivePhotoServiceError } from '@/lib/live-photo-service'
import { recoverUnfinishedLivePhotos } from '@/lib/live-photo-transcode'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

let recoveryStarted = false

function multipartFile(value: FormDataEntryValue | null): File | null {
  return value && typeof value !== 'string' && typeof value.arrayBuffer === 'function' ? value as File : null
}

export async function GET(request: Request) {
  const guard = await requireRequestUser(request)
  if (!guard.user) return guard.response
  if (!recoveryStarted) {
    recoveryStarted = true
    void recoverUnfinishedLivePhotos().catch(() => undefined)
  }
  const [config, assets] = await Promise.all([
    getLivePhotoConfig(),
    listLivePhotoAssets(guard.user.id),
  ])
  return NextResponse.json({
    config: publicLivePhotoConfig(config),
    assets,
    canManage: isAdminRole(guard.user.role),
  }, { headers: { 'Cache-Control': 'private, no-store, max-age=0' } })
}

export async function POST(request: Request) {
  const guard = await requireRequestUser(request)
  if (!guard.user) return guard.response
  const config = await getLivePhotoConfig()
  if (!config.enabled) {
    return NextResponse.json({ code: 'FEATURE_DISABLED', message: '实况照片功能暂未开放' }, { status: 403 })
  }
  const limited = await enforceApiRateLimit(request, guard.user.id, {
    endpoint: '/api/media/live-photo',
    ip: { limit: 60, windowSeconds: 3600 },
    user: { limit: 30, windowSeconds: 3600 },
  }, '实况照片上传过于频繁，请稍后再试')
  if (limited) return limited

  const contentType = request.headers.get('content-type') || ''
  if (!/^multipart\/form-data\s*(?:;|$)/i.test(contentType)) {
    return NextResponse.json({ code: 'INVALID_REQUEST', message: '上传请求无效' }, { status: 400 })
  }
  let form: FormData
  try {
    form = await request.formData()
  } catch {
    return NextResponse.json({ code: 'INVALID_REQUEST', message: '上传请求无法解析' }, { status: 400 })
  }

  const cover = multipartFile(form.get('cover'))
  const video = multipartFile(form.get('video'))
  if (!cover) {
    return NextResponse.json({ code: 'EMPTY_FILE', message: '请选择静态封面或动态照片' }, { status: 400 })
  }
  if (cover.size + (video?.size ?? 0) > config.maxUploadBytes) {
    return NextResponse.json({ code: 'TOO_LARGE', message: '原始文件超过上传上限' }, { status: 413 })
  }

  const clientRequestId = typeof form.get('requestId') === 'string'
    ? String(form.get('requestId')).trim().slice(0, 48)
    : randomUUID()
  const requestId = /^[a-zA-Z0-9_-]{8,48}$/.test(clientRequestId) ? clientRequestId : randomUUID()
  const [coverBytes, videoBytes] = await Promise.all([
    Buffer.from(await cover.arrayBuffer()),
    video ? Buffer.from(await video.arrayBuffer()) : Promise.resolve(Buffer.alloc(0)),
  ])
  const digest = createHash('sha256')
    .update(requestId).update(':').update(coverBytes)
    .update(':').update(videoBytes).digest('hex').slice(0, 32)
  const requestKey = `${guard.user.id}-${requestId}-${digest}`

  try {
    const asset = await createLivePhotoAsset({
      ownerId: guard.user.id,
      requestKey,
      cover: coverBytes,
      video: videoBytes.byteLength ? videoBytes : null,
      manualPairing: form.get('manual') === '1',
      config,
    })
    return NextResponse.json({ asset }, { status: 202 })
  } catch (error) {
    if (error instanceof LivePhotoServiceError) {
      return NextResponse.json({ code: error.code, message: error.message }, { status: error.status })
    }
    console.warn('[live-photo.upload]', { code: 'UPLOAD_FAILED' })
    return NextResponse.json({ code: 'STORAGE_UNAVAILABLE', message: '上传失败，请稍后重试' }, { status: 503 })
  }
}
