import { createHash } from 'node:crypto'
import { NextResponse } from 'next/server'
import { adminAuditOperations, createAdminActionAudit } from '@/lib/admin-audit'
import { ANYWHERE_DOOR_TARGET, getAnywhereDoorConfig, getAnywhereDoorStorageMode } from '@/lib/anywhere-door/config'
import { buildManualPostMediaRecords, verifyManualPostMediaReceipt } from '@/lib/anywhere-door/manual-media'
import { MANUAL_POST_MAX_MEDIA } from '@/lib/anywhere-door/manual-media-policy'
import { acquireInstagramSyncLease, getInstagramSyncState, releaseInstagramSyncLease } from '@/lib/instagram/sync-state'
import { buildInstagramPostIdentityFilters, buildManualSocialPostExternalId, canonicalizeInstagramSourceUrl, resolveManualSocialPostMediaType } from '@/lib/instagram/source-identity'
import { prisma } from '@/lib/prisma'
import { enforceApiRateLimit, rejectInvalidRequestOrigin, requireAdmin } from '@/lib/security'
import { deleteFromCos, getCosUrl } from '@/lib/tencent-cos'

export const runtime = 'nodejs'
export const maxDuration = 60

const MAX_REQUEST_BYTES = 64 * 1024
const MAX_CAPTION_LENGTH = 10_000

function parseReceipts(value: FormDataEntryValue | null, userId: string) {
  if (typeof value !== 'string') return null
  try {
    const tokens: unknown = JSON.parse(value)
    if (!Array.isArray(tokens) || tokens.length > MANUAL_POST_MAX_MEDIA || !tokens.every((token) => typeof token === 'string')) return null
    const receipts = tokens.map((token) => verifyManualPostMediaReceipt(token, userId))
    if (receipts.some((receipt) => !receipt)) return null
    const verified = receipts.filter((receipt): receipt is NonNullable<typeof receipt> => Boolean(receipt))
    if (new Set(verified.map((receipt) => receipt.uploadId)).size !== verified.length) return null
    return verified
  } catch {
    return null
  }
}

async function cleanupUnreferencedReceipts(receipts: NonNullable<ReturnType<typeof parseReceipts>>) {
  const deletedUploadIds: string[] = []
  for (const receipt of receipts) {
    try {
      const referenced = await prisma.socialPostMedia.findFirst({ where: { storageUrl: getCosUrl(receipt.key) }, select: { id: true } })
      if (referenced) continue
      await deleteFromCos(receipt.key)
      deletedUploadIds.push(receipt.uploadId)
    } catch (error) {
      // Do not delete or claim cleanup when reference state cannot be proven.
      console.error('[admin.anywhere-door.manual.cleanup]', { errorName: error instanceof Error ? error.name : 'unknown' })
    }
  }
  return deletedUploadIds
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
  if (length > MAX_REQUEST_BYTES) return NextResponse.json({ code: 'REQUEST_TOO_LARGE', message: '补录信息过大，请重新选择媒体' }, { status: 413 })
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
  const receipts = parseReceipts(form.get('mediaReceipts'), guard.user.id)
  if (!receipts) return NextResponse.json({ code: 'MEDIA_RECEIPTS_INVALID', retryUploads: true, message: '媒体上传凭证无效或已过期，请重新上传后提交' }, { status: 400 })
  const mediaType = resolveManualSocialPostMediaType(Boolean(caption), receipts.map((receipt) => receipt.type))
  if (!mediaType) return NextResponse.json({ message: '请填写正文或上传图片 / 视频' }, { status: 400 })

  const config = getAnywhereDoorConfig()
  const storageMode = getAnywhereDoorStorageMode()
  if (!config.enabled) return NextResponse.json({ code: 'FEATURE_DISABLED', message: '随意门当前未启用' }, { status: 409 })
  if (storageMode !== 'production') return NextResponse.json({ code: 'STORAGE_NOT_READY', message: '正式媒体存储尚未就绪' }, { status: 503 })

  const mediaSha256 = receipts.length
    ? createHash('sha256').update(receipts.map((receipt) => `${receipt.type}:${receipt.sha256}`).join('\n')).digest('hex')
    : null
  const externalId = buildManualSocialPostExternalId({
    permalink: source.permalink,
    shortcode: source.shortcode,
    caption,
    publishedAt,
    mediaType,
    mediaSha256,
  })
  const identityFilters = buildInstagramPostIdentityFilters({
    externalId,
    shortcode: source.shortcode,
    permalink: source.permalink,
    authorUsername: ANYWHERE_DOOR_TARGET,
  })

  let leaseToken: string | null = null
  let creatingPost = false
  let invalidatedUploadIds: string[] = []
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
    const attachedMedia = await prisma.socialPostMedia.findMany({
      where: { storageUrl: { in: receipts.map((receipt) => getCosUrl(receipt.key)) } },
      select: { storageUrl: true },
    })
    if (attachedMedia.length) {
      return NextResponse.json({ code: 'MEDIA_ALREADY_ATTACHED', message: '所选媒体已关联其他动态，请重新选择文件' }, { status: 409 })
    }
    if (matches.length > 1) {
      invalidatedUploadIds = await cleanupUnreferencedReceipts(receipts)
      return NextResponse.json({ code: 'DUPLICATE_IDENTITY_AMBIGUOUS', invalidatedUploadIds, message: '来源标识匹配到多条动态，请先检查已有记录' }, { status: 409 })
    }
    const duplicate = matches[0]
    if (duplicate) {
      invalidatedUploadIds = await cleanupUnreferencedReceipts(receipts)
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
      return NextResponse.json({ result: { created: false, deduplicated: true, postId: duplicate.id, invalidatedUploadIds } }, { status: 200, headers: { 'Cache-Control': 'no-store' } })
    }

    creatingPost = true
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
          ...(receipts.length ? {
            media: {
              create: buildManualPostMediaRecords(receipts, getCosUrl),
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
        metadata: { sourceMode: 'MANUAL', sourceUrl: source.permalink, publishedAt: publishedAt.toISOString(), mediaType, mediaCount: receipts.length },
      })
      return created
    })

    return NextResponse.json({ result: { created: true, deduplicated: false, postId: post.id } }, { status: 201, headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    if (creatingPost) invalidatedUploadIds = await cleanupUnreferencedReceipts(receipts)
    console.error('[admin.anywhere-door.manual.create]', { errorName: error instanceof Error ? error.name : 'unknown' })
    return NextResponse.json({ code: 'MANUAL_POST_CREATE_FAILED', invalidatedUploadIds, message: '随意门内容保存失败；表单内容仍可重试' }, { status: 503 })
  } finally {
    if (leaseToken) await releaseInstagramSyncLease(ANYWHERE_DOOR_TARGET, leaseToken).catch(() => false)
  }
}
