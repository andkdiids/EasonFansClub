import { randomUUID } from 'node:crypto'
import type { LivePhotoAsset, Prisma } from '@prisma/client'
import type { LivePhotoConfig } from '@/lib/live-photo-config'
import { getLivePhotoConfig } from '@/lib/live-photo-config-store'
import { isLivePhotoMarker, livePhotoIdFromMarker } from '@/lib/live-photo-markers'
import { probeLivePhotoUpload, type LivePhotoProbeResult } from '@/lib/live-photo-probe'
import { probeVideoWithFfmpeg } from '@/lib/live-photo-ffmpeg'
import { toPublicMediaUrl } from '@/lib/media-url'
import { prisma } from '@/lib/prisma'
import { deleteLivePhotoObjects, uploadPrivateLivePhotoObject } from '@/lib/live-photo-storage'
import { activeLivePhotoAssetIds, enqueueLivePhotoTranscode } from '@/lib/live-photo-transcode'

export type LivePhotoServiceErrorCode =
  | 'FEATURE_DISABLED'
  | 'INVALID_REQUEST'
  | 'TOO_LARGE'
  | 'UNSUPPORTED_IMAGE'
  | 'UNSUPPORTED_VIDEO'
  | 'DURATION_UNKNOWN'
  | 'VIDEO_TOO_LONG'
  | 'INVALID_DIMENSIONS'
  | 'MOTION_PHOTO_INVALID'
  | 'EMPTY_FILE'
  | 'ASSET_NOT_FOUND'
  | 'FORBIDDEN'
  | 'STILL_REFERENCED'
  | 'NOT_READY'
  | 'CONVERT_FAILED'
  | 'STORAGE_UNAVAILABLE'

export class LivePhotoServiceError extends Error {
  code: LivePhotoServiceErrorCode
  status: number

  constructor(code: LivePhotoServiceErrorCode, message: string, status = 400) {
    super(message)
    this.name = 'LivePhotoServiceError'
    this.code = code
    this.status = status
  }
}

export function livePhotoAssetView(asset: LivePhotoAsset) {
  return {
    id: asset.id,
    status: asset.status,
    stage: asset.stage,
    pairing: asset.pairing,
    width: asset.width,
    height: asset.height,
    durationMs: asset.durationMs,
    videoCodec: asset.videoCodec,
    audioCodec: asset.audioCodec,
    hasAudio: asset.hasAudio,
    size: asset.size,
    coverSize: asset.coverSize,
    widthSource: asset.widthSource,
    heightSource: asset.heightSource,
    errorCode: asset.errorCode,
    message: asset.status === 'FAILED' ? '媒体处理失败，请重新上传' : null,
    coverUrl: toPublicMediaUrl(`/api/media/live-photo/${asset.id}/cover`) ?? `/api/media/live-photo/${asset.id}/cover`,
    videoUrl: toPublicMediaUrl(`/api/media/live-photo/${asset.id}/video`) ?? `/api/media/live-photo/${asset.id}/video`,
    createdAt: asset.createdAt,
  }
}

export async function createLivePhotoAsset(params: {
  ownerId: string
  requestKey: string
  cover: Buffer
  video: Buffer | null
  manualPairing: boolean
  config?: LivePhotoConfig
}) {
  const config = params.config ?? await getLivePhotoConfig()
  if (!config.enabled) throw new LivePhotoServiceError('FEATURE_DISABLED', '实况照片功能暂未开放', 403)
  if (!/^[a-zA-Z0-9_-]{12,160}$/.test(params.requestKey)) {
    throw new LivePhotoServiceError('INVALID_REQUEST', '上传请求标识无效')
  }

  const existing = await prisma.livePhotoAsset.findUnique({
    where: { requestKey: params.requestKey },
    include: { Owner: { select: { id: true } } },
  })
  if (existing) {
    if (existing.ownerId !== params.ownerId) throw new LivePhotoServiceError('FORBIDDEN', '上传任务不属于当前用户', 403)
    return livePhotoAssetView(existing)
  }

  let probe: LivePhotoProbeResult = probeLivePhotoUpload({
    cover: params.cover,
    video: params.video,
    manualPairing: params.manualPairing,
    maxDurationSeconds: config.maxDurationSeconds,
    maxUploadBytes: config.maxUploadBytes,
  })
  const videoBytes = probe.embeddedVideo ? Buffer.from(probe.embeddedVideo) : params.video
  if (!probe.ok) {
    // The box parser reads headers; it is not a decoder. When it cannot read
    // the numbers but the clip itself exists, let ffmpeg decode one frame.
    // HEVC clips, unusual `moov` placement and vendor-padded motion photos are
    // all valid media that a header-only check would wrongly reject.
    const recoverable = probe.code === 'INVALID_DIMENSIONS'
      || probe.code === 'DURATION_UNKNOWN'
      || probe.code === 'UNSUPPORTED_VIDEO'
    if (recoverable && videoBytes?.byteLength) {
      const decoded = await probeVideoWithFfmpeg(
        Buffer.from(videoBytes),
        probe.videoContainer === 'mov' ? 'mov' : 'mp4',
      )
      if (decoded) {
        const durationMs = decoded.durationMs || probe.durationMs
        if (durationMs > config.maxDurationSeconds * 1000) {
          throw new LivePhotoServiceError('VIDEO_TOO_LONG', `视频时长超过 ${config.maxDurationSeconds} 秒，无法直接上传`)
        }
        probe = {
          ...probe,
          ok: true,
          code: undefined,
          message: undefined,
          width: decoded.width,
          height: decoded.height,
          durationMs,
          hasAudio: decoded.hasAudio,
        }
      }
    }
  }
  if (!probe.ok) {
    // A rejected upload used to leave no trace at all, so a real-device failure
    // could not be diagnosed afterwards. Container facts only: no bytes, no
    // EXIF, no file name, no storage paths.
    console.warn('[live-photo.upload.rejected]', {
      code: probe.code,
      imageContainer: probe.imageContainer,
      videoContainer: probe.videoContainer,
      pairing: probe.pairing,
      coverBytes: params.cover.byteLength,
      videoBytes: videoBytes?.byteLength ?? 0,
    })
    throw new LivePhotoServiceError(probe.code || 'INVALID_REQUEST', probe.message || '媒体文件校验失败')
  }
  if (!videoBytes) throw new LivePhotoServiceError('EMPTY_FILE', '配对视频不能为空')

  const id = randomUUID().replace(/-/g, '')
  const prefix = `live-photo/${params.ownerId}/${id}`
  const sourceCoverKey = `${prefix}/source-cover`
  const sourceVideoKey = `${prefix}/source-video`
  try {
    await Promise.all([
      uploadPrivateLivePhotoObject({ key: sourceCoverKey, body: params.cover, contentType: 'application/octet-stream' }),
      uploadPrivateLivePhotoObject({ key: sourceVideoKey, body: videoBytes, contentType: 'application/octet-stream' }),
    ])
  } catch {
    await deleteLivePhotoObjects([sourceCoverKey, sourceVideoKey])
    throw new LivePhotoServiceError('STORAGE_UNAVAILABLE', '媒体存储暂时不可用，请稍后重试', 503)
  }

  try {
    const asset = await prisma.livePhotoAsset.create({
      data: {
        id,
        ownerId: params.ownerId,
        requestKey: params.requestKey,
        sourceCoverKey,
        sourceVideoKey,
        status: 'PENDING',
        stage: 'queued',
        pairing: probe.pairing,
        durationMs: probe.durationMs,
        width: probe.width,
        height: probe.height,
        hasAudio: probe.hasAudio,
      },
    })
    enqueueLivePhotoTranscode(asset.id)
    return livePhotoAssetView(asset)
  } catch (error) {
    await deleteLivePhotoObjects([sourceCoverKey, sourceVideoKey])
    if (error && typeof error === 'object' && 'code' in error && error.code === 'P2002') {
      const raced = await prisma.livePhotoAsset.findUnique({ where: { requestKey: params.requestKey } })
      if (raced) return livePhotoAssetView(raced)
    }
    throw new LivePhotoServiceError('STORAGE_UNAVAILABLE', '媒体任务创建失败，请稍后重试', 503)
  }
}

export async function resolveLivePhotoMedia(entries: readonly string[], userId: string, tx: Prisma.TransactionClient = prisma) {
  const ids = entries.map((entry) => livePhotoIdFromMarker(entry)).filter((id): id is string => Boolean(id))
  if (!ids.length) return new Map<string, LivePhotoAsset>()
  if (new Set(ids).size !== ids.length) {
    throw new LivePhotoServiceError('INVALID_REQUEST', '同一实况照片不能重复添加')
  }
  const assets = await tx.livePhotoAsset.findMany({ where: { id: { in: ids } } })
  const byId = new Map(assets.map((asset) => [asset.id, asset]))
  for (const id of ids) {
    const asset = byId.get(id)
    if (!asset || asset.status !== 'READY') {
      throw new LivePhotoServiceError('ASSET_NOT_FOUND', '实况照片尚未处理完成或已失效', 400)
    }
    if (asset.ownerId !== userId) {
      throw new LivePhotoServiceError('FORBIDDEN', '无权使用此实况照片', 403)
    }
  }
  return byId
}

export async function getOwnedAsset(assetId: string, userId: string, isAdmin = false) {
  const asset = await prisma.livePhotoAsset.findUnique({ where: { id: assetId } })
  if (!asset) throw new LivePhotoServiceError('ASSET_NOT_FOUND', '媒体不存在', 404)
  if (!isAdmin && asset.ownerId !== userId) throw new LivePhotoServiceError('FORBIDDEN', '无权访问此媒体', 403)
  return asset
}

/** Access to private media requires ownership, a live approved post, or a
 * reviewer/manager session. Unapproved media is never exposed on public CDN. */
export async function canViewLivePhotoAsset(assetId: string, userId: string | null, isPrivileged: boolean) {
  const asset = await prisma.livePhotoAsset.findUnique({
    where: { id: assetId },
    include: { PostMedia: { select: { Post: { select: { isDeleted: true, moderationStatus: true, publicationStatus: true } } } } },
  })
  if (!asset) return null
  if (isPrivileged || (userId && asset.ownerId === userId)) return asset
  const published = asset.PostMedia.some(({ Post }) => !Post.isDeleted && Post.moderationStatus === 'APPROVED' && Post.publicationStatus === 'PUBLISHED')
  return published ? asset : null
}

export async function isLivePhotoPublic(assetId: string) {
  const count = await prisma.postMedia.count({
    where: {
      url: { contains: `/api/media/live-photo/${assetId}/` },
      Post: { isDeleted: false, moderationStatus: 'APPROVED', publicationStatus: 'PUBLISHED' },
    },
  })
  return count > 0
}

async function draftReferencesAsset(assetId: string, ownerId: string) {
  const drafts = await prisma.postDraft.findMany({ where: { userId: ownerId }, select: { imageUrls: true } })
  return drafts.some((draft) => Array.isArray(draft.imageUrls) && draft.imageUrls.some((entry: unknown) => isLivePhotoMarker(entry) === true && String(entry).includes(assetId)))
}

export async function deleteLivePhotoAsset(assetId: string, userId: string, isAdmin = false) {
  const asset = await getOwnedAsset(assetId, userId, isAdmin)
  const references = await prisma.postMedia.count({
    where: { url: { contains: `/api/media/live-photo/${assetId}/` }, Post: { isDeleted: false } },
  })
  if (references || await draftReferencesAsset(assetId, asset.ownerId)) {
    throw new LivePhotoServiceError('STILL_REFERENCED', '媒体已被帖子或草稿引用，不能删除', 409)
  }
  await prisma.livePhotoAsset.update({ where: { id: assetId }, data: { status: 'CANCELLED', stage: 'deleted' } })
  await prisma.livePhotoAsset.delete({ where: { id: assetId } })
  const prefix = asset.sourceCoverKey.replace(/\/source-cover$/, '')
  await deleteLivePhotoObjects([
    asset.sourceCoverKey, asset.sourceVideoKey,
    `${prefix}/cover.webp`, `${prefix}/thumb.webp`, `${prefix}/video.mp4`,
  ])
  return { id: assetId }
}

/** Post deletion calls this after the soft-delete transaction. Media that is
 * still referenced elsewhere is intentionally left untouched. */
export async function cleanupAssetsForDeletedPost(postId: string): Promise<string[]> {
  const rows = await prisma.livePhotoAsset.findMany({
    where: { PostMedia: { some: { postId } } },
    select: { id: true, ownerId: true },
  })
  const cleaned: string[] = []
  for (const row of rows) {
    try {
      await deleteLivePhotoAsset(row.id, row.ownerId)
      cleaned.push(row.id)
    } catch (error) {
      if (!(error instanceof LivePhotoServiceError && error.code === 'STILL_REFERENCED')) console.warn('[live-photo.cleanup]', { assetId: row.id })
    }
  }
  return cleaned
}

/** Auditable orphan sweep. Safe to call from a cron job via the admin API:
 * it skips active transcodes and anything still referenced by a post/draft. */
export async function cleanupOrphanLivePhotos(maxAgeHours = 24) {
  const cutoff = new Date(Date.now() - Math.max(1, maxAgeHours) * 3_600_000)
  const active = activeLivePhotoAssetIds()
  const assets = await prisma.livePhotoAsset.findMany({
    where: { updatedAt: { lt: cutoff } },
    select: { id: true, ownerId: true, status: true, PostMedia: { select: { id: true } } },
  })
  const cleaned: string[] = []
  for (const asset of assets) {
    if (active.has(asset.id) || asset.PostMedia.length) continue
    if (await draftReferencesAsset(asset.id, asset.ownerId)) continue
    try {
      await deleteLivePhotoAsset(asset.id, asset.ownerId)
      cleaned.push(asset.id)
    } catch (error) {
      if (!(error instanceof LivePhotoServiceError && error.code === 'STILL_REFERENCED')) {
        console.warn('[live-photo.cleanup]', { assetId: asset.id })
      }
    }
  }
  return cleaned
}

export async function listLivePhotoAssets(userId: string, limit = 30) {
  const assets = await prisma.livePhotoAsset.findMany({
    where: { ownerId: userId },
    orderBy: { createdAt: 'desc' },
    take: Math.min(100, Math.max(1, limit)),
  })
  return assets.map(livePhotoAssetView)
}

export async function getLivePhotoStats() {
  const orphanBefore = new Date(Date.now() - 24 * 3_600_000)
  const [total, ready, failed, processing, coverSum, videoSum, orphan, failureGroups] = await Promise.all([
    prisma.livePhotoAsset.count(),
    prisma.livePhotoAsset.count({ where: { status: 'READY' } }),
    prisma.livePhotoAsset.count({ where: { status: 'FAILED' } }),
    prisma.livePhotoAsset.count({ where: { status: { in: ['PENDING', 'PROCESSING'] } } }),
    prisma.livePhotoAsset.aggregate({ where: { status: 'READY' }, _sum: { coverSize: true } }),
    prisma.livePhotoAsset.aggregate({ where: { status: 'READY' }, _sum: { size: true } }),
    prisma.livePhotoAsset.count({ where: { updatedAt: { lt: orphanBefore }, PostMedia: { none: {} } } }),
    prisma.livePhotoAsset.groupBy({ by: ['errorCode'], where: { status: 'FAILED' }, _count: { _all: true } }),
  ])
  return {
    total,
    ready,
    failed,
    processing,
    successRate: total ? Math.round((ready / total) * 1000) / 10 : 0,
    videoBytes: videoSum._sum.size ?? 0,
    coverBytes: coverSum._sum.coverSize ?? 0,
    orphanCandidates: orphan,
    failures: failureGroups
      .filter((group) => group.errorCode)
      .map((group) => ({ code: group.errorCode as string, count: group._count._all }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 8),
  }
}

export type LivePhotoAdminListRow = {
  id: string
  ownerUid: number | null
  status: string
  pairing: string
  durationMs: number | null
  size: number | null
  errorCode: string | null
  createdAt: Date
}

export async function listLivePhotoAssetsForAdmin(limit = 50): Promise<LivePhotoAdminListRow[]> {
  const rows = await prisma.livePhotoAsset.findMany({
    orderBy: { createdAt: 'desc' },
    take: Math.min(200, Math.max(1, limit)),
    select: {
      id: true, status: true, pairing: true, durationMs: true, size: true, errorCode: true, createdAt: true,
      Owner: { select: { uid: true } },
    },
  })
  return rows.map(({ Owner, ...row }) => ({ ...row, ownerUid: Owner.uid }))
}

export function livePhotoPrismaError(error: unknown) {
  const detail = error instanceof Error ? error.message.slice(0, 200) : 'UNKNOWN'
  return detail as Prisma.JsonValue
}
