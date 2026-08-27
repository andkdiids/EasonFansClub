import { createHash } from 'node:crypto'
import { createManyNotificationsWithDb } from '@/lib/notification-write'
import { prisma } from '@/lib/prisma'
import { isAnywhereDoorNotificationEnabled, isAnywhereDoorSyncEnabled } from '@/lib/anywhere-door/config'
import { createInstagramProvider } from '@/lib/instagram/factory'
import { InstagramMediaSafetyError, type InstagramMediaLocalizer, type LocalizedInstagramMedia } from '@/lib/instagram/media'
import { createInstagramMediaLocalizer, assertProductionMediaLocalizer } from '@/lib/instagram/localizer'
import { dedupeAndSortInstagramPosts, normalizeInstagramPost } from '@/lib/instagram/normalize'
import { InstagramProviderError, normalizeInstagramUsername, normalizeProviderLimit, type InstagramPost, type InstagramProvider, type InstagramProviderDiagnostics, type InstagramProviderTrace } from '@/lib/instagram/types'

const DEFAULT_TARGET = 'mreasonchan'
const DEFAULT_LIMIT = 3
const MAX_NOTIFY_RECIPIENTS = 1000

export type SyncInstagramPostsOptions = {
  provider?: InstagramProvider
  providerName?: string
  username?: string
  limit?: number
  localizer?: InstagramMediaLocalizer
  baseline?: boolean
  suppressNotification?: boolean
  trace?: InstagramProviderTrace | null
  trigger?: 'manual' | 'scheduled' | 'startup'
  baselineCompleted?: boolean
}

export type SyncInstagramPostsResult = {
  syncLogId: string
  provider: string
  target: string
  status: 'SUCCEEDED' | 'FAILED' | 'BLOCKED' | 'RATE_LIMITED' | 'CHALLENGE_REQUIRED'
  foundCount: number
  createdCount: number
  updatedCount: number
  mediaCount: number
  notifiedCount: number
  errorCode: string | null
  newExternalIds: string[]
  latestExternalId: string | null
  retryAfterSeconds: number | null
}

function syncStatusForError(error: unknown): SyncInstagramPostsResult['status'] {
  if (!(error instanceof InstagramProviderError)) return 'FAILED'
  if (error.code === 'RATE_LIMITED' || error.code === 'PROVIDER_RATE_LIMITED') return 'RATE_LIMITED'
  if (error.code === 'CHALLENGE_REQUIRED') return 'CHALLENGE_REQUIRED'
  if (
    error.code === 'LOGIN_REQUIRED'
    || error.code === 'PROVIDER_UNSTABLE'
    || error.code === 'PROVIDER_DISABLED_IN_PHASE_3'
    || error.code === 'PROVIDER_NOT_CONFIGURED'
    || error.code === 'PROVIDER_AUTH_ERROR'
    || error.code === 'PROVIDER_TARGET_MISMATCH'
    || error.code === 'APIFY_DATASET_MIXED_OWNERS'
    || error.code === 'APIFY_DATASET_TARGET_UNVERIFIABLE'
  ) return 'BLOCKED'
  return 'FAILED'
}

function safeProviderDiagnostics(provider: InstagramProvider): InstagramProviderDiagnostics | null {
  let diagnostics: InstagramProviderDiagnostics | null = null
  try {
    diagnostics = provider.getDiagnostics?.() || null
  } catch {
    return null
  }
  if (!diagnostics) return null
  return {
    requestedTarget: typeof diagnostics.requestedTarget === 'string' ? diagnostics.requestedTarget : null,
    datasetId: typeof diagnostics.datasetId === 'string' ? diagnostics.datasetId : null,
    actorRunId: typeof diagnostics.actorRunId === 'string' ? diagnostics.actorRunId : null,
    resolvedDatasetTarget: typeof diagnostics.resolvedDatasetTarget === 'string' ? diagnostics.resolvedDatasetTarget : null,
    recognizedOwners: Array.isArray(diagnostics.recognizedOwners)
      ? diagnostics.recognizedOwners.filter((owner): owner is string => typeof owner === 'string').slice(0, 20)
      : [],
    ownerResolutionSource: Object.fromEntries(Object.entries(diagnostics.ownerResolutionSource || {}).filter(([, count]) => Number.isFinite(count))),
    itemCount: Number.isFinite(diagnostics.itemCount) ? diagnostics.itemCount : 0,
    validOwnerItemCount: Number.isFinite(diagnostics.validOwnerItemCount) ? diagnostics.validOwnerItemCount : 0,
    unknownOwnerItemCount: Number.isFinite(diagnostics.unknownOwnerItemCount) ? diagnostics.unknownOwnerItemCount : 0,
    mismatchedOwnerItemCount: Number.isFinite(diagnostics.mismatchedOwnerItemCount) ? diagnostics.mismatchedOwnerItemCount : 0,
    directOwnerItemCount: Number.isFinite(diagnostics.directOwnerItemCount) ? diagnostics.directOwnerItemCount : 0,
    collaboratorItemCount: Number.isFinite(diagnostics.collaboratorItemCount) ? diagnostics.collaboratorItemCount : 0,
    foreignItemCount: Number.isFinite(diagnostics.foreignItemCount) ? diagnostics.foreignItemCount : 0,
    unknownItemCount: Number.isFinite(diagnostics.unknownItemCount) ? diagnostics.unknownItemCount : 0,
  }
}

function logProviderDiagnostics(provider: InstagramProvider, event: 'success' | 'failure') {
  const diagnostics = safeProviderDiagnostics(provider)
  if (diagnostics) console.info('[instagram.provider.contract]', { event, ...diagnostics })
  return diagnostics
}

function safeErrorMessage(error: unknown, diagnostics: InstagramProviderDiagnostics | null = null) {
  const base = error instanceof InstagramProviderError
    ? error.message
    : error instanceof Error ? error.message : '同步失败'
  if (!diagnostics || !(error instanceof InstagramProviderError)) return base.slice(0, 500)
  if (!['APIFY_DATASET_MIXED_OWNERS', 'APIFY_DATASET_TARGET_UNVERIFIABLE', 'PROVIDER_TARGET_MISMATCH'].includes(error.code)) return base.slice(0, 500)
  const owners = diagnostics.recognizedOwners.length ? diagnostics.recognizedOwners.join(',') : 'none'
  const sources = Object.entries(diagnostics.ownerResolutionSource).map(([source, count]) => `${source}:${count}`).join(',') || 'none'
  return `${base}；requestedTarget=${diagnostics.requestedTarget || 'unknown'}, resolvedDatasetTarget=${diagnostics.resolvedDatasetTarget || 'unknown'}, items=${diagnostics.itemCount}, directOwnerItems=${diagnostics.directOwnerItemCount ?? 0}, collaboratorItems=${diagnostics.collaboratorItemCount ?? 0}, foreignItems=${diagnostics.foreignItemCount ?? 0}, unknownItems=${diagnostics.unknownItemCount ?? 0}, validOwnerItems=${diagnostics.validOwnerItemCount}, unknownOwnerItems=${diagnostics.unknownOwnerItemCount}, mismatchedOwnerItems=${diagnostics.mismatchedOwnerItemCount}, owners=${owners}, sources=${sources}`.slice(0, 500)
}

function errorCode(error: unknown) {
  if (error instanceof InstagramProviderError || error instanceof InstagramMediaSafetyError) return error.code
  return 'SYNC_FAILED'
}

function traceData(trace: InstagramProviderTrace | null | undefined) {
  return {
    actor: trace?.actor || null,
    runId: trace?.runId || null,
    datasetId: trace?.datasetId || null,
    runStatus: trace?.runStatus || null,
    runStartedAt: trace?.runStartedAt || null,
    runFinishedAt: trace?.runFinishedAt || null,
    usageTotalUsd: trace?.usageTotalUsd ?? null,
    billableResults: trace?.billableResults ?? null,
  }
}

export function buildSocialPostNotificationBatch(postIds: string[], target: string, recipientIds: string[]) {
  const sortedIds = [...new Set(postIds)].sort()
  const batchKey = createHash('sha256').update(`${target}\u0000${sortedIds.join(',')}`).digest('hex').slice(0, 48)
  const isAggregate = sortedIds.length > 1
  return recipientIds.map((recipientId) => ({
    type: 'SYSTEM' as const,
    title: isAggregate ? `陈奕迅更新了 ${sortedIds.length} 条 Instagram 动态` : '随意门有新动态',
    content: isAggregate ? '新的公开动态已经归档到随意门。' : `${target} 的 Instagram 有新的公开动态。`,
    link: isAggregate ? '/anywhere-door' : `/anywhere-door/${sortedIds[0]}`,
    recipientId,
    key: `social-post-batch:${target}:${batchKey}`,
  }))
}

async function notifyNewSocialPosts(postIds: string[], target: string) {
  if (!postIds.length) return 0
  const recipients = await prisma.user.findMany({
    where: { isDeleted: false, status: 'ACTIVE' },
    select: { id: true },
    take: MAX_NOTIFY_RECIPIENTS,
  })
  if (!recipients.length) return 0
  const data = buildSocialPostNotificationBatch(postIds, target, recipients.map((recipient) => recipient.id))
  if (!data.length) return 0
  const result = await createManyNotificationsWithDb(prisma, { data, skipDuplicates: true }, { operation: 'social-post.sync.notify-new-post' })
  return result.count
}

async function upsertPost(post: InstagramPost, providerName: string, localizer: InstagramMediaLocalizer) {
  const existing = await prisma.socialPost.findUnique({
    where: { platform_externalId: { platform: 'INSTAGRAM', externalId: post.externalId } },
    include: { media: { orderBy: { sortOrder: 'asc' } } },
  })
  const canReuseMedia = Boolean(existing
    && (existing.status === 'READY' || existing.status === 'HIDDEN')
    && existing.media.length === post.media.length
    && existing.media.every((media, index) => media.sortOrder === index && media.type === post.media[index]?.type))
  const localizedMedia: LocalizedInstagramMedia[] = []

  try {
    const prepared = await prisma.$transaction(async (tx) => {
      const saved = await tx.socialPost.upsert({
        where: { platform_externalId: { platform: 'INSTAGRAM', externalId: post.externalId } },
        create: {
          platform: 'INSTAGRAM', externalId: post.externalId, shortcode: post.shortcode,
          authorUsername: post.username, caption: post.caption, publishedAt: post.publishedAt,
          permalink: post.permalink, mediaType: post.mediaType, status: 'DISCOVERED', provider: providerName,
        },
        update: {
          shortcode: post.shortcode, authorUsername: post.username, caption: post.caption,
          publishedAt: post.publishedAt, permalink: post.permalink, mediaType: post.mediaType, provider: providerName,
          status: existing?.status === 'HIDDEN' ? 'HIDDEN' : 'DOWNLOADING',
          syncedAt: new Date(),
        },
        select: { id: true, status: true },
      })
      if (saved.status !== 'HIDDEN') {
        await tx.socialPost.update({ where: { id: saved.id }, data: { status: 'DOWNLOADING' } })
      }
      return saved
    })

    if (!canReuseMedia) {
      for (const media of post.media) localizedMedia.push(await localizer.localize(media, { postExternalId: post.externalId }))
    }

    const row = await prisma.$transaction(async (tx) => {
      if (!canReuseMedia) {
        await tx.socialPostMedia.deleteMany({ where: { postId: prepared.id } })
        await tx.socialPostMedia.createMany({
          data: localizedMedia.map((media, index) => ({
            postId: prepared.id, type: post.media[index]?.type === 'VIDEO' ? 'VIDEO' as const : 'IMAGE' as const,
            storageUrl: media.storageUrl, thumbnailUrl: media.thumbnailUrl,
            width: media.width, height: media.height, durationMs: media.durationMs, sortOrder: index,
          })),
        })
      }
      return tx.socialPost.update({
        where: { id: prepared.id },
        data: { status: prepared.status === 'HIDDEN' ? 'HIDDEN' : 'READY', syncedAt: new Date() },
        select: { id: true, status: true },
      })
    })
    return { id: row.id, created: !existing, previousStatus: existing?.status || null, mediaCount: canReuseMedia ? existing?.media.length || 0 : localizedMedia.length }
  } catch (error) {
    await prisma.socialPost.updateMany({
      where: { platform: 'INSTAGRAM', externalId: post.externalId },
      data: {
        status: existing?.status === 'READY' || existing?.status === 'HIDDEN' ? existing.status : 'FAILED',
        syncedAt: new Date(),
      },
    }).catch(() => undefined)
    throw error
  }
}

export async function syncInstagramPosts(options: SyncInstagramPostsOptions = {}): Promise<SyncInstagramPostsResult> {
  const target = normalizeInstagramUsername(options.username || process.env.IG_TARGET_USERNAME || DEFAULT_TARGET)
  const limit = normalizeProviderLimit(options.limit || DEFAULT_LIMIT)
  if ((options.trigger === 'scheduled' || process.env.NODE_ENV === 'production') && !isAnywhereDoorSyncEnabled()) {
    return {
      syncLogId: '', provider: options.providerName || 'apify', target, status: 'BLOCKED', foundCount: 0,
      createdCount: 0, updatedCount: 0, mediaCount: 0, notifiedCount: 0, errorCode: 'SYNC_DISABLED',
      newExternalIds: [], latestExternalId: null, retryAfterSeconds: null,
    }
  }
  const provider = options.provider || createInstagramProvider({ provider: options.providerName })
  const localizer = assertProductionMediaLocalizer(options.localizer || createInstagramMediaLocalizer(target, provider.proxyUrl))
  const startedAt = new Date()
  const initialTrace = options.trace || provider.getTrace?.() || null
  const syncLog = await prisma.socialSyncLog.create({
    data: { provider: provider.name, target, startedAt, status: 'RUNNING', baselineImport: Boolean(options.baseline), ...traceData(initialTrace) },
    select: { id: true },
  })
  let foundCount = 0
  let createdCount = 0
  let updatedCount = 0
  let mediaCount = 0
  try {
    const rawPosts = await provider.getLatestPosts(target, limit)
    logProviderDiagnostics(provider, 'success')
    const trace = options.trace || provider.getTrace?.() || initialTrace
    await prisma.socialSyncLog.update({ where: { id: syncLog.id }, data: traceData(trace) })
    const posts = dedupeAndSortInstagramPosts(rawPosts.map(normalizeInstagramPost), limit)
    foundCount = posts.length
    const newPostIds: string[] = []
    const newExternalIds: string[] = []
    for (const post of posts) {
      const saved = await upsertPost(post, provider.name, localizer)
      if (saved.created) {
        createdCount += 1
        newPostIds.push(saved.id)
        newExternalIds.push(post.externalId)
      } else updatedCount += 1
      mediaCount += saved.mediaCount
    }
    const suppressNotification = options.suppressNotification ?? options.baseline ?? false
    const notificationsAllowed = isAnywhereDoorNotificationEnabled() && !suppressNotification && options.baselineCompleted === true
    const notifiedCount = notificationsAllowed ? await notifyNewSocialPosts(newPostIds, target) : 0
    await prisma.socialSyncLog.update({
      where: { id: syncLog.id },
      data: {
        status: 'SUCCEEDED', foundCount, createdCount, updatedCount, mediaCount, notificationCount: notifiedCount,
        finishedAt: new Date(), durationMs: Date.now() - startedAt.getTime(),
      },
    })
    return { syncLogId: syncLog.id, provider: provider.name, target, status: 'SUCCEEDED', foundCount, createdCount, updatedCount, mediaCount, notifiedCount, errorCode: null, newExternalIds, latestExternalId: posts[0]?.externalId || null, retryAfterSeconds: null }
  } catch (error) {
    const status = syncStatusForError(error)
    const diagnostics = logProviderDiagnostics(provider, 'failure')
    const trace = options.trace || provider.getTrace?.() || initialTrace
    await prisma.socialSyncLog.update({
      where: { id: syncLog.id },
      data: {
        ...traceData(trace),
        status, foundCount, createdCount, updatedCount, mediaCount,
        finishedAt: new Date(), durationMs: Date.now() - startedAt.getTime(),
        errorCode: errorCode(error), errorMessage: safeErrorMessage(error, diagnostics), baselineImport: Boolean(options.baseline),
      },
    }).catch(() => undefined)
    return { syncLogId: syncLog.id, provider: provider.name, target, status, foundCount, createdCount, updatedCount, mediaCount, notifiedCount: 0, errorCode: errorCode(error), newExternalIds: [], latestExternalId: null, retryAfterSeconds: error instanceof InstagramProviderError ? error.retryAfterSeconds || null : null }
  }
}
