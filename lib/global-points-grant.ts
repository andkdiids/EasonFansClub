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
  status: true,
  createdAt: true,
  completedAt: true,
  CreatedBy: { select: { uid: true, nickname: true } },
} as const

type GlobalPointsGrantBatchRow = Prisma.GlobalPointsGrantBatchGetPayload<{ select: typeof batchViewSelect }>

function normalizeStatus(value: string): GlobalPointsGrantStatus | string {
  return (globalPointsGrantStatuses as readonly string[]).includes(value) ? value as GlobalPointsGrantStatus : value
}

function serializeBatch(batch: GlobalPointsGrantBatchRow) {
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

function shouldRetryFailedOnly(status: string) {
  return status === 'PARTIAL_FAILED' || status === 'FAILED'
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
    where: { status: 'FAILED' },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    take: 100,
    select: {
      id: true,
      userId: true,
      amount: true,
      status: true,
      failureReason: true,
      processedAt: true,
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
      failureReason: recipient.failureReason,
      processedAt: recipient.processedAt?.toISOString() || null,
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

async function processRecipient(batch: GrantBatchRecord, recipientId: string) {
  try {
    const result = await prisma.$transaction(async (tx) => {
      const claimed = await tx.globalPointsGrantRecipient.updateMany({
        where: { id: recipientId, status: { in: ['PENDING', 'FAILED'] } },
        data: { status: 'PROCESSING', failureReason: null },
      })
      if (claimed.count !== 1) return { claimed: false as const }

      const recipient = await tx.globalPointsGrantRecipient.findUnique({
        where: { id: recipientId },
        select: { id: true, userId: true, amount: true },
      })
      if (!recipient) throw new Error('GRANT_RECIPIENT_NOT_FOUND')

      const user = await tx.user.findFirst({
        where: { id: recipient.userId, ...getGlobalPointsGrantRecipientWhere() },
        select: { id: true },
      })
      if (!user) throw new Error('RECIPIENT_NOT_ELIGIBLE')

      const pointResult = await awardRegistrationFee(tx, {
        userId: recipient.userId,
        requestedAmount: recipient.amount,
        action: 'GLOBAL_POINTS_GRANT',
        reason: `全站挂号费发放：${batch.title}`,
        businessKey: getGlobalPointsGrantPointBusinessKey(batch.id, recipient.userId),
        sourceEventId: batch.id,
      })

      const notificationKey = getGlobalPointsGrantNotificationKey(batch.id, recipient.userId)
      await upsertNotificationWithDb(tx, {
        where: { recipientId_key: { recipientId: recipient.userId, key: notificationKey } },
        update: {},
        create: {
          recipientId: recipient.userId,
          type: 'ACTIVITY',
          title: batch.title,
          content: buildGlobalPointsGrantNotificationContent(batch.content, recipient.amount),
          imageUrl: batch.imageUrl,
          link: '/profile',
          key: notificationKey,
          isRead: false,
        },
      }, { operation: 'global-points-grant.notification', userId: recipient.userId })

      await tx.globalPointsGrantRecipient.update({
        where: { id: recipient.id },
        data: { status: 'SUCCESS', failureReason: null, processedAt: new Date() },
      })

      return { claimed: true as const, duplicate: pointResult.duplicate }
    }, { timeout: 15_000, maxWait: 5_000 })
    return result.claimed ? 'success' as const : 'skipped' as const
  } catch (error) {
    // The financial transaction rolls back on notification failure. Only mark
    // a recipient failed after that rollback, and never overwrite a retry that
    // another worker has already claimed in the meantime.
    await prisma.globalPointsGrantRecipient.updateMany({
      where: { id: recipientId, status: { in: ['PENDING', 'FAILED'] } },
      data: { status: 'FAILED', failureReason: errorMessage(error), processedAt: new Date() },
    }).catch(() => undefined)
    return 'failed' as const
  }
}

async function processRecipientChunks(batch: GrantBatchRecord, recipientIds: string[]) {
  let successCount = 0
  let failedCount = 0
  for (let offset = 0; offset < recipientIds.length; offset += GLOBAL_POINTS_GRANT_BATCH_SIZE) {
    const chunk = recipientIds.slice(offset, offset + GLOBAL_POINTS_GRANT_BATCH_SIZE)
    let nextIndex = 0
    const results: Array<'success' | 'skipped' | 'failed'> = []
    const workers = Array.from({ length: Math.min(GLOBAL_POINTS_GRANT_CONCURRENCY, chunk.length) }, async () => {
      while (nextIndex < chunk.length) {
        const recipientId = chunk[nextIndex]
        nextIndex += 1
        results.push(await processRecipient(batch, recipientId))
      }
    })
    await Promise.all(workers)
    successCount += results.filter((result) => result === 'success').length
    failedCount += results.filter((result) => result === 'failed').length
  }
  return { successCount, failedCount }
}

async function refreshBatch(batchId: string, operatorId: string, auditRetry: boolean) {
  return prisma.$transaction(async (tx) => {
    const current = await tx.globalPointsGrantBatch.findUnique({
      where: { id: batchId },
      select: { id: true, title: true, amount: true, recipientCount: true, totalAmount: true, status: true },
    })
    if (!current) throw new GlobalPointsGrantError('BATCH_NOT_FOUND', '发放批次不存在', 404)

    const [successCount, failedCount, pendingCount, processingCount] = await Promise.all([
      tx.globalPointsGrantRecipient.count({ where: { batchId, status: 'SUCCESS' } }),
      tx.globalPointsGrantRecipient.count({ where: { batchId, status: 'FAILED' } }),
      tx.globalPointsGrantRecipient.count({ where: { batchId, status: 'PENDING' } }),
      tx.globalPointsGrantRecipient.count({ where: { batchId, status: 'PROCESSING' } }),
    ])
    const finished = pendingCount === 0 && processingCount === 0
    const status = finished
      ? failedCount === 0 ? 'COMPLETED' : successCount > 0 ? 'PARTIAL_FAILED' : 'FAILED'
      : 'PROCESSING'
    const completedAt = finished ? new Date() : null
    const updated = await tx.globalPointsGrantBatch.update({
      where: { id: batchId },
      data: { successCount, failedCount, status, completedAt },
      select: batchViewSelect,
    })

    if (finished && (auditRetry || !(await tx.adminAction.findFirst({
      where: { operationType: adminAuditOperations.ADMIN_GLOBAL_POINTS_GRANT, targetId: batchId },
      select: { id: true },
    })))) {
      await createAdminActionAudit(tx, {
        operatorId,
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
          successfulTotalAmount: successCount * current.amount,
          status,
          retry: auditRetry,
        } as Prisma.InputJsonValue,
      })
    }
    return updated
  }, { timeout: 15_000, maxWait: 5_000 })
}

export async function processGlobalPointsGrantBatch(batchId: string, operatorId: string, options: { retryFailed?: boolean } = {}) {
  const retryFailed = Boolean(options.retryFailed)
  const batch = await prisma.globalPointsGrantBatch.findUnique({
    where: { id: batchId },
    select: { id: true, title: true, content: true, imageUrl: true, amount: true, status: true },
  })
  if (!batch) throw new GlobalPointsGrantError('BATCH_NOT_FOUND', '发放批次不存在', 404)
  if (batch.status === 'COMPLETED') {
    const current = await prisma.globalPointsGrantBatch.findUniqueOrThrow({ where: { id: batchId }, select: batchViewSelect })
    return serializeBatch(current)
  }

  await prisma.globalPointsGrantBatch.update({
    where: { id: batchId },
    data: { status: 'PROCESSING', completedAt: null },
  })
  const recipients = await prisma.globalPointsGrantRecipient.findMany({
    where: { batchId, status: retryFailed ? 'FAILED' : { in: ['PENDING', 'FAILED'] } },
    orderBy: [{ id: 'asc' }],
    select: { id: true },
  })
  await processRecipientChunks(batch, recipients.map((recipient) => recipient.id))
  const completed = await refreshBatch(batchId, operatorId, retryFailed)
  return serializeBatch(completed)
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
    const batch = await processGlobalPointsGrantBatch(existingBeforePreview.id, input.operatorId, { retryFailed: shouldRetryFailedOnly(existingBeforePreview.status) })
    return { duplicate: true, batch }
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
          createdById: input.operatorId,
          status: 'PENDING',
        },
        select: batchViewSelect,
      })
      for (let offset = 0; offset < users.length; offset += GLOBAL_POINTS_GRANT_BATCH_SIZE) {
        await tx.globalPointsGrantRecipient.createMany({
          data: users.slice(offset, offset + GLOBAL_POINTS_GRANT_BATCH_SIZE).map((user) => ({ batchId: batch.id, userId: user.id, amount: normalized.amount })),
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
  const batch = await processGlobalPointsGrantBatch(created.id, input.operatorId, { retryFailed: duplicate && shouldRetryFailedOnly(created.status) })
  return { duplicate, batch }
}
