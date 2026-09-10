import { randomUUID } from 'node:crypto'
import { Prisma } from '@prisma/client'
import { adminAuditOperations, createAdminActionAudit } from '@/lib/admin-audit'
import { publicImageUrl } from '@/lib/images'
import { isPublicMediaProxyUrl, toStoredMediaUrl } from '@/lib/media-url'
import { upsertNotificationWithDb } from '@/lib/notification-write'
import { awardRegistrationFee } from '@/lib/registration-fee'
import { prisma } from '@/lib/prisma'
import { sanitizeText } from '@/lib/security'
import {
  GLOBAL_POINTS_GRANT_BATCH_SIZE,
  GLOBAL_POINTS_GRANT_CLAIM_TIMEOUT_MS,
  GLOBAL_POINTS_GRANT_CONCURRENCY,
  GLOBAL_POINTS_GRANT_CONFIRMATION_TEXT,
  GLOBAL_POINTS_GRANT_CONTENT_MAX_LENGTH,
  GLOBAL_POINTS_GRANT_IDEMPOTENCY_KEY_MAX_LENGTH,
  GLOBAL_POINTS_GRANT_MAX_AMOUNT,
  GLOBAL_POINTS_GRANT_MAX_TOTAL_AMOUNT,
  GLOBAL_POINTS_GRANT_TITLE_MAX_LENGTH,
  globalPointsGrantStatuses,
  requiresGlobalPointsGrantStrongConfirmation,
  type GlobalPointsGrantStatus,
} from '@/lib/global-points-grant-constants'

export {
  GLOBAL_POINTS_GRANT_BATCH_SIZE,
  GLOBAL_POINTS_GRANT_CLAIM_TIMEOUT_MS,
  GLOBAL_POINTS_GRANT_CONCURRENCY,
  GLOBAL_POINTS_GRANT_CONFIRMATION_TEXT,
  GLOBAL_POINTS_GRANT_CONTENT_MAX_LENGTH,
  GLOBAL_POINTS_GRANT_IDEMPOTENCY_KEY_MAX_LENGTH,
  GLOBAL_POINTS_GRANT_MAX_AMOUNT,
  GLOBAL_POINTS_GRANT_MAX_TOTAL_AMOUNT,
  GLOBAL_POINTS_GRANT_TITLE_MAX_LENGTH,
  requiresGlobalPointsGrantStrongConfirmation,
} from '@/lib/global-points-grant-constants'

const idempotencyKeyPattern = new RegExp(`^[A-Za-z0-9:_-]{16,${GLOBAL_POINTS_GRANT_IDEMPOTENCY_KEY_MAX_LENGTH}}$`)
const eligibleUserWhere = {
  uid: { gt: 0 },
  status: 'ACTIVE' as const,
  isDeleted: false,
}

type GrantProcessingPhase = 'POINTS' | 'NOTIFICATION'

export class GlobalPointsGrantError extends Error {
  constructor(
    readonly code:
      | 'INVALID_INPUT'
      | 'NO_RECIPIENTS'
      | 'TOTAL_AMOUNT_TOO_LARGE'
      | 'CONFIRMATION_REQUIRED'
      | 'BATCH_NOT_FOUND'
      | 'IDEMPOTENCY_KEY_REUSED',
    message: string,
    readonly status = 400,
  ) {
    super(message)
    this.name = 'GlobalPointsGrantError'
  }
}

export type NormalizedGlobalPointsGrantInput = {
  title: string
  content: string
  amount: number
  imageUrl: string | null
  idempotencyKey: string
}

export function normalizeGlobalPointsGrantInput(input: {
  title: unknown
  content: unknown
  amount: unknown
  imageUrl?: unknown
  idempotencyKey: unknown
}): NormalizedGlobalPointsGrantInput {
  const title = sanitizeText(input.title, GLOBAL_POINTS_GRANT_TITLE_MAX_LENGTH).trim()
  const content = sanitizeText(input.content, GLOBAL_POINTS_GRANT_CONTENT_MAX_LENGTH).trim()
  const rawAmount = typeof input.amount === 'number'
    ? String(input.amount)
    : typeof input.amount === 'string'
      ? input.amount.trim()
      : ''
  const amount = rawAmount ? Number(rawAmount) : Number.NaN
  const idempotencyKey = typeof input.idempotencyKey === 'string' ? input.idempotencyKey.trim() : ''

  if (!title) throw new GlobalPointsGrantError('INVALID_INPUT', '发放标题不能为空')
  if (!content) throw new GlobalPointsGrantError('INVALID_INPUT', '发放说明不能为空')
  if (!Number.isSafeInteger(amount) || amount < 1 || amount > GLOBAL_POINTS_GRANT_MAX_AMOUNT) {
    throw new GlobalPointsGrantError('INVALID_INPUT', `挂号费必须是 1-${GLOBAL_POINTS_GRANT_MAX_AMOUNT} 的正整数`)
  }
  if (!idempotencyKeyPattern.test(idempotencyKey)) {
    throw new GlobalPointsGrantError('INVALID_INPUT', '发放请求标识无效，请刷新后重试')
  }

  let imageUrl: string | null = null
  if (input.imageUrl !== undefined && input.imageUrl !== null && String(input.imageUrl).trim()) {
    const rawImageUrl = String(input.imageUrl).trim()
    if (!isPublicMediaProxyUrl(rawImageUrl)) {
      throw new GlobalPointsGrantError('INVALID_INPUT', '发放图片必须来自站内上传结果')
    }
    imageUrl = toStoredMediaUrl(rawImageUrl) || rawImageUrl
  }

  return { title, content, amount, imageUrl, idempotencyKey }
}

export function getGlobalPointsGrantRecipientWhere(): Prisma.UserWhereInput {
  return { ...eligibleUserWhere }
}

export function getGlobalPointsGrantPointBusinessKey(batchId: string, userId: string) {
  return `global-points-grant:${batchId}:${userId}`
}

export function getGlobalPointsGrantNotificationKey(batchId: string, userId: string) {
  return `global-points-grant:${batchId}:${userId}`
}

export function buildGlobalPointsGrantNotificationContent(content: string, amount: number) {
  return `${content.trim()}\n\n+${amount} 挂号费`
}

export async function getGlobalPointsGrantRecipientPreview(amount: number) {
  if (!Number.isSafeInteger(amount) || amount < 1 || amount > GLOBAL_POINTS_GRANT_MAX_AMOUNT) {
    throw new GlobalPointsGrantError('INVALID_INPUT', `挂号费必须是 1-${GLOBAL_POINTS_GRANT_MAX_AMOUNT} 的正整数`)
  }
  const recipientCount = await prisma.user.count({ where: getGlobalPointsGrantRecipientWhere() })
  const totalAmount = recipientCount * amount
  return {
    recipientCount,
    totalAmount,
    amount,
    totalAmountWithinLimit: totalAmount <= GLOBAL_POINTS_GRANT_MAX_TOTAL_AMOUNT,
  }
}

const batchViewSelect = {
  id: true,
  idempotencyKey: true,
  title: true,
  content: true,
  imageUrl: true,
  amount: true,
  recipientCount: true,
  totalAmount: true,
  successCount: true,
  failedCount: true,
  processedCount: true,
  pendingCount: true,
  processingCount: true,
  notificationSuccessCount: true,
  notificationFailedCount: true,
  status: true,
  createdAt: true,
  completedAt: true,
  CreatedBy: { select: { uid: true, nickname: true } },
} as const

type GlobalPointsGrantBatchRow = Prisma.GlobalPointsGrantBatchGetPayload<{ select: typeof batchViewSelect }>

function normalizeStatus(value: string): GlobalPointsGrantStatus | string {
  return (globalPointsGrantStatuses as readonly string[]).includes(value) ? value as GlobalPointsGrantStatus : value
}

export function getGlobalPointsGrantBatchStatus(input: {
  successCount: number
  failedCount: number
  pendingCount: number
  processingCount: number
}): GlobalPointsGrantStatus {
  if (input.pendingCount > 0 || input.processingCount > 0) return 'PROCESSING'
  if (input.failedCount === 0) return 'COMPLETED'
  return input.successCount > 0 ? 'PARTIAL_FAILED' : 'FAILED'
}

function serializeBatch(batch: GlobalPointsGrantBatchRow) {
  // A failed points recipient does not need a notification retry. Exclude it
  // from the derived notification-pending count so the admin UI does not poll
  // forever for a notification that can never be sent.
  const notificationPendingCount = Math.max(0, batch.recipientCount - batch.notificationSuccessCount - batch.notificationFailedCount - batch.failedCount)
  return {
    id: batch.id,
    title: batch.title,
    content: batch.content,
    imageUrl: publicImageUrl(batch.imageUrl),
    amount: batch.amount,
    recipientCount: batch.recipientCount,
    totalAmount: batch.totalAmount,
    successAmount: batch.successCount * batch.amount,
    successCount: batch.successCount,
    failedCount: batch.failedCount,
    processedCount: batch.processedCount,
    pendingCount: batch.pendingCount,
    processingCount: batch.processingCount,
    notificationSuccessCount: batch.notificationSuccessCount,
    notificationFailedCount: batch.notificationFailedCount,
    notificationPendingCount,
    status: normalizeStatus(batch.status),
    createdAt: batch.createdAt.toISOString(),
    completedAt: batch.completedAt?.toISOString() || null,
    createdBy: batch.CreatedBy ? { uid: batch.CreatedBy.uid, nickname: batch.CreatedBy.nickname } : null,
  }
}

export type GlobalPointsGrantBatchView = ReturnType<typeof serializeBatch>

const batchMatchSelect = {
  ...batchViewSelect,
} as const

function assertIdempotencyMatch(existing: Pick<GlobalPointsGrantBatchRow, 'title' | 'content' | 'imageUrl' | 'amount'>, input: NormalizedGlobalPointsGrantInput) {
  if (
    existing.title !== input.title
    || existing.content !== input.content
    || existing.imageUrl !== input.imageUrl
    || existing.amount !== input.amount
  ) {
    throw new GlobalPointsGrantError('IDEMPOTENCY_KEY_REUSED', '发放请求标识已经对应另一笔发放，请刷新后重试', 409)
  }
}

function isUniqueConstraintError(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002'
}

function errorMessage(error: unknown) {
  if (error instanceof GlobalPointsGrantError) return error.message
  if (error instanceof Error && error.message) return error.message.slice(0, 500)
  return '处理失败，请稍后重试'
}

export async function getGlobalPointsGrantOverview() {
  const [history, recipientCount] = await Promise.all([
    prisma.globalPointsGrantBatch.findMany({
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 50,
      select: batchViewSelect,
    }),
    prisma.user.count({ where: getGlobalPointsGrantRecipientWhere() }),
  ])
  return {
    recipientCount,
    history: history.map(serializeBatch),
  }
}

const batchDetailSelect = {
  ...batchViewSelect,
  Recipients: {
    where: {
      OR: [
        { pointsStatus: 'FAILED' },
        { notificationStatus: 'FAILED' },
      ],
    },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    take: 100,
    select: {
      id: true,
      userId: true,
      amount: true,
      status: true,
      pointsStatus: true,
      notificationStatus: true,
      failureReason: true,
      notificationFailureReason: true,
      processedAt: true,
      pointsProcessedAt: true,
      notificationProcessedAt: true,
      User: { select: { uid: true, username: true, nickname: true } },
    },
  },
} satisfies Prisma.GlobalPointsGrantBatchSelect

export async function getGlobalPointsGrantDetail(batchId: string) {
  const id = sanitizeText(batchId, 191).trim()
  if (!id) throw new GlobalPointsGrantError('BATCH_NOT_FOUND', '发放批次不存在', 404)
  const batch = await prisma.globalPointsGrantBatch.findUnique({ where: { id }, select: batchDetailSelect })
  if (!batch) throw new GlobalPointsGrantError('BATCH_NOT_FOUND', '发放批次不存在', 404)
  return {
    ...serializeBatch(batch),
    failedRecipients: batch.Recipients.map((recipient) => ({
      id: recipient.id,
      userId: recipient.userId,
      uid: recipient.User?.uid || null,
      username: recipient.User?.username || null,
      nickname: recipient.User?.nickname || null,
      amount: recipient.amount,
      status: recipient.status,
      pointsStatus: recipient.pointsStatus,
      notificationStatus: recipient.notificationStatus,
      failureReason: recipient.failureReason,
      notificationFailureReason: recipient.notificationFailureReason,
      processedAt: recipient.processedAt?.toISOString() || null,
      pointsProcessedAt: recipient.pointsProcessedAt?.toISOString() || null,
      notificationProcessedAt: recipient.notificationProcessedAt?.toISOString() || null,
    })),
  }
}

type GrantBatchRecord = {
  id: string
  title: string
  content: string
  imageUrl: string | null
  amount: number
}

type ClaimedRecipient = {
  id: string
  userId: string
  amount: number
  processingToken: string
}

async function recoverStaleClaims(batchId: string, now = new Date()) {
  const staleBefore = new Date(now.getTime() - GLOBAL_POINTS_GRANT_CLAIM_TIMEOUT_MS)
  const [legacyPoints, stalePoints, legacyNotifications, staleNotifications] = await prisma.$transaction([
    prisma.globalPointsGrantRecipient.updateMany({
      where: { batchId, pointsStatus: 'PROCESSING', processingToken: null },
      data: { pointsStatus: 'PENDING', status: 'PENDING', processingPhase: null, processingStartedAt: null },
    }),
    prisma.globalPointsGrantRecipient.updateMany({
      where: {
        batchId,
        pointsStatus: 'PROCESSING',
        processingPhase: 'POINTS',
        processingStartedAt: { lt: staleBefore },
      },
      data: { pointsStatus: 'PENDING', status: 'PENDING', processingToken: null, processingPhase: null, processingStartedAt: null },
    }),
    prisma.globalPointsGrantRecipient.updateMany({
      where: { batchId, notificationStatus: 'PROCESSING', processingToken: null },
      data: { notificationStatus: 'PENDING', processingPhase: null, processingStartedAt: null },
    }),
    prisma.globalPointsGrantRecipient.updateMany({
      where: {
        batchId,
        notificationStatus: 'PROCESSING',
        processingPhase: 'NOTIFICATION',
        processingStartedAt: { lt: staleBefore },
      },
      data: { notificationStatus: 'PENDING', processingToken: null, processingPhase: null, processingStartedAt: null },
    }),
  ])
  return {
    recoveredPoints: legacyPoints.count + stalePoints.count,
    recoveredNotifications: legacyNotifications.count + staleNotifications.count,
  }
}

export async function recoverStaleGlobalPointsGrantRecipientClaims(batchId?: string, now = new Date()) {
  if (batchId) return recoverStaleClaims(batchId, now)
  const batches = await prisma.globalPointsGrantBatch.findMany({ select: { id: true } })
  let recoveredPoints = 0
  let recoveredNotifications = 0
  for (const batch of batches) {
    const result = await recoverStaleClaims(batch.id, now)
    recoveredPoints += result.recoveredPoints
    recoveredNotifications += result.recoveredNotifications
  }
  return { recoveredPoints, recoveredNotifications }
}

async function reconcileRecipientState(batchId: string) {
  const candidates = await prisma.globalPointsGrantRecipient.findMany({
    where: {
      batchId,
      processingToken: null,
      OR: [
        { pointsStatus: { in: ['PENDING', 'PROCESSING', 'FAILED'] } },
        { pointsStatus: 'SUCCESS', notificationStatus: 'PENDING' },
      ],
    },
    orderBy: [{ id: 'asc' }],
    take: GLOBAL_POINTS_GRANT_BATCH_SIZE,
    select: { id: true, userId: true, pointsStatus: true, notificationStatus: true },
  })
  if (!candidates.length) return { pointsReconciled: 0, notificationsReconciled: 0 }

  const pointKeys = candidates.map((recipient) => getGlobalPointsGrantPointBusinessKey(batchId, recipient.userId))
  const pointLogs = await prisma.pointLog.findMany({
    where: { businessKey: { in: pointKeys } },
    select: { businessKey: true },
  })
  const pointKeySet = new Set(pointLogs.map((log) => log.businessKey).filter((key): key is string => Boolean(key)))
  const notificationRows = await prisma.notification.findMany({
    where: {
      recipientId: { in: candidates.map((recipient) => recipient.userId) },
      key: { in: pointKeys },
    },
    select: { recipientId: true, key: true },
  })
  const notificationKeySet = new Set(notificationRows.map((row) => `${row.recipientId}:${row.key || ''}`))
  let pointsReconciled = 0
  let notificationsReconciled = 0
  await prisma.$transaction(async (tx) => {
    for (const recipient of candidates) {
      const pointKey = getGlobalPointsGrantPointBusinessKey(batchId, recipient.userId)
      if (recipient.pointsStatus !== 'SUCCESS' && pointKeySet.has(pointKey)) {
        const updated = await tx.globalPointsGrantRecipient.updateMany({
          where: { id: recipient.id, pointsStatus: { in: ['PENDING', 'PROCESSING', 'FAILED'] }, processingToken: null },
          data: { pointsStatus: 'SUCCESS', status: 'SUCCESS', failureReason: null, pointsProcessedAt: new Date(), processedAt: new Date(), processingPhase: null, processingStartedAt: null },
        })
        pointsReconciled += updated.count
      }
      if (recipient.notificationStatus !== 'SUCCESS' && notificationKeySet.has(`${recipient.userId}:${pointKey}`)) {
        const updated = await tx.globalPointsGrantRecipient.updateMany({
          where: { id: recipient.id, pointsStatus: 'SUCCESS', notificationStatus: 'PENDING', processingToken: null },
          data: { notificationStatus: 'SUCCESS', notificationFailureReason: null, notificationProcessedAt: new Date(), processingPhase: null, processingStartedAt: null },
        })
        notificationsReconciled += updated.count
      }
    }
  })
  return { pointsReconciled, notificationsReconciled }
}

async function claimRecipient(recipientId: string, phase: GrantProcessingPhase): Promise<ClaimedRecipient | null> {
  const processingToken = randomUUID()
  const processingStartedAt = new Date()
  return prisma.$transaction(async (tx) => {
    const claimed = await tx.globalPointsGrantRecipient.updateMany({
      where: phase === 'POINTS'
        ? { id: recipientId, pointsStatus: 'PENDING', processingToken: null }
        : { id: recipientId, pointsStatus: 'SUCCESS', notificationStatus: 'PENDING', processingToken: null },
      data: phase === 'POINTS'
        ? { pointsStatus: 'PROCESSING', status: 'PROCESSING', failureReason: null, processingToken, processingPhase: phase, processingStartedAt }
        : { notificationStatus: 'PROCESSING', notificationFailureReason: null, processingToken, processingPhase: phase, processingStartedAt },
    })
    if (claimed.count !== 1) return null
    const recipient = await tx.globalPointsGrantRecipient.findUnique({
      where: { id: recipientId },
      select: { id: true, userId: true, amount: true, processingToken: true },
    })
    if (!recipient?.processingToken) return null
    return { ...recipient, processingToken: recipient.processingToken }
  })
}

async function markPointsFailed(recipientId: string, processingToken: string, reason: string) {
  await prisma.globalPointsGrantRecipient.updateMany({
    where: { id: recipientId, pointsStatus: 'PROCESSING', processingPhase: 'POINTS', processingToken },
    data: {
      pointsStatus: 'FAILED',
      status: 'FAILED',
      failureReason: reason,
      pointsProcessedAt: new Date(),
      processedAt: new Date(),
      processingToken: null,
      processingPhase: null,
      processingStartedAt: null,
    },
  }).catch(() => undefined)
}

async function markNotificationFailed(recipientId: string, processingToken: string, reason: string) {
  await prisma.globalPointsGrantRecipient.updateMany({
    where: { id: recipientId, notificationStatus: 'PROCESSING', processingPhase: 'NOTIFICATION', processingToken },
    data: {
      notificationStatus: 'FAILED',
      notificationFailureReason: reason,
      notificationProcessedAt: new Date(),
      processingToken: null,
      processingPhase: null,
      processingStartedAt: null,
    },
  }).catch(() => undefined)
}

async function processPointsRecipient(batch: GrantBatchRecord, recipientId: string) {
  const claimed = await claimRecipient(recipientId, 'POINTS')
  if (!claimed) return { status: 'skipped' as const, awardedAmount: 0 }
  if (!claimed.processingToken) return { status: 'skipped' as const, awardedAmount: 0 }
  try {
    const pointResult = await prisma.$transaction(async (tx) => {
      const user = await tx.user.findFirst({
        // The recipient row is the immutable audience snapshot for this batch.
        // Do not re-evaluate the current global eligibility filter here: a
        // later account-state change must not silently change this batch's
        // fixed audience or make a retry select a different population.
        where: { id: claimed.userId },
        select: { id: true },
      })
      if (!user) throw new Error('RECIPIENT_NOT_ELIGIBLE')

      const result = await awardRegistrationFee(tx, {
        userId: claimed.userId,
        requestedAmount: claimed.amount,
        action: 'GLOBAL_POINTS_GRANT',
        reason: `全站挂号费发放：${batch.title}`,
        businessKey: getGlobalPointsGrantPointBusinessKey(batch.id, claimed.userId),
        sourceEventId: batch.id,
      })
      const processedAt = new Date()
      const updated = await tx.globalPointsGrantRecipient.updateMany({
        where: { id: claimed.id, pointsStatus: 'PROCESSING', processingPhase: 'POINTS', processingToken: claimed.processingToken },
        data: {
          pointsStatus: 'SUCCESS',
          status: 'SUCCESS',
          failureReason: null,
          pointsProcessedAt: processedAt,
          processedAt,
          processingToken: null,
          processingPhase: null,
          processingStartedAt: null,
        },
      })
      if (updated.count !== 1) throw new Error('GRANT_RECIPIENT_CLAIM_LOST')
      return result
    }, { timeout: 15_000, maxWait: 5_000 })
    return { status: 'success' as const, awardedAmount: pointResult.awardedAmount }
  } catch (error) {
    await markPointsFailed(recipientId, claimed.processingToken, errorMessage(error))
    return { status: 'failed' as const, awardedAmount: 0 }
  }
}

async function processNotificationRecipient(batch: GrantBatchRecord, recipientId: string) {
  const claimed = await claimRecipient(recipientId, 'NOTIFICATION')
  if (!claimed) return { status: 'skipped' as const }
  if (!claimed.processingToken) return { status: 'skipped' as const }
  try {
    await prisma.$transaction(async (tx) => {
      const notificationKey = getGlobalPointsGrantNotificationKey(batch.id, claimed.userId)
      await upsertNotificationWithDb(tx, {
        where: { recipientId_key: { recipientId: claimed.userId, key: notificationKey } },
        update: {},
        create: {
          recipientId: claimed.userId,
          type: 'ACTIVITY',
          title: batch.title,
          content: buildGlobalPointsGrantNotificationContent(batch.content, claimed.amount),
          imageUrl: batch.imageUrl,
          link: '/profile',
          key: notificationKey,
          isRead: false,
        },
      }, { operation: 'global-points-grant.notification', userId: claimed.userId })
      const processedAt = new Date()
      const updated = await tx.globalPointsGrantRecipient.updateMany({
        where: { id: claimed.id, pointsStatus: 'SUCCESS', notificationStatus: 'PROCESSING', processingPhase: 'NOTIFICATION', processingToken: claimed.processingToken },
        data: {
          notificationStatus: 'SUCCESS',
          notificationFailureReason: null,
          notificationProcessedAt: processedAt,
          processingToken: null,
          processingPhase: null,
          processingStartedAt: null,
        },
      })
      if (updated.count !== 1) throw new Error('GRANT_RECIPIENT_CLAIM_LOST')
    }, { timeout: 15_000, maxWait: 5_000 })
    return { status: 'success' as const }
  } catch (error) {
    await markNotificationFailed(recipientId, claimed.processingToken, errorMessage(error))
    return { status: 'failed' as const }
  }
}

async function processWithConcurrency<T>(ids: string[], processor: (id: string) => Promise<T>) {
  let nextIndex = 0
  const results: T[] = []
  const workers = Array.from({ length: Math.min(GLOBAL_POINTS_GRANT_CONCURRENCY, ids.length) }, async () => {
    while (true) {
      const index = nextIndex
      nextIndex += 1
      if (index >= ids.length) return
      results.push(await processor(ids[index]))
    }
  })
  await Promise.all(workers)
  return results
}

async function refreshGlobalPointsGrantBatch(batchId: string, operatorId?: string) {
  return prisma.$transaction(async (tx) => {
    const current = await tx.globalPointsGrantBatch.findUnique({
      where: { id: batchId },
      select: { id: true, title: true, amount: true, recipientCount: true, totalAmount: true, status: true, completedAt: true, createdById: true },
    })
    if (!current) throw new GlobalPointsGrantError('BATCH_NOT_FOUND', '发放批次不存在', 404)

    const [successCount, failedCount, pendingCount, processingCount, notificationSuccessCount, notificationFailedCount] = await Promise.all([
      tx.globalPointsGrantRecipient.count({ where: { batchId, pointsStatus: 'SUCCESS' } }),
      tx.globalPointsGrantRecipient.count({ where: { batchId, pointsStatus: 'FAILED' } }),
      tx.globalPointsGrantRecipient.count({ where: { batchId, pointsStatus: 'PENDING' } }),
      tx.globalPointsGrantRecipient.count({ where: { batchId, pointsStatus: 'PROCESSING' } }),
      tx.globalPointsGrantRecipient.count({ where: { batchId, notificationStatus: 'SUCCESS' } }),
      tx.globalPointsGrantRecipient.count({ where: { batchId, notificationStatus: 'FAILED' } }),
    ])
    const processedCount = successCount + failedCount
    const status = getGlobalPointsGrantBatchStatus({ successCount, failedCount, pendingCount, processingCount })
    const pointsFinished = pendingCount === 0 && processingCount === 0
    const completedAt = pointsFinished ? current.completedAt || new Date() : null
    const updated = await tx.globalPointsGrantBatch.update({
      where: { id: batchId },
      data: {
        successCount,
        failedCount,
        processedCount,
        pendingCount,
        processingCount,
        notificationSuccessCount,
        notificationFailedCount,
        status,
        completedAt,
      },
      select: batchViewSelect,
    })

    if (pointsFinished && !(await tx.adminAction.findFirst({
      where: { operationType: adminAuditOperations.ADMIN_GLOBAL_POINTS_GRANT, targetId: batchId },
      select: { id: true },
    }))) {
      await createAdminActionAudit(tx, {
        operatorId: operatorId || current.createdById,
        action: 'UPDATE_SETTING',
        operationType: adminAuditOperations.ADMIN_GLOBAL_POINTS_GRANT,
        targetType: 'GLOBAL_POINTS_GRANT_BATCH',
        targetId: batchId,
        targetTitle: current.title,
        reason: `全站挂号费发放：${current.title}`,
        metadata: {
          batchId,
          amount: current.amount,
          recipientCount: current.recipientCount,
          totalAmount: current.totalAmount,
          successCount,
          failedCount,
          processedCount,
          notificationSuccessCount,
          notificationFailedCount,
          successfulTotalAmount: successCount * current.amount,
          status,
          asynchronous: true,
        } as Prisma.InputJsonValue,
      })
    }
    return updated
  }, { timeout: 15_000, maxWait: 5_000 })
}

export async function refreshGlobalPointsGrantBatchStatus(batchId: string) {
  const refreshed = await refreshGlobalPointsGrantBatch(batchId)
  return serializeBatch(refreshed)
}

export async function getGlobalPointsGrantWorkerBatchCandidates(limit = 4) {
  return prisma.globalPointsGrantBatch.findMany({
    where: {
      OR: [
        { status: 'PROCESSING' },
        { Recipients: { some: { pointsStatus: { in: ['PENDING', 'PROCESSING'] } } } },
        { Recipients: { some: { pointsStatus: 'SUCCESS', notificationStatus: 'PENDING' } } },
      ],
    },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    take: Math.max(1, Math.min(limit, 20)),
    select: { id: true },
  })
}

export async function processGlobalPointsGrantBatchChunk(batchId: string) {
  const batch = await prisma.globalPointsGrantBatch.findUnique({
    where: { id: batchId },
    select: { id: true, title: true, content: true, imageUrl: true, amount: true },
  })
  if (!batch) throw new GlobalPointsGrantError('BATCH_NOT_FOUND', '发放批次不存在', 404)

  await recoverStaleClaims(batchId)
  await reconcileRecipientState(batchId)
  const pointRecipients = await prisma.globalPointsGrantRecipient.findMany({
    where: { batchId, pointsStatus: 'PENDING', processingToken: null },
    orderBy: [{ id: 'asc' }],
    take: GLOBAL_POINTS_GRANT_BATCH_SIZE,
    select: { id: true },
  })
  const pointResults = await processWithConcurrency(pointRecipients.map((recipient) => recipient.id), (id) => processPointsRecipient(batch, id))

  const notificationRecipients = await prisma.globalPointsGrantRecipient.findMany({
    where: { batchId, pointsStatus: 'SUCCESS', notificationStatus: 'PENDING', processingToken: null },
    orderBy: [{ id: 'asc' }],
    take: GLOBAL_POINTS_GRANT_BATCH_SIZE,
    select: { id: true },
  })
  const notificationResults = await processWithConcurrency(notificationRecipients.map((recipient) => recipient.id), (id) => processNotificationRecipient(batch, id))
  const refreshed = await refreshGlobalPointsGrantBatch(batchId)
  return {
    batch: serializeBatch(refreshed),
    pointsSuccessCount: pointResults.filter((result) => result.status === 'success').length,
    pointsFailedCount: pointResults.filter((result) => result.status === 'failed').length,
    notificationSuccessCount: notificationResults.filter((result) => result.status === 'success').length,
    notificationFailedCount: notificationResults.filter((result) => result.status === 'failed').length,
  }
}

export async function processGlobalPointsGrantBatch(batchId: string, operatorId: string, options: { retryFailed?: boolean } = {}) {
  const retryFailed = Boolean(options.retryFailed)
  const batch = await prisma.globalPointsGrantBatch.findUnique({
    where: { id: batchId },
    select: { id: true, status: true },
  })
  if (!batch) throw new GlobalPointsGrantError('BATCH_NOT_FOUND', '发放批次不存在', 404)

  if (retryFailed) {
    await prisma.$transaction([
      prisma.globalPointsGrantRecipient.updateMany({
        where: { batchId, pointsStatus: 'FAILED' },
        data: { pointsStatus: 'PENDING', status: 'PENDING', failureReason: null, pointsProcessedAt: null, processedAt: null, processingToken: null, processingPhase: null, processingStartedAt: null },
      }),
      prisma.globalPointsGrantRecipient.updateMany({
        where: { batchId, notificationStatus: 'FAILED' },
        data: { notificationStatus: 'PENDING', notificationFailureReason: null, notificationProcessedAt: null, processingToken: null, processingPhase: null, processingStartedAt: null },
      }),
      prisma.globalPointsGrantBatch.update({ where: { id: batchId }, data: { status: 'PROCESSING', completedAt: null } }),
    ])
  } else if (batch.status !== 'COMPLETED') {
    await prisma.globalPointsGrantBatch.update({ where: { id: batchId }, data: { status: 'PROCESSING', completedAt: null } })
  }

  const refreshed = await refreshGlobalPointsGrantBatch(batchId, operatorId)
  return serializeBatch(refreshed)
}

export async function createGlobalPointsGrant(input: {
  operatorId: string
  title: unknown
  content: unknown
  amount: unknown
  imageUrl?: unknown
  idempotencyKey: unknown
  confirm: boolean
  confirmationText?: unknown
}) {
  const normalized = normalizeGlobalPointsGrantInput(input)
  const existingBeforePreview = await prisma.globalPointsGrantBatch.findUnique({ where: { idempotencyKey: normalized.idempotencyKey }, select: batchMatchSelect })
  if (existingBeforePreview) {
    assertIdempotencyMatch(existingBeforePreview, normalized)
    return { duplicate: true, batch: serializeBatch(existingBeforePreview) }
  }

  const recipientPreview = await getGlobalPointsGrantRecipientPreview(normalized.amount)
  if (recipientPreview.recipientCount === 0) throw new GlobalPointsGrantError('NO_RECIPIENTS', '当前没有可发放的有效用户', 409)
  if (!recipientPreview.totalAmountWithinLimit) throw new GlobalPointsGrantError('TOTAL_AMOUNT_TOO_LARGE', '本次发放总额超过系统可保存范围', 400)
  if (!input.confirm) throw new GlobalPointsGrantError('CONFIRMATION_REQUIRED', '请先确认收件人数、金额和总额', 400)
  if (requiresGlobalPointsGrantStrongConfirmation(normalized.amount, recipientPreview.totalAmount)) {
    const confirmationText = typeof input.confirmationText === 'string' ? input.confirmationText.trim() : ''
    if (confirmationText !== GLOBAL_POINTS_GRANT_CONFIRMATION_TEXT) {
      throw new GlobalPointsGrantError('CONFIRMATION_REQUIRED', `金额较大，请输入 ${GLOBAL_POINTS_GRANT_CONFIRMATION_TEXT} 后再发放`, 400)
    }
  }

  let created: GlobalPointsGrantBatchRow | null = null
  let duplicate = false
  try {
    const result = await prisma.$transaction(async (tx) => {
      const existing = await tx.globalPointsGrantBatch.findUnique({ where: { idempotencyKey: normalized.idempotencyKey }, select: batchMatchSelect })
      if (existing) {
        assertIdempotencyMatch(existing, normalized)
        return { batch: existing, duplicate: true }
      }

      const users = await tx.user.findMany({ where: getGlobalPointsGrantRecipientWhere(), orderBy: [{ id: 'asc' }], select: { id: true } })
      if (users.length === 0) throw new GlobalPointsGrantError('NO_RECIPIENTS', '当前没有可发放的有效用户', 409)
      const totalAmount = users.length * normalized.amount
      if (totalAmount > GLOBAL_POINTS_GRANT_MAX_TOTAL_AMOUNT) throw new GlobalPointsGrantError('TOTAL_AMOUNT_TOO_LARGE', '本次发放总额超过系统可保存范围', 400)

      const batch = await tx.globalPointsGrantBatch.create({
        data: {
          idempotencyKey: normalized.idempotencyKey,
          title: normalized.title,
          content: normalized.content,
          imageUrl: normalized.imageUrl,
          amount: normalized.amount,
          recipientCount: users.length,
          totalAmount,
          processedCount: 0,
          pendingCount: users.length,
          processingCount: 0,
          notificationSuccessCount: 0,
          notificationFailedCount: 0,
          createdById: input.operatorId,
          status: 'PROCESSING',
        },
        select: batchViewSelect,
      })
      for (let offset = 0; offset < users.length; offset += GLOBAL_POINTS_GRANT_BATCH_SIZE) {
        await tx.globalPointsGrantRecipient.createMany({
          data: users.slice(offset, offset + GLOBAL_POINTS_GRANT_BATCH_SIZE).map((user) => ({
            batchId: batch.id,
            userId: user.id,
            amount: normalized.amount,
            status: 'PENDING',
            pointsStatus: 'PENDING',
            notificationStatus: 'PENDING',
          })),
        })
      }
      return { batch, duplicate: false }
    }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted, timeout: 60_000, maxWait: 5_000 })
    created = result.batch
    duplicate = result.duplicate
  } catch (error) {
    if (!isUniqueConstraintError(error)) throw error
    const existing = await prisma.globalPointsGrantBatch.findUnique({ where: { idempotencyKey: normalized.idempotencyKey }, select: batchMatchSelect })
    if (!existing) throw error
    assertIdempotencyMatch(existing, normalized)
    created = existing
    duplicate = true
  }

  if (!created) throw new Error('GLOBAL_POINTS_GRANT_BATCH_CREATE_FAILED')
  return { duplicate, batch: serializeBatch(created) }
}
