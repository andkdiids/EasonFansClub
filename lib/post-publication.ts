import { randomUUID } from 'node:crypto'
import { mapWithConcurrency } from '@/lib/bounded-concurrency'
import { revalidatePath, revalidateTag } from 'next/cache'
import type { BadgeEvaluationEvent } from '@/lib/badge-rule-engine'
import { syncUserAchievements } from '@/lib/achievements'
import { triggerBadgeEvaluation } from '@/lib/badge-rule-engine'
import { HOME_FEATURED_POSTS_CACHE_TAG } from '@/lib/home-data'
import { emitRealtimeMany } from '@/lib/realtime'
import { upsertNotification } from '@/lib/notification-write'
import { prisma } from '@/lib/prisma'
import { resolvePostExpiry } from '@/lib/post-lifecycle'
import { recordQualifiedPublishedPostGrowth } from '@/lib/growth-tasks/service'
import { isApprovedScheduledPostDue } from '@/lib/post-scheduling'

const PUBLICATION_EVENT_LEASE_MS = 5 * 60 * 1000
const PUBLICATION_EVENT_HEARTBEAT_MS = Math.floor(PUBLICATION_EVENT_LEASE_MS / 3)
const MAX_PUBLICATION_BATCH_SIZE = 100
const MAX_PUBLICATION_BATCH_CONCURRENCY = 6
const MAX_PUBLICATION_JOB_WORK_MS = 35_000
const MAX_RETRY_DELAY_MS = 60 * 60 * 1000

type PublicationJobResult = {
  duePostsFound: number
  postsPublished: number
  eventsProcessed: number
  eventsSkipped: number
  eventsFailed: number
  eventsDeferred: number
}

function retryDelayMs(attempts: number) {
  const exponent = Math.min(6, Math.max(0, attempts - 1))
  return Math.min(MAX_RETRY_DELAY_MS, 60_000 * (2 ** exponent))
}

function safePublicationError(error: unknown) {
  const value = error instanceof Error ? `${error.name}: ${error.message}` : String(error)
  return value
    .replace(/\b(?:mysql|mariadb|postgres(?:ql)?|prisma(?:\+postgres)?):\/\/[^\s'"]+/gi, '[redacted-database-url]')
    .replace(/\b(password|passwd|secret|token|cookie|authorization|api[_-]?key)\s*[:=]\s*[^\s,;]+/gi, '$1=[redacted]')
    .slice(0, 2000)
}

async function promoteOneDuePost(postId: string, now: Date) {
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT \`id\` FROM \`Post\` WHERE \`id\` = ${postId} FOR UPDATE`
    const current = await tx.post.findUnique({
      where: { id: postId },
      select: {
        id: true,
        status: true,
        isDeleted: true,
        moderationStatus: true,
        publicationStatus: true,
        scheduledPublishAt: true,
        expiryType: true,
        expiresAt: true,
      },
    })
    if (!current || !isApprovedScheduledPostDue(current, now)) return false

    // The author's expiry choice is authoritative. The publication job only
    // resolves the deadline relative to the actual publication time; it must
    // never invent or clear the expiryType itself.
    const expiry = resolvePostExpiry(current.expiryType, now)
    console.info('[post-publication.expiry]', {
      postId,
      expiryType: expiry.expiryType,
      expiresAt: expiry.expiresAt ? expiry.expiresAt.toISOString() : null,
      hadStaleExpiresAt: current.expiryType === null && current.expiresAt !== null,
    })

    const updated = await tx.post.updateMany({
      where: {
        id: postId,
        isDeleted: false,
        status: 'DRAFT',
        moderationStatus: 'APPROVED',
        publicationStatus: 'SCHEDULED',
        scheduledPublishAt: { lte: now },
      },
      data: {
        status: 'PUBLISHED',
        publicationStatus: 'PUBLISHED',
        publishedAt: now,
        ...expiry,
      },
    })
    if (updated.count !== 1) return false

    const event = await tx.postPublicationEvent.updateMany({
      where: { postId, status: 'WAITING' },
      data: { status: 'PENDING', availableAt: now, lastError: null },
    })
    if (event.count !== 1) throw new Error('POST_PUBLICATION_EVENT_MISSING_OR_CANCELLED')
    return true
  })
}

async function applyPublicationDatabaseEffects(eventId: string, lockToken: string, now: Date) {
  // All lifecycle transactions lock Post before PostPublicationEvent and User.
  // Keep that order here too so an approval/cancellation racing the worker
  // cannot form a Post <-> outbox deadlock.
  const eventSnapshot = await prisma.postPublicationEvent.findUnique({
    where: { id: eventId },
    select: { postId: true },
  })
  if (!eventSnapshot) return null

  return prisma.$transaction(async (tx) => {
    // Lock Post -> outbox -> User before the first consistent read. Under MySQL
    // REPEATABLE READ, taking the author lock after a snapshot can leave a
    // waiting transaction with stale one-time growth rows.
    const lockedPosts = await tx.$queryRaw<Array<{ id: string; authorId: string }>>`SELECT \`id\`, \`authorId\` FROM \`Post\` WHERE \`id\` = ${eventSnapshot.postId} FOR UPDATE`
    const lockedPost = lockedPosts[0]
    if (!lockedPost) return null
    await tx.$queryRaw`SELECT \`id\` FROM \`PostPublicationEvent\` WHERE \`id\` = ${eventId} FOR UPDATE`
    await tx.$queryRaw`SELECT \`id\` FROM \`User\` WHERE \`id\` = ${lockedPost.authorId} FOR UPDATE`
    const event = await tx.postPublicationEvent.findFirst({
      where: { id: eventId, status: 'PROCESSING', lockToken },
      select: { id: true, postId: true, triggerType: true, attempts: true },
    })
    if (!event) return null
    const post = await tx.post.findUnique({
      where: { id: event.postId },
      select: {
        id: true,
        title: true,
        authorId: true,
        boardId: true,
        status: true,
        isDeleted: true,
        moderationStatus: true,
        publicationStatus: true,
        publishedAt: true,
      },
    })

    if (!post || post.isDeleted || post.status !== 'PUBLISHED' || post.moderationStatus !== 'APPROVED' || post.publicationStatus !== 'PUBLISHED') {
      await tx.postPublicationEvent.update({
        where: { id: eventId },
        data: { status: 'CANCELLED', completedAt: now, lockedAt: null, lockToken: null, lastError: null },
      })
      return null
    }

    await recordQualifiedPublishedPostGrowth(tx, {
      userId: post.authorId,
      postId: post.id,
      post,
      now,
    })

    const activityTargetUrl = `/posts/${post.id}`
    const existingActivity = await tx.friendActivity.findFirst({
      where: { type: 'POST', targetUrl: activityTargetUrl },
      select: { id: true },
    })
    if (!existingActivity) {
      await tx.friendActivity.create({
        data: { actorId: post.authorId, type: 'POST', content: post.title, targetUrl: activityTargetUrl },
      })
    }

    const publicPostCount = await tx.post.count({
      where: {
        boardId: post.boardId,
        status: 'PUBLISHED',
        publicationStatus: 'PUBLISHED',
        publishedAt: { not: null },
        isDeleted: false,
        moderationStatus: 'APPROVED',
      },
    })
    await tx.board.update({ where: { id: post.boardId }, data: { postCount: publicPostCount } })

    const notificationKey = `post-published:${post.id}`
    await tx.notification.upsert({
      where: { recipientId_key: { recipientId: post.authorId, key: notificationKey } },
      create: {
        recipientId: post.authorId,
        actorId: post.authorId,
        type: 'ADMIN',
        key: notificationKey,
        title: '你的帖子已公开',
        content: `你的帖子《${post.title}》已在 E院广场公开。`,
        link: activityTargetUrl,
      },
      update: {
        title: '你的帖子已公开',
        content: `你的帖子《${post.title}》已在 E院广场公开。`,
        link: activityTargetUrl,
      },
    })

    return { userId: post.authorId, postId: post.id, triggerType: event.triggerType, attempts: event.attempts }
  })
}

async function finishPublicationEvent(eventId: string, lockToken: string, completedAt: Date) {
  return prisma.postPublicationEvent.updateMany({
    where: { id: eventId, status: 'PROCESSING', lockToken },
    data: { status: 'COMPLETED', completedAt, lockedAt: null, lockToken: null, lastError: null },
  })
}

async function failPublicationEvent(eventId: string, lockToken: string, attempts: number, now: Date, error: unknown) {
  const message = safePublicationError(error)
  const failed = await prisma.postPublicationEvent.updateMany({
    where: { id: eventId, status: 'PROCESSING', lockToken },
    data: {
      status: 'FAILED',
      availableAt: new Date(now.getTime() + retryDelayMs(attempts)),
      lockedAt: null,
      lockToken: null,
      lastError: message,
    },
  })
  console.error('[post-publication.event.failed]', { eventId, attempts, retryDelayMs: retryDelayMs(attempts), error: message })
  if (failed.count === 1 && attempts >= 3) {
    try {
      const event = await prisma.postPublicationEvent.findUnique({ where: { id: eventId }, select: { postId: true } })
      if (!event) return
      const admins = await prisma.user.findMany({
        where: {
          role: { in: ['ADMIN', 'SUPER_ADMIN'] },
          status: 'ACTIVE',
          isDeleted: false,
          OR: [
            { role: 'SUPER_ADMIN' },
            { AdminPermission: { some: { permissionKey: 'post_manage', enabled: true } } },
          ],
        },
        select: { id: true },
      })
      await Promise.all(admins.map((admin) => upsertNotification({
        where: { recipientId_key: { recipientId: admin.id, key: `post-publication-failure:${eventId}` } },
        create: {
          recipientId: admin.id,
          type: 'ADMIN',
          key: `post-publication-failure:${eventId}`,
          title: '定时帖子发布任务需要处理',
          content: `帖子 ${event.postId} 的公开副作用已连续失败 ${attempts} 次，任务会继续自动重试。最近错误：${message}`,
          link: '/admin/posts/review?status=APPROVED',
        },
        update: {
          title: '定时帖子发布任务需要处理',
          content: `帖子 ${event.postId} 的公开副作用已连续失败 ${attempts} 次，任务会继续自动重试。最近错误：${message}`,
          link: '/admin/posts/review?status=APPROVED',
          isRead: false,
          readAt: null,
        },
      }, { operation: 'post-publication-failure-alert', userId: admin.id })))
    } catch (alertError) {
      console.error('[post-publication.alert.failed]', { eventId, error: safePublicationError(alertError) })
    }
  }
}

function startPublicationEventLeaseHeartbeat(eventId: string, lockToken: string) {
  let stopped = false
  let timer: ReturnType<typeof setTimeout>
  const renew = async () => {
    try {
      const result = await prisma.postPublicationEvent.updateMany({
        where: { id: eventId, status: 'PROCESSING', lockToken },
        data: { lockedAt: new Date() },
      })
      if (result.count !== 1) stopped = true
    } catch (error) {
      console.error('[post-publication.lease-renew.failed]', { eventId, error: safePublicationError(error) })
    } finally {
      if (!stopped) {
        timer = setTimeout(() => void renew(), PUBLICATION_EVENT_HEARTBEAT_MS)
        timer.unref?.()
      }
    }
  }
  timer = setTimeout(() => void renew(), PUBLICATION_EVENT_HEARTBEAT_MS)
  timer.unref?.()
  return () => {
    stopped = true
    clearTimeout(timer)
  }
}

async function processPublicationEvent(eventId: string, now: Date) {
  const lockToken = randomUUID()
  // `now` is the job's publication-time snapshot; a large batch can take
  // minutes. Lease time must be based on this event's actual claim moment.
  const claimedAt = new Date()
  const leaseBefore = new Date(claimedAt.getTime() - PUBLICATION_EVENT_LEASE_MS)
  const claim = await prisma.postPublicationEvent.updateMany({
    where: {
      id: eventId,
      availableAt: { lte: now },
      OR: [
        { status: { in: ['PENDING', 'FAILED'] } },
        { status: 'PROCESSING', lockedAt: { lt: leaseBefore } },
      ],
    },
    data: { status: 'PROCESSING', lockedAt: claimedAt, lockToken, lastError: null, attempts: { increment: 1 } },
  })
  if (claim.count !== 1) return 'SKIPPED' as const

  const claimed = await prisma.postPublicationEvent.findFirst({ where: { id: eventId, lockToken }, select: { attempts: true } })
  if (!claimed) return 'SKIPPED' as const

  const stopHeartbeat = startPublicationEventLeaseHeartbeat(eventId, lockToken)
  try {
    const post = await applyPublicationDatabaseEffects(eventId, lockToken, now)
    if (!post) return 'SKIPPED' as const

    await syncUserAchievements(post.userId, ['POST'])
    const badgeEvent = post.triggerType as BadgeEvaluationEvent
    const badgeEvaluationOk = await triggerBadgeEvaluation(post.userId, badgeEvent, post.postId)
    if (!badgeEvaluationOk) throw new Error('POST_PUBLICATION_BADGE_EVALUATION_RETRY')

    try {
      emitRealtimeMany([post.userId], 'notification')
      revalidatePath('/community')
      revalidatePath('/forum')
      revalidatePath('/trending')
      revalidatePath('/rankings')
      revalidatePath('/search')
      revalidatePath('/profile')
      revalidatePath('/user/[uid]', 'page')
      revalidatePath(`/posts/${post.postId}`)
      revalidateTag('trending-posts')
      revalidateTag(HOME_FEATURED_POSTS_CACHE_TAG)
    } catch (error) {
      console.error('[post-publication.cache-or-realtime.failed]', { postId: post.postId, error: safePublicationError(error) })
    }

    const completed = await finishPublicationEvent(eventId, lockToken, now)
    if (completed.count !== 1) return 'SKIPPED' as const
    return 'PROCESSED' as const
  } catch (error) {
    await failPublicationEvent(eventId, lockToken, claimed.attempts, new Date(), error)
    return 'FAILED' as const
  } finally {
    stopHeartbeat()
  }
}

export async function processPostPublicationEventForPost(postId: string, now = new Date()) {
  const event = await prisma.postPublicationEvent.findUnique({
    where: { postId },
    select: { id: true, status: true },
  })
  if (!event || !['PENDING', 'FAILED', 'PROCESSING'].includes(event.status)) return 'SKIPPED' as const
  return processPublicationEvent(event.id, now)
}

export async function runScheduledPostPublicationJob(now = new Date()): Promise<PublicationJobResult> {
  const jobStartedAt = Date.now()
  const candidates = await prisma.post.findMany({
    where: {
      isDeleted: false,
      status: 'DRAFT',
      moderationStatus: 'APPROVED',
      publicationStatus: 'SCHEDULED',
      scheduledPublishAt: { lte: now },
    },
    orderBy: [{ scheduledPublishAt: 'asc' }, { id: 'asc' }],
    take: MAX_PUBLICATION_BATCH_SIZE,
    select: { id: true },
  })

  let postsPublished = 0
  let promotionFailures = 0
  await mapWithConcurrency(candidates, MAX_PUBLICATION_BATCH_CONCURRENCY, async (candidate) => {
    try {
      if (await promoteOneDuePost(candidate.id, now)) postsPublished += 1
    } catch (error) {
      promotionFailures += 1
      console.error('[post-publication.promote.failed]', { postId: candidate.id, error: safePublicationError(error) })
    }
  })

  const pendingEvents = await prisma.postPublicationEvent.findMany({
    where: {
      availableAt: { lte: now },
      OR: [
        { status: { in: ['PENDING', 'FAILED'] } },
        { status: 'PROCESSING', lockedAt: { lt: new Date(now.getTime() - PUBLICATION_EVENT_LEASE_MS) } },
      ],
      Post: {
        isDeleted: false,
        status: 'PUBLISHED',
        publicationStatus: 'PUBLISHED',
        moderationStatus: 'APPROVED',
      },
    },
    orderBy: [{ availableAt: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
    take: MAX_PUBLICATION_BATCH_SIZE,
    select: { id: true, Post: { select: { authorId: true } } },
  })

  let eventsProcessed = 0
  let eventsSkipped = 0
  let eventsFailed = 0
  let eventsDeferred = 0
  const eventsByAuthor = new Map<string, typeof pendingEvents>()
  for (const event of pendingEvents) {
    const authorId = event.Post.authorId
    const batch = eventsByAuthor.get(authorId) || []
    batch.push(event)
    eventsByAuthor.set(authorId, batch)
  }

  // Avoid making one author compete with itself for the User row lock inside
  // the reward transaction. Different authors remain parallel across workers.
  // Keep a 15s margin for in-flight effects and request shutdown under the
  // production cron's 50s HTTP timeout; deferred rows remain retryable next run.
  const eventDeadline = jobStartedAt + MAX_PUBLICATION_JOB_WORK_MS
  await mapWithConcurrency([...eventsByAuthor.values()], MAX_PUBLICATION_BATCH_CONCURRENCY, async (authorEvents) => {
    for (let index = 0; index < authorEvents.length; index += 1) {
      if (Date.now() >= eventDeadline) {
        eventsDeferred += authorEvents.length - index
        return
      }
      const outcome = await processPublicationEvent(authorEvents[index].id, now)
      if (outcome === 'PROCESSED') eventsProcessed += 1
      else if (outcome === 'FAILED') eventsFailed += 1
      else eventsSkipped += 1
    }
  })

  return {
    duePostsFound: candidates.length,
    postsPublished,
    eventsProcessed,
    eventsSkipped,
    eventsFailed: eventsFailed + promotionFailures,
    eventsDeferred,
  }
}
