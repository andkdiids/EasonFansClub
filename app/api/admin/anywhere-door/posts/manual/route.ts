import { createHash, randomUUID } from 'node:crypto'
import { NextResponse } from 'next/server'
import { adminAuditOperations, createAdminActionAudit } from '@/lib/admin-audit'
import { ANYWHERE_DOOR_TARGET, buildInstagramMediaStorageKey, getAnywhereDoorConfig, getAnywhereDoorStorageMode } from '@/lib/anywhere-door/config'
import { acquireInstagramSyncLease, getInstagramSyncState, releaseInstagramSyncLease } from '@/lib/instagram/sync-state'
import { buildInstagramPostIdentityFilters, buildManualSocialPostExternalId, canonicalizeInstagramSourceUrl, resolveManualSocialPostMediaType } from '@/lib/instagram/source-identity'
import { prisma } from '@/lib/prisma'
import { enforceApiRateLimit, rejectInvalidRequestOrigin, requireAdmin } from '@/lib/security'
import { deleteFromCos, uploadToCos } from '@/lib/tencent-cos'

export const runtime = 'nodejs'
export const maxDuration = 60

const MAX_VIDEO_BYTES = 50 * 1024 * 1024
const MAX_CAPTION_LENGTH = 10_000

function isMp4(buffer: Buffer) {
  return buffer.length >= 12 && buffer.toString('ascii', 4, 8) === 'ftyp'
}

export async function POST(request: Request) {
  const originError = rejectInvalidRequestOrigin(request)
  if (originError) return originError
  const guard = await requireAdmin('social_manage')
  if (!guard.user) return guard.response
  const limited = await enforceApiRateLimit(request, guard.user.id, {
    endpoint: '/api/admin/anywhere-door/posts/manual:POST',
    ip: { limit: 10, windowSeconds: 60 * 60 },
    user: { limit: 5, windowSeconds: 60 * 60 },
  }, '手动补录操作过于频繁，请稍后再试')
  if (limited) return limited

  const length = Number(request.headers.get('content-length') || 0)
  if (length > MAX_VIDEO_BYTES + 256 * 1024) return NextResponse.json({ code: 'VIDEO_TOO_LARGE', message: '视频不能超过 50MB' }, { status: 413 })
  const form = await request.formData().catch(() => null)
  if (!form) return NextResponse.json({ message: '表单内容无效，请重试' }, { status: 400 })

  const caption = String(form.get('caption') || '').trim()
  const publishedAtRaw = String(form.get('publishedAt') || '').trim()
  const publishedAt = new Date(publishedAtRaw)
  if (!Number.isFinite(publishedAt.getTime())) return NextResponse.json({ message: '请填写有效的原始发布时间' }, { status: 400 })
  if (caption.length > MAX_CAPTION_LENGTH) return NextResponse.json({ message: '正文不能超过 10000 个字符' }, { status: 400 })

  const sourceInput = String(form.get('sourceUrl') || '').trim()
  const source = canonicalizeInstagramSourceUrl(sourceInput)
  if (sourceInput && !source.permalink) return NextResponse.json({ message: '原文链接必须是有效的 Instagram 帖子链接' }, { status: 400 })
  const fileEntry = form.get('video')
  const file = fileEntry instanceof File && fileEntry.size > 0 ? fileEntry : null
  const mediaType = resolveManualSocialPostMediaType(Boolean(caption), Boolean(file))
  if (!mediaType) return NextResponse.json({ message: '请填写正文或上传视频' }, { status: 400 })

  let video: Buffer | null = null
  let videoSha256: string | null = null
  if (file) {
    if (file.type.trim().toLowerCase() !== 'video/mp4') return NextResponse.json({ message: '目前仅支持 MP4 视频' }, { status: 400 })
    if (file.size > MAX_VIDEO_BYTES) return NextResponse.json({ code: 'VIDEO_TOO_LARGE', message: '视频不能超过 50MB' }, { status: 413 })
    video = Buffer.from(await file.arrayBuffer())
    if (!isMp4(video)) return NextResponse.json({ message: '视频内容无效，请上传有效的 MP4 文件' }, { status: 400 })
    videoSha256 = createHash('sha256').update(video).digest('hex')
  }

  const config = getAnywhereDoorConfig()
  const storageMode = getAnywhereDoorStorageMode()
  if (!config.enabled) return NextResponse.json({ code: 'FEATURE_DISABLED', message: '随意门当前未启用' }, { status: 409 })
  if (storageMode !== 'production') return NextResponse.json({ code: 'STORAGE_NOT_READY', message: '正式媒体存储尚未就绪' }, { status: 503 })

  const externalId = buildManualSocialPostExternalId({
    permalink: source.permalink,
    shortcode: source.shortcode,
    caption,
    publishedAt,
    mediaType,
    mediaSha256: videoSha256,
  })
  const identityFilters = buildInstagramPostIdentityFilters({
    externalId,
    shortcode: source.shortcode,
    permalink: source.permalink,
    authorUsername: ANYWHERE_DOOR_TARGET,
  })

  let leaseToken: string | null = null
  let uploadedKey: string | null = null
  let uploadedUrl: string | null = null
  try {
    await getInstagramSyncState(ANYWHERE_DOOR_TARGET)
    const lease = await acquireInstagramSyncLease({ target: ANYWHERE_DOOR_TARGET })
    if (!lease.acquired) return NextResponse.json({ code: 'SYNC_BUSY', message: '自动同步正在处理，请稍后重试' }, { status: 409 })
    leaseToken = lease.token

    const matches = await prisma.socialPost.findMany({
      where: { platform: 'INSTAGRAM', OR: identityFilters },
      take: 2,
      select: { id: true, externalId: true, authorUsername: true, permalink: true },
    })
    if (matches.length > 1) return NextResponse.json({ code: 'DUPLICATE_IDENTITY_AMBIGUOUS', message: '来源标识匹配到多条动态，请先检查已有记录' }, { status: 409 })
    const duplicate = matches[0]
    if (duplicate) {
      await prisma.$transaction(async (tx) => {
        await createAdminActionAudit(tx, {
          operatorId: guard.user!.id,
          action: 'UPDATE_SETTING',
          operationType: adminAuditOperations.ANYWHERE_DOOR_MANUAL_POST_DEDUPED,
          targetType: 'SOCIAL_POST',
          targetId: duplicate.id,
          targetTitle: caption.slice(0, 160) || '随意门动态',
          reason: '手动补录命中现有来源记录，未创建重复动态',
          metadata: { sourceMode: 'MANUAL', sourceUrl: source.permalink, dedupe: 'EXACT_SOURCE_IDENTITY' },
        })
      })
      return NextResponse.json({ result: { created: false, deduplicated: true, postId: duplicate.id } }, { status: 200, headers: { 'Cache-Control': 'no-store' } })
    }

    if (video) {
      const uploadId = randomUUID()
      uploadedKey = buildInstagramMediaStorageKey({
        username: ANYWHERE_DOOR_TARGET,
        mode: 'production',
        externalId: `manual:${uploadId}`,
        kind: 'video',
        sortOrder: 0,
      })
      uploadedUrl = await uploadToCos({ key: uploadedKey, body: video, contentType: 'video/mp4' })
    }

    const post = await prisma.$transaction(async (tx) => {
      const created = await tx.socialPost.create({
        data: {
          platform: 'INSTAGRAM',
          externalId,
          shortcode: source.shortcode,
          authorUsername: ANYWHERE_DOOR_TARGET,
          caption: caption || null,
          permalink: source.permalink,
          publishedAt,
          mediaType,
          status: 'READY',
          provider: 'manual',
          ...(uploadedUrl ? {
            media: {
              create: [{ type: 'VIDEO', storageUrl: uploadedUrl, thumbnailUrl: null, sortOrder: 0 }],
            },
          } : {}),
        },
        select: { id: true },
      })
      await createAdminActionAudit(tx, {
        operatorId: guard.user!.id,
        action: 'UPDATE_SETTING',
        operationType: adminAuditOperations.ANYWHERE_DOOR_MANUAL_POST_CREATED,
        targetType: 'SOCIAL_POST',
        targetId: created.id,
        targetTitle: caption.slice(0, 160) || '随意门动态',
        reason: '管理员手动补录 mreasonchan 动态',
        metadata: { sourceMode: 'MANUAL', sourceUrl: source.permalink, publishedAt: publishedAt.toISOString(), mediaType },
      })
      return created
    })

    return NextResponse.json({ result: { created: true, deduplicated: false, postId: post.id } }, { status: 201, headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    if (uploadedKey) {
      let referenced = false
      if (uploadedUrl) {
        try {
          referenced = Boolean(await prisma.socialPostMedia.findFirst({ where: { storageUrl: uploadedUrl }, select: { id: true } }))
        } catch {
          // A commit outcome or reference check that cannot be established is
          // not safe grounds to remove an object that may already be live.
          referenced = true
        }
      }
      if (!referenced) {
        await deleteFromCos(uploadedKey).catch((cleanupError) => {
          console.error('[admin.anywhere-door.manual.cleanup]', { errorName: cleanupError instanceof Error ? cleanupError.name : 'unknown' })
        })
      }
    }
    console.error('[admin.anywhere-door.manual.create]', { errorName: error instanceof Error ? error.name : 'unknown' })
    return NextResponse.json({ message: '随意门内容保存失败；表单内容仍可重试' }, { status: 503 })
  } finally {
    if (leaseToken) await releaseInstagramSyncLease(ANYWHERE_DOOR_TARGET, leaseToken).catch(() => false)
  }
}
