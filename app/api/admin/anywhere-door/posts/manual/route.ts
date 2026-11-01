import { createHash } from 'node:crypto'
import { NextResponse } from 'next/server'
import { adminAuditOperations, createAdminActionAudit } from '@/lib/admin-audit'
import { ANYWHERE_DOOR_TARGET, getAnywhereDoorConfig, getAnywhereDoorStorageMode } from '@/lib/anywhere-door/config'
import { buildManualPostMediaRecords, verifyManualPostMediaReceipt } from '@/lib/anywhere-door/manual-media'
import { MANUAL_POST_MAX_MEDIA } from '@/lib/anywhere-door/manual-media-policy'
import { isRecoverableManualPostMatch, MANUAL_POST_CREATE_RATE_LIMIT_POLICY, MANUAL_POST_RECORDS_PAGE_SIZE } from '@/lib/anywhere-door/manual-post-policy'
import { acquireInstagramSyncLease, getInstagramSyncState, releaseInstagramSyncLease } from '@/lib/instagram/sync-state'
import { buildInstagramPostIdentityFilters, buildManualSocialPostExternalId, canonicalizeInstagramSourceUrl, resolveManualSocialPostMediaType } from '@/lib/instagram/source-identity'
import { prisma } from '@/lib/prisma'
import { enforceApiRateLimit, rejectInvalidRequestOrigin, requireAdmin } from '@/lib/security'
import { safePublicMediaUrl } from '@/lib/social-posts'
import { deleteFromCos, getCosUrl } from '@/lib/tencent-cos'

export const runtime = 'nodejs'
export const maxDuration = 60

const MAX_REQUEST_BYTES = 64 * 1024
const MAX_CAPTION_LENGTH = 10_000

class ManualPostRecoveryConflictError extends Error {}

function isUniqueConstraintError(error: unknown) {
  return Boolean(error && typeof error === 'object' && 'code' in error && error.code === 'P2002')
}

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
    ...MANUAL_POST_CREATE_RATE_LIMIT_POLICY,
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
      select: {
        id: true,
        externalId: true,
        authorUsername: true,
        permalink: true,
        provider: true,
        status: true,
        createdAt: true,
        _count: { select: { media: true } },
      },
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
      if (isRecoverableManualPostMatch({ status: duplicate.status, mediaCount: duplicate._count.media })) {
        creatingPost = true
        const recoveredAt = new Date()
        await prisma.$transaction(async (tx) => {
          const updated = await tx.socialPost.updateMany({
            where: {
              id: duplicate.id,
              platform: 'INSTAGRAM',
              authorUsername: ANYWHERE_DOOR_TARGET,
              provider: duplicate.provider,
              status: 'FAILED',
            },
            data: {
              externalId,
              shortcode: source.shortcode,
              caption: caption || null,
              permalink: source.permalink,
              publishedAt,
              syncedAt: recoveredAt,
              createdAt: recoveredAt,
              mediaType,
              status: 'READY',
              provider: 'manual',
            },
          })
          if (updated.count !== 1) throw new ManualPostRecoveryConflictError('MANUAL_POST_RECOVERY_CONFLICT')
          if (receipts.length) {
            await tx.socialPostMedia.createMany({
              data: buildManualPostMediaRecords(receipts, getCosUrl).map((record) => ({ ...record, postId: duplicate.id })),
            })
          }
          await createAdminActionAudit(tx, {
            operatorId: guard.user!.id,
            action: 'UPDATE_SETTING',
            operationType: adminAuditOperations.ANYWHERE_DOOR_MANUAL_POST_RECOVERED,
            targetType: 'SOCIAL_POST',
            targetId: duplicate.id,
            targetTitle: caption.slice(0, 160) || '随意门动态',
            reason: '手动补录恢复了无媒体的失败来源记录',
            metadata: {
              sourceMode: 'MANUAL',
              sourceUrl: source.permalink,
              previousProvider: duplicate.provider,
              previousStatus: duplicate.status,
              previousCreatedAt: duplicate.createdAt.toISOString(),
              publishedAt: publishedAt.toISOString(),
              mediaType,
              mediaCount: receipts.length,
            },
          })
        })
        return NextResponse.json({
          result: { created: true, recovered: true, deduplicated: false, postId: duplicate.id },
        }, { status: 201, headers: { 'Cache-Control': 'no-store' } })
      }

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
      return NextResponse.json({
        result: {
          created: false,
          deduplicated: true,
          postId: duplicate.id,
          existingStatus: duplicate.status,
          existingProvider: duplicate.provider,
          sourceUrl: duplicate.permalink,
          invalidatedUploadIds,
        },
      }, { status: 200, headers: { 'Cache-Control': 'no-store' } })
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
    if (error instanceof ManualPostRecoveryConflictError) {
      return NextResponse.json({
        code: 'MANUAL_POST_RECOVERY_CONFLICT',
        invalidatedUploadIds,
        message: '这条来源记录状态刚刚发生变化，未覆盖现有数据；请刷新记录后再处理',
      }, { status: 409 })
    }
    if (creatingPost && isUniqueConstraintError(error)) {
      const concurrentlyCreated = await prisma.socialPost.findFirst({
        where: { platform: 'INSTAGRAM', OR: identityFilters },
        select: { id: true, status: true, provider: true, permalink: true },
      }).catch(() => null)
      if (concurrentlyCreated) {
        await prisma.$transaction(async (tx) => createAdminActionAudit(tx, {
          operatorId: guard.user!.id,
          action: 'UPDATE_SETTING',
          operationType: adminAuditOperations.ANYWHERE_DOOR_MANUAL_POST_DEDUPED,
          targetType: 'SOCIAL_POST',
          targetId: concurrentlyCreated.id,
          targetTitle: caption.slice(0, 160) || '随意门动态',
          reason: '并发补录命中同一来源，数据库唯一键阻止了重复动态',
          metadata: { sourceMode: 'MANUAL', sourceUrl: source.permalink, dedupe: 'CONCURRENT_UNIQUE_KEY' },
        }))
        return NextResponse.json({
          result: {
            created: false,
            deduplicated: true,
            postId: concurrentlyCreated.id,
            existingStatus: concurrentlyCreated.status,
            existingProvider: concurrentlyCreated.provider,
            sourceUrl: concurrentlyCreated.permalink,
            invalidatedUploadIds,
          },
        }, { status: 200, headers: { 'Cache-Control': 'no-store' } })
      }
    }
    console.error('[admin.anywhere-door.manual.create]', { errorName: error instanceof Error ? error.name : 'unknown' })
    return NextResponse.json({ code: 'MANUAL_POST_CREATE_FAILED', invalidatedUploadIds, message: '随意门内容保存失败；表单内容仍可重试' }, { status: 503 })
  } finally {
    if (leaseToken) await releaseInstagramSyncLease(ANYWHERE_DOOR_TARGET, leaseToken).catch(() => false)
  }
}

export async function GET(request: Request) {
  const guard = await requireAdmin('social_manage')
  if (!guard.user) return guard.response
  const url = new URL(request.url)
  const parsedPage = Number(url.searchParams.get('page') || 1)
  const page = Math.max(1, Number.isFinite(parsedPage) ? Math.floor(parsedPage) : 1)
  const where = { platform: 'INSTAGRAM' as const, provider: 'manual' as const, authorUsername: ANYWHERE_DOOR_TARGET }
  try {
    const [rows, total] = await Promise.all([
      prisma.socialPost.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * MANUAL_POST_RECORDS_PAGE_SIZE,
        take: MANUAL_POST_RECORDS_PAGE_SIZE,
        select: {
          id: true,
          caption: true,
          mediaType: true,
          status: true,
          publishedAt: true,
          createdAt: true,
          permalink: true,
          media: { orderBy: { sortOrder: 'asc' }, select: { id: true, type: true, storageUrl: true, thumbnailUrl: true, sortOrder: true } },
        },
      }),
      prisma.socialPost.count({ where }),
    ])
    return NextResponse.json({
      items: rows.map((row) => ({
        ...row,
        publishedAt: row.publishedAt.toISOString(),
        createdAt: row.createdAt.toISOString(),
        media: row.media.map((item) => ({
          id: item.id,
          type: item.type,
          url: safePublicMediaUrl(item.storageUrl),
          thumbnailUrl: safePublicMediaUrl(item.thumbnailUrl),
          sortOrder: item.sortOrder,
        })).filter((item) => item.url),
      })),
      total,
      page,
      pageSize: MANUAL_POST_RECORDS_PAGE_SIZE,
    }, { headers: { 'Cache-Control': 'private, no-store, max-age=0' } })
  } catch (error) {
    console.error('[admin.anywhere-door.manual.records]', { errorName: error instanceof Error ? error.name : 'unknown' })
    return NextResponse.json({ message: '手动补录记录暂时无法加载' }, { status: 503 })
  }
}
