import { Prisma, type PrismaClient } from '@prisma/client'
import { adminAuditOperations, createAdminActionAudit } from '@/lib/admin-audit'
import { publicImageUrl } from '@/lib/images'
import { isPublicMediaProxyUrl, toStoredMediaUrl } from '@/lib/media-url'
import { createManyNotificationsWithDb } from '@/lib/notification-write'
import { prisma } from '@/lib/prisma'
import { sanitizeText } from '@/lib/security'

export const ACTIVITY_NOTIFICATION_TITLE_MAX_LENGTH = 120
export const ACTIVITY_NOTIFICATION_CONTENT_MAX_LENGTH = 5000
export const ACTIVITY_NOTIFICATION_IDEMPOTENCY_KEY_MAX_LENGTH = 191
export const ACTIVITY_NOTIFICATION_LINK_PREFIX = '/activities/'

const activityIdPattern = /^[A-Za-z0-9_-]{8,128}$/
const idempotencyKeyPattern = /^[A-Za-z0-9:_-]{16,191}$/
const notificationChunkSize = 200

type ActivityNotificationDb = PrismaClient | Prisma.TransactionClient

export class ActivityNotificationError extends Error {
  constructor(
    readonly code: 'ACTIVITY_NOT_FOUND' | 'INVALID_INPUT' | 'NO_RECIPIENTS' | 'IDEMPOTENCY_KEY_REUSED',
    message: string,
    readonly status: number,
  ) {
    super(message)
    this.name = 'ActivityNotificationError'
  }
}

export type ActivityNotificationAudience = {
  activity: {
    id: string
    title: string
    status: 'DRAFT' | 'PUBLISHED' | 'CANCELLED'
  }
  userIds: string[]
  registrationCount: number
}

export type ActivityNotificationBatchView = {
  id: string
  activityId: string
  title: string
  content: string
  imageUrl: string | null
  status: string
  recipientCount: number
  sentCount: number
  skippedCount: number
  createdAt: string
  createdBy: { uid: number; nickname: string } | null
}

export function activityNotificationLink(activityId: string) {
  return `${ACTIVITY_NOTIFICATION_LINK_PREFIX}${encodeURIComponent(activityId)}`
}

export function normalizeActivityNotificationInput(input: {
  title: unknown
  content: unknown
  imageUrl?: unknown
  idempotencyKey: unknown
}) {
  const title = sanitizeText(input.title, ACTIVITY_NOTIFICATION_TITLE_MAX_LENGTH).trim()
  const content = sanitizeText(input.content, ACTIVITY_NOTIFICATION_CONTENT_MAX_LENGTH).trim()
  const rawIdempotencyKey = typeof input.idempotencyKey === 'string' ? input.idempotencyKey.trim() : ''
  if (!title) throw new ActivityNotificationError('INVALID_INPUT', '通知标题不能为空', 400)
  if (!content) throw new ActivityNotificationError('INVALID_INPUT', '通知正文不能为空', 400)
  if (!idempotencyKeyPattern.test(rawIdempotencyKey)) throw new ActivityNotificationError('INVALID_INPUT', '发送请求标识无效，请刷新后重试', 400)

  let imageUrl: string | null = null
  if (input.imageUrl !== undefined && input.imageUrl !== null && String(input.imageUrl).trim()) {
    const rawImageUrl = String(input.imageUrl).trim()
    if (!isPublicMediaProxyUrl(rawImageUrl)) throw new ActivityNotificationError('INVALID_INPUT', '通知图片必须来自站内上传结果', 400)
    imageUrl = toStoredMediaUrl(rawImageUrl) || rawImageUrl
  }

  return { title, content, imageUrl, idempotencyKey: rawIdempotencyKey }
}

function registrationStatusesForActivity(activityStatus: ActivityNotificationAudience['activity']['status']) {
  // Activity cancellation currently transitions every unverified active
  // registration to CANCELLED. Keep those historical registrations addressable
  // for a cancellation/follow-up notice, while normal activities only use the
  // current ACTIVE audience. Checked-in registrations remain ACTIVE.
  return activityStatus === 'CANCELLED' ? ['ACTIVE', 'CANCELLED'] as const : ['ACTIVE'] as const
}

export async function getActivityNotificationAudience(
  db: ActivityNotificationDb,
  activityId: string,
): Promise<ActivityNotificationAudience | null> {
  if (!activityIdPattern.test(activityId)) return null
  const activity = await db.activity.findUnique({
    where: { id: activityId },
    select: { id: true, title: true, status: true },
  })
  if (!activity) return null

  const registrations = await db.activityRegistration.findMany({
    where: {
      activityId,
      status: { in: [...registrationStatusesForActivity(activity.status)] },
      User: { status: 'ACTIVE', isDeleted: false },
    },
    select: { userId: true },
    orderBy: [{ userId: 'asc' }, { id: 'asc' }],
  })
  const userIds = Array.from(new Set(registrations.map((registration) => registration.userId)))
  return { activity, userIds, registrationCount: registrations.length }
}

function serializeBatch(batch: {
  id: string
  activityId: string
  title: string
  content: string
  imageUrl: string | null
  status: string
  recipientCount: number
  sentCount: number
  skippedCount: number
  createdAt: Date
  CreatedBy?: { uid: number; nickname: string } | null
}): ActivityNotificationBatchView {
  return {
    id: batch.id,
    activityId: batch.activityId,
    title: batch.title,
    content: batch.content,
    imageUrl: publicImageUrl(batch.imageUrl),
    status: batch.status,
    recipientCount: batch.recipientCount,
    sentCount: batch.sentCount,
    skippedCount: batch.skippedCount,
    createdAt: batch.createdAt.toISOString(),
    createdBy: batch.CreatedBy ? { uid: batch.CreatedBy.uid, nickname: batch.CreatedBy.nickname } : null,
  }
}

const batchViewSelect = {
  id: true,
  activityId: true,
  title: true,
  content: true,
  imageUrl: true,
  status: true,
  recipientCount: true,
  sentCount: true,
  skippedCount: true,
  createdAt: true,
  CreatedBy: { select: { uid: true, nickname: true } },
} as const

export async function getActivityNotificationOverview(activityId: string) {
  const audience = await getActivityNotificationAudience(prisma, activityId)
  if (!audience) return null
  const history = await prisma.activityNotificationBatch.findMany({
    where: { activityId },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: 50,
    select: batchViewSelect,
  })
  return {
    activity: audience.activity,
    recipientCount: audience.userIds.length,
    registrationCount: audience.registrationCount,
    history: history.map(serializeBatch),
  }
}

export async function sendActivityTargetedNotification(input: {
  activityId: string
  operatorId: string
  title: unknown
  content: unknown
  imageUrl?: unknown
  idempotencyKey: unknown
}) {
  const normalized = normalizeActivityNotificationInput(input)
  const activityId = input.activityId.trim()
  if (!activityIdPattern.test(activityId)) throw new ActivityNotificationError('ACTIVITY_NOT_FOUND', '活动不存在', 404)

  const execute = () => prisma.$transaction(async (tx) => {
    const activity = await tx.activity.findUnique({ where: { id: activityId }, select: { id: true, title: true, status: true } })
    if (!activity) throw new ActivityNotificationError('ACTIVITY_NOT_FOUND', '活动不存在', 404)

    const existing = await tx.activityNotificationBatch.findUnique({ where: { idempotencyKey: normalized.idempotencyKey }, select: batchViewSelect })
    if (existing) {
      if (existing.activityId !== activityId) throw new ActivityNotificationError('IDEMPOTENCY_KEY_REUSED', '发送请求标识已经用于其他活动，请刷新后重试', 409)
      return { duplicate: true, batch: serializeBatch(existing) }
    }

    const audience = await getActivityNotificationAudience(tx, activityId)
    if (!audience || audience.userIds.length === 0) throw new ActivityNotificationError('NO_RECIPIENTS', '当前没有可接收通知的报名用户', 409)

    const batch = await tx.activityNotificationBatch.create({
      data: {
        activityId,
        title: normalized.title,
        content: normalized.content,
        imageUrl: normalized.imageUrl,
        idempotencyKey: normalized.idempotencyKey,
        status: 'SENDING',
        recipientCount: audience.userIds.length,
        createdById: input.operatorId,
      },
      select: { id: true, activityId: true, title: true, content: true, imageUrl: true, status: true, recipientCount: true, sentCount: true, skippedCount: true, createdAt: true },
    })

    const notificationKey = `activity-notification:${batch.id}`
    let sentCount = 0
    for (let offset = 0; offset < audience.userIds.length; offset += notificationChunkSize) {
      const chunk = audience.userIds.slice(offset, offset + notificationChunkSize)
      const result = await createManyNotificationsWithDb(tx, {
        data: chunk.map((recipientId) => ({
          type: 'ACTIVITY',
          title: normalized.title,
          content: normalized.content,
          imageUrl: normalized.imageUrl,
          activityId,
          link: activityNotificationLink(activityId),
          isRead: false,
          recipientId,
          key: notificationKey,
        })),
        skipDuplicates: true,
      }, { operation: 'activity-targeted-notification.send', userId: input.operatorId })
      sentCount += result.count
    }
    const skippedCount = audience.userIds.length - sentCount
    const status = sentCount === audience.userIds.length ? 'SENT' : sentCount > 0 ? 'PARTIAL' : 'FAILED'
    const completed = await tx.activityNotificationBatch.update({
      where: { id: batch.id },
      data: { status, sentCount, skippedCount },
      select: batchViewSelect,
    })
    await createAdminActionAudit(tx, {
      operatorId: input.operatorId,
      action: 'UPDATE_SETTING',
      operationType: adminAuditOperations.ACTIVITY_NOTIFICATION_SEND,
      targetType: 'ACTIVITY_NOTIFICATION_BATCH',
      targetId: batch.id,
      targetTitle: activity.title,
      metadata: {
        activityId,
        batchId: batch.id,
        recipientCount: audience.userIds.length,
        sentCount,
        skippedCount,
        hasImage: Boolean(normalized.imageUrl),
        title: normalized.title,
      } as Prisma.InputJsonValue,
    })
    return { duplicate: false, batch: serializeBatch(completed) }
  }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted, timeout: 60_000, maxWait: 5_000 })

  try {
    return await execute()
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      const existing = await prisma.activityNotificationBatch.findUnique({ where: { idempotencyKey: normalized.idempotencyKey }, select: batchViewSelect })
      if (existing) {
        if (existing.activityId !== activityId) throw new ActivityNotificationError('IDEMPOTENCY_KEY_REUSED', '发送请求标识已经用于其他活动，请刷新后重试', 409)
        return { duplicate: true, batch: serializeBatch(existing) }
      }
    }
    throw error
  }
}
