import { randomBytes } from 'node:crypto'
import { Prisma } from '@prisma/client'
import type { ActivityVerificationModeValue } from '@/lib/activity'
import { adminAuditOperations, createAdminActionAudit } from '@/lib/admin-audit'
import { grantBadgeWithTransaction } from '@/lib/badge-service'
import { sanitizeText } from '@/lib/security'
import { activityRegistrationQuestionTypeValues } from '@/lib/activity-registration-shared'
import { awardRegistrationFee, consumeRegistrationFee } from '@/lib/registration-fee'
import { publicImageUrl } from '@/lib/images'
import { prisma } from '@/lib/prisma'
import { generateMaterialRedeemCode } from '@/lib/material-redemption-code'
import type { ActivityRegistrationQuestionType, ActivityRegistrationQuestionView, ActivityRegistrationState, ActivityRegistrationView } from '@/lib/activity-registration-shared'

export {
  activityRegistrationQuestionTypeValues,
  activityRegistrationStateValues,
  activityRegistrationStateMessage,
  getActivityRegistrationState,
  type ActivityRegistrationAnswerView,
  type ActivityRegistrationQuestionType,
  type ActivityRegistrationQuestionView,
  type ActivityRegistrationState,
  type ActivityRegistrationView,
} from '@/lib/activity-registration-shared'

export function activityRegistrationSuccessNotificationKey(activityId: string, userId: string, registrationId: string, lifecycleKey: string) {
  return `activity-registration-success:${activityId}:${userId}:${registrationId}:${lifecycleKey}`
}

type RegistrationErrorCode = Exclude<ActivityRegistrationState, 'AVAILABLE'> | 'ACTIVITY_NOT_FOUND' | 'INVALID_ANSWERS' | 'CONFIRMATION_REQUIRED' | 'ALREADY_VERIFIED' | 'VERIFICATION_DISABLED' | 'INVALID_TOKEN' | 'REGISTRATION_NOT_FOUND' | 'CANNOT_CANCEL' | 'ALREADY_CANCELLED' | 'INSUFFICIENT_BALANCE' | 'ACTIVITY_MATERIAL_UNAVAILABLE' | 'ACTIVITY_MATERIAL_INVALID'

export class ActivityRegistrationError extends Error {
  constructor(readonly code: RegistrationErrorCode, message: string, readonly status: number) {
    super(message)
    this.name = 'ActivityRegistrationError'
  }
}

export class ActivityConfigurationError extends Error {
  constructor(readonly message: string) {
    super(message)
    this.name = 'ActivityConfigurationError'
  }
}

export class ActivityVerificationError extends Error {
  constructor(
    readonly code: 'VERIFICATION_DISABLED' | 'INVALID_TOKEN' | 'REGISTRATION_NOT_FOUND' | 'REGISTRATION_CANCELLED' | 'ALREADY_VERIFIED' | 'LINKED_MATERIAL_UNAVAILABLE',
    message: string,
    readonly status = 409,
  ) {
    super(message)
    this.name = 'ActivityVerificationError'
  }
}

type RegistrationQuestionOptionInput = { label: string; value: string; sortOrder: number }

export type NormalizedRegistrationQuestion = {
  id?: string
  title: string
  type: ActivityRegistrationQuestionType
  required: boolean
  placeholder: string | null
  sortOrder: number
  options: RegistrationQuestionOptionInput[]
}

export function parseRegistrationQuestions(value: unknown): { valid: true; value: NormalizedRegistrationQuestion[] } | { valid: false; message: string } {
  if (!Array.isArray(value)) return { valid: false, message: '报名表题目格式不正确' }
  if (value.length > 30) return { valid: false, message: '报名表最多支持 30 个问题' }

  const questions: NormalizedRegistrationQuestion[] = []
  const seenIds = new Set<string>()
  for (let index = 0; index < value.length; index += 1) {
    const item = value[index]
    if (!item || typeof item !== 'object' || Array.isArray(item)) return { valid: false, message: `第 ${index + 1} 个问题格式不正确` }
    const record = item as Record<string, unknown>
    const title = sanitizeText(record.title ?? record.label, 300)
    if (!title) return { valid: false, message: `第 ${index + 1} 个问题不能为空` }
    const type = typeof record.type === 'string' && activityRegistrationQuestionTypeValues.includes(record.type as ActivityRegistrationQuestionType)
      ? record.type as ActivityRegistrationQuestionType
      : null
    if (!type) return { valid: false, message: `第 ${index + 1} 个问题类型不正确` }

    const rawId = typeof record.id === 'string' ? record.id.trim() : ''
    const id = rawId && /^[A-Za-z0-9_-]{8,191}$/.test(rawId) && !seenIds.has(rawId) ? rawId : undefined
    if (id) seenIds.add(id)
    const rawOptions = Array.isArray(record.options) ? record.options : []
    const isChoice = type === 'SINGLE_SELECT' || type === 'MULTI_SELECT' || type === 'SELECT'
    if (isChoice && !rawOptions.length) return { valid: false, message: `第 ${index + 1} 个选择题至少需要一个选项` }
    if (rawOptions.length > 50) return { valid: false, message: `第 ${index + 1} 个问题最多支持 50 个选项` }

    const options: RegistrationQuestionOptionInput[] = []
    const seenValues = new Set<string>()
    for (let optionIndex = 0; optionIndex < rawOptions.length; optionIndex += 1) {
      const option = rawOptions[optionIndex]
      if (!option || typeof option !== 'object' || Array.isArray(option)) return { valid: false, message: `第 ${index + 1} 个选项格式不正确` }
      const optionRecord = option as Record<string, unknown>
      const label = sanitizeText(optionRecord.label, 300)
      if (!label) return { valid: false, message: `第 ${index + 1} 个选项不能为空` }
      const requestedValue = sanitizeText(optionRecord.value, 300)
      let optionValue = requestedValue || `option-${optionIndex + 1}`
      while (seenValues.has(optionValue)) optionValue = `${optionValue}-${optionIndex + 1}`
      seenValues.add(optionValue)
      options.push({ label, value: optionValue, sortOrder: optionIndex })
    }

    questions.push({
      id,
      title,
      type,
      required: record.required === true || record.required === 'true' || record.required === 1,
      placeholder: sanitizeText(record.placeholder, 300) || null,
      sortOrder: Number.isInteger(record.sortOrder) ? Number(record.sortOrder) : index,
      options,
    })
  }
  return { valid: true, value: questions }
}

export const activityRegistrationQuestionSelect = {
  id: true,
  title: true,
  type: true,
  required: true,
  isActive: true,
  placeholder: true,
  sortOrder: true,
  Options: {
    orderBy: [{ sortOrder: 'asc' as const }, { id: 'asc' as const }],
    select: { id: true, label: true, value: true, sortOrder: true },
  },
} satisfies Prisma.ActivityRegistrationQuestionSelect

export type ActivityRegistrationQuestionRow = Prisma.ActivityRegistrationQuestionGetPayload<{ select: typeof activityRegistrationQuestionSelect }>

export function serializeRegistrationQuestion(row: ActivityRegistrationQuestionRow): ActivityRegistrationQuestionView {
  return { id: row.id, title: row.title, type: row.type, required: row.required, placeholder: row.placeholder, sortOrder: row.sortOrder, options: row.Options }
}

type QuestionDatabase = Pick<Prisma.TransactionClient, 'activityRegistrationQuestion'>

export async function getActivityRegistrationQuestions(db: QuestionDatabase, activityId: string) {
  const rows = await db.activityRegistrationQuestion.findMany({
    where: { activityId, isActive: true },
    orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
    select: activityRegistrationQuestionSelect,
  })
  return rows.map(serializeRegistrationQuestion)
}

export type NormalizedRegistrationAnswer = { questionId: string; questionTitle: string; value: string }

function isBlank(value: unknown) {
  return value === undefined || value === null || (typeof value === 'string' && !value.trim()) || (Array.isArray(value) && value.length === 0)
}

function validPhone(value: string) {
  return /^\+?[0-9()\-\s]{6,32}$/.test(value)
}

export function validateRegistrationAnswers(
  questions: readonly (Pick<ActivityRegistrationQuestionView, 'id' | 'title' | 'type' | 'required'> & { options: readonly { value: string }[] })[],
  rawAnswers: unknown,
): { valid: true; value: NormalizedRegistrationAnswer[] } | { valid: false; message: string } {
  const answers = rawAnswers && typeof rawAnswers === 'object' && !Array.isArray(rawAnswers) ? rawAnswers as Record<string, unknown> : {}
  const result: NormalizedRegistrationAnswer[] = []
  for (const question of questions) {
    const raw = answers[question.id]
    if (isBlank(raw)) {
      if (question.required) return { valid: false, message: `请填写：${question.title}` }
      continue
    }
    if (question.type === 'MULTI_SELECT') {
      if (!Array.isArray(raw)) return { valid: false, message: `${question.title}请选择有效选项` }
      const values = raw.filter((item): item is string => typeof item === 'string').map((item) => item.trim())
      const allowed = new Set(question.options.map((option) => option.value))
      if (!values.length || values.some((item) => !allowed.has(item)) || new Set(values).size !== values.length) return { valid: false, message: `${question.title}请选择有效选项` }
      result.push({ questionId: question.id, questionTitle: question.title, value: JSON.stringify(values) })
      continue
    }
    if (question.type === 'SINGLE_SELECT' || question.type === 'SELECT') {
      if (typeof raw !== 'string' || !question.options.some((option) => option.value === raw.trim())) return { valid: false, message: `${question.title}请选择有效选项` }
      result.push({ questionId: question.id, questionTitle: question.title, value: raw.trim() })
      continue
    }
    if (typeof raw !== 'string' && typeof raw !== 'number') return { valid: false, message: `请填写：${question.title}` }
    const text = String(raw).trim()
    const maxLength = question.type === 'TEXTAREA' ? 10_000 : 2_000
    if (text.length > maxLength) return { valid: false, message: `${question.title}内容过长` }
    if (question.type === 'NUMBER' && (!text || !Number.isFinite(Number(text)))) return { valid: false, message: `${question.title}必须是数字` }
    if (question.type === 'PHONE' && !validPhone(text)) return { valid: false, message: `${question.title}格式不正确` }
    result.push({ questionId: question.id, questionTitle: question.title, value: text })
  }
  return { valid: true, value: result }
}

export function decodeRegistrationAnswer(value: string): string | string[] {
  try {
    const parsed: unknown = JSON.parse(value)
    if (Array.isArray(parsed) && parsed.every((item) => typeof item === 'string')) return parsed
  } catch {
    // Scalar answers are intentionally stored as text.
  }
  return value
}

export const activityRegistrationSelect = {
  id: true,
  status: true,
  paidRegistrationFee: true,
  registeredAt: true,
  cancelledAt: true,
  verifiedAt: true,
  verificationMethod: true,
  checkInSource: true,
  checkedInAt: true,
  verificationToken: true,
  LinkedMaterialRedemption: {
    select: {
      id: true,
      status: true,
      redeemCode: true,
      redeemedAt: true,
      material: { select: { title: true, coverImageUrl: true } },
    },
  },
  Answers: {
    orderBy: [{ createdAt: 'asc' as const }, { id: 'asc' as const }],
    select: { questionId: true, questionTitle: true, value: true },
  },
} satisfies Prisma.ActivityRegistrationSelect

export type ActivityRegistrationRow = Prisma.ActivityRegistrationGetPayload<{ select: typeof activityRegistrationSelect }>

export function serializeActivityRegistration(row: ActivityRegistrationRow): ActivityRegistrationView {
  return {
    id: row.id,
    status: row.status,
    paidRegistrationFee: row.paidRegistrationFee,
    registeredAt: row.registeredAt.toISOString(),
    cancelledAt: row.cancelledAt?.toISOString() || null,
    verifiedAt: row.verifiedAt?.toISOString() || null,
    verificationMethod: row.verificationMethod,
    checkInSource: row.checkInSource,
    checkedInAt: row.checkedInAt?.toISOString() || null,
    verificationToken: row.verificationToken || null,
    linkedMaterialRedemption: row.LinkedMaterialRedemption ? {
      id: row.LinkedMaterialRedemption.id,
      title: row.LinkedMaterialRedemption.material.title,
      coverImageUrl: publicImageUrl(row.LinkedMaterialRedemption.material.coverImageUrl),
      status: row.LinkedMaterialRedemption.status,
      redeemCode: row.LinkedMaterialRedemption.redeemCode,
      redeemedAt: row.LinkedMaterialRedemption.redeemedAt?.toISOString() || null,
    } : null,
    answers: row.Answers.map((answer) => ({ questionId: answer.questionId, questionTitle: answer.questionTitle, value: decodeRegistrationAnswer(answer.value) })),
  }
}

export function generateActivityRegistrationToken() {
  return randomBytes(32).toString('base64url')
}

/**
 * A fresh opaque identifier for each real registration lifecycle. It is kept
 * in the notification dedupe key, not in the QR token, so a cancel/re-register
 * cycle can create a new success notification without exposing a verifier.
 */
export function generateActivityRegistrationLifecycleKey() {
  return randomBytes(16).toString('hex')
}

export async function countActiveActivityRegistrations(db: Pick<Prisma.TransactionClient, 'activityRegistration'>, activityId: string) {
  return db.activityRegistration.count({ where: { activityId, status: 'ACTIVE' } })
}

export async function syncActivitySignupCount(tx: Prisma.TransactionClient, activityId: string) {
  const count = await countActiveActivityRegistrations(tx, activityId)
  await tx.activity.update({ where: { id: activityId }, data: { signupCount: count }, select: { id: true } })
  return count
}

export async function syncActivityRegistrationQuestions(tx: Prisma.TransactionClient, activityId: string, rawQuestions: unknown) {
  const parsed = parseRegistrationQuestions(rawQuestions)
  if (!parsed.valid) throw new ActivityConfigurationError(parsed.message)
  const existing = await tx.activityRegistrationQuestion.findMany({ where: { activityId }, select: { id: true } })
  const existingIds = new Set(existing.map((item) => item.id))
  const submittedIds: string[] = []

  for (const question of parsed.value) {
    const existingId = question.id && existingIds.has(question.id) ? question.id : null
    const saved = existingId
      ? await tx.activityRegistrationQuestion.update({
          where: { id: existingId },
          data: { title: question.title, type: question.type, required: question.required, isActive: true, placeholder: question.placeholder, sortOrder: question.sortOrder },
          select: { id: true },
        })
      : await tx.activityRegistrationQuestion.create({
          data: { activityId, title: question.title, type: question.type, required: question.required, isActive: true, placeholder: question.placeholder, sortOrder: question.sortOrder },
          select: { id: true },
        })
    submittedIds.push(saved.id)
    await tx.activityRegistrationQuestionOption.deleteMany({ where: { questionId: saved.id } })
    if (question.options.length) await tx.activityRegistrationQuestionOption.createMany({
      data: question.options.map((option) => ({ questionId: saved.id, label: option.label, value: option.value, sortOrder: option.sortOrder })),
    })
  }

  const hiddenIds = existing.map((item) => item.id).filter((id) => !submittedIds.includes(id))
  if (hiddenIds.length) await tx.activityRegistrationQuestion.updateMany({ where: { activityId, id: { in: hiddenIds } }, data: { isActive: false } })
}

export async function syncActivityReward(tx: Prisma.TransactionClient, activityId: string, rawReward: unknown, verificationMode: ActivityVerificationModeValue) {
  if (rawReward === undefined) return
  const rewardRecord = rawReward && typeof rawReward === 'object' && !Array.isArray(rawReward) ? rawReward as Record<string, unknown> : null
  const badgeId = typeof rawReward === 'string' ? rawReward.trim() : typeof rewardRecord?.badgeId === 'string' ? rewardRecord.badgeId.trim() : ''
  const enabled = rewardRecord?.enabled !== false
  if (!badgeId || !enabled) {
    await tx.activityReward.deleteMany({ where: { activityId, type: 'BADGE' } })
    return
  }
  if (verificationMode === 'NONE') throw new ActivityConfigurationError('配置活动奖励前，请先选择手动核销或扫码核销')
  const badge = await tx.badge.findUnique({ where: { id: badgeId }, select: { id: true, isEnabled: true, isActive: true } })
  if (!badge || !badge.isEnabled || !badge.isActive) throw new ActivityConfigurationError('请选择有效且启用中的勋章')
  await tx.activityReward.upsert({
    where: { activityId_type: { activityId, type: 'BADGE' } },
    update: { badgeId, enabled: true },
    create: { activityId, type: 'BADGE', badgeId, enabled: true },
  })
}

const activityMaterialOrderIdempotencyPrefix = 'activity-registration-material:'

type ActivityMaterialOrderInput = {
  activityId: string
  registrationId: string
  userId: string
  materialId: string
  registrationFee: number
  activityTitle: string
  now: Date
}

/**
 * Creates the zero-cost material order that belongs to one activity
 * registration.  The activity registration transaction owns the fee and the
 * stock reservation, so a retry can never charge the material a second time.
 */
export async function createActivityMaterialOrderInTransaction(tx: Prisma.TransactionClient, input: ActivityMaterialOrderInput) {
  const idempotencyKey = `${activityMaterialOrderIdempotencyPrefix}${input.registrationId}`
  const existing = await tx.materialRedemptionOrder.findUnique({
    where: { idempotencyKey },
    select: { id: true, userId: true, materialId: true, linkedActivityId: true, source: true, status: true },
  })
  if (existing) {
    if (existing.userId !== input.userId || existing.materialId !== input.materialId || existing.linkedActivityId !== input.activityId || existing.source !== 'ACTIVITY_REGISTRATION_AUTO') {
      throw new ActivityRegistrationError('ACTIVITY_MATERIAL_INVALID', '活动物料自动兑换记录已被其他业务占用', 409)
    }
    await tx.activityRegistration.update({ where: { id: input.registrationId }, data: { linkedMaterialRedemptionId: existing.id }, select: { id: true } })
    return { orderId: existing.id, title: null as string | null, duplicate: true }
  }

  const material = await tx.materialRedemption.findUnique({
    where: { id: input.materialId },
    select: { id: true, title: true, description: true, coverImageUrl: true, cost: true, stockTotal: true, stockRemaining: true, status: true, redemptionRule: true, linkedActivityId: true },
  })
  if (!material || material.redemptionRule !== 'ACTIVITY_REGISTRATION_REQUIRED' || material.linkedActivityId !== input.activityId) {
    throw new ActivityRegistrationError('ACTIVITY_MATERIAL_INVALID', '活动绑定的物料配置已变化，请联系管理员', 409)
  }
  if (material.status !== 'PUBLISHED') throw new ActivityRegistrationError('ACTIVITY_MATERIAL_UNAVAILABLE', '活动物料当前未发布，暂时无法报名', 409)

  // Conditional decrement is the oversell guard.  It also makes a material
  // reservation part of the same transaction as the registration itself.
  const stockChanged = await tx.materialRedemption.updateMany({
    where: { id: material.id, status: 'PUBLISHED', redemptionRule: 'ACTIVITY_REGISTRATION_REQUIRED', linkedActivityId: input.activityId, stockRemaining: { gte: 1 } },
    data: { stockRemaining: { decrement: 1 } },
  })
  if (stockChanged.count !== 1) throw new ActivityRegistrationError('ACTIVITY_MATERIAL_UNAVAILABLE', '活动物料已兑换完，暂时无法报名', 409)

  const order = await tx.materialRedemptionOrder.create({
    data: {
      materialId: material.id,
      userId: input.userId,
      quantity: 1,
      // The activity fee is the only charge.  Keeping this order at zero
      // prevents ordinary material accounting from charging the user again.
      unitCost: 0,
      totalCost: 0,
      status: 'SUCCESS',
      source: 'ACTIVITY_REGISTRATION_AUTO',
      linkedActivityId: input.activityId,
      redeemCode: generateMaterialRedeemCode(),
      redeemToken: randomBytes(32).toString('base64url'),
      eligibilitySnapshot: {
        type: 'ACTIVITY_REGISTRATION_AUTO',
        activityId: input.activityId,
        activityTitle: input.activityTitle,
        registrationId: input.registrationId,
        registrationFee: input.registrationFee,
        materialCostIgnored: material.cost,
        quantity: 1,
        cost: 0,
      } as Prisma.InputJsonValue,
      idempotencyKey,
    },
    select: { id: true, status: true },
  })
  await tx.activityRegistration.update({ where: { id: input.registrationId }, data: { linkedMaterialRedemptionId: order.id }, select: { id: true } })
  return { orderId: order.id, title: material.title, duplicate: false }
}

export type ActivityVerificationMethodValue = 'MANUAL' | 'QR'

function verificationTokenFromInput(value: string) {
  const raw = value.trim()
  if (!raw) return ''
  try {
    const parsed = new URL(raw)
    return parsed.searchParams.get('token')?.trim() || parsed.pathname.split('/').filter(Boolean).pop() || ''
  } catch {
    return raw
  }
}

type ActivityVerificationTransactionInput = {
  activityId: string
  adminId: string
  method: ActivityVerificationMethodValue
  registrationId?: string
  token?: string
  allowLinkedMaterial?: boolean
}

const verificationRegistrationSelect = {
  id: true,
  status: true,
  verifiedAt: true,
  verifiedById: true,
  verificationMethod: true,
  checkInSource: true,
  checkedInAt: true,
  userId: true,
  linkedMaterialRedemptionId: true,
  LinkedMaterialRedemption: {
    select: { id: true, status: true, source: true, redeemCode: true, redeemedAt: true },
  },
} satisfies Prisma.ActivityRegistrationSelect

type VerificationRegistration = Prisma.ActivityRegistrationGetPayload<{ select: typeof verificationRegistrationSelect }>

async function redeemLinkedMaterialInTransaction(tx: Prisma.TransactionClient, registration: VerificationRegistration, adminId: string, redemptionSource: 'ACTIVITY_CHECK_IN' | 'ACTIVITY_AUTO_CHECK_IN', now: Date) {
  const order = registration.LinkedMaterialRedemption
  if (!order) {
    if (registration.linkedMaterialRedemptionId) throw new ActivityVerificationError('LINKED_MATERIAL_UNAVAILABLE', '报名关联的活动物料记录不存在')
    return { changed: false, orderId: null as string | null }
  }
  if (order.status === 'CANCELLED' || order.status === 'REFUNDED' || order.status === 'EXPIRED') throw new ActivityVerificationError('LINKED_MATERIAL_UNAVAILABLE', '报名关联的活动物料当前不可核销')
  if (order.status === 'REDEEMED') return { changed: false, orderId: order.id }
  const changed = await tx.materialRedemptionOrder.updateMany({
    where: { id: order.id, status: 'SUCCESS' },
    data: { status: 'REDEEMED', redeemedAt: now, redeemedByAdminId: adminId || null, redemptionSource },
  })
  if (changed.count !== 1) {
    const latest = await tx.materialRedemptionOrder.findUnique({ where: { id: order.id }, select: { status: true } })
    if (latest?.status === 'REDEEMED') return { changed: false, orderId: order.id }
    throw new ActivityVerificationError('LINKED_MATERIAL_UNAVAILABLE', '活动物料核销状态发生变化，请刷新后重试')
  }
  return { changed: true, orderId: order.id }
}

export async function verifyActivityRegistrationInTransaction(tx: Prisma.TransactionClient, input: ActivityVerificationTransactionInput, now = new Date()) {
  const lockedActivity = await tx.$queryRaw<Array<{ id: string }>>`SELECT \`id\` FROM \`Activity\` WHERE \`id\` = ${input.activityId} FOR UPDATE`
  if (!lockedActivity.length) throw new ActivityVerificationError('REGISTRATION_NOT_FOUND', '活动不存在', 404)
  const activity = await tx.activity.findUnique({
    where: { id: input.activityId },
    select: {
      id: true,
      title: true,
      verificationMode: true,
      startsAt: true,
      ActivityReward: { where: { enabled: true }, select: { id: true, type: true, badgeId: true } },
    },
  })
  const linkedMaterialVerification = input.allowLinkedMaterial === true
  if (!activity || (!linkedMaterialVerification && (activity.verificationMode === 'NONE' || activity.verificationMode !== input.method))) throw new ActivityVerificationError('VERIFICATION_DISABLED', '这场活动未启用当前核销方式')

  const token = input.method === 'QR' ? verificationTokenFromInput(input.token || '') : ''
  if (input.method === 'QR' && !token) throw new ActivityVerificationError('INVALID_TOKEN', '二维码核销令牌无效', 400)
  const registration = await tx.activityRegistration.findFirst({
    where: {
      activityId: input.activityId,
      ...(input.method === 'QR' ? { verificationToken: token } : { id: input.registrationId || '' }),
    },
    select: verificationRegistrationSelect,
  })
  if (!registration) throw new ActivityVerificationError('REGISTRATION_NOT_FOUND', '找不到对应的有效报名记录', 404)
  await tx.$queryRaw`SELECT \`id\` FROM \`ActivityRegistration\` WHERE \`id\` = ${registration.id} FOR UPDATE`
  const current = await tx.activityRegistration.findUnique({ where: { id: registration.id }, select: verificationRegistrationSelect })
  if (!current) throw new ActivityVerificationError('REGISTRATION_NOT_FOUND', '报名记录不存在', 404)
  if (current.status === 'CANCELLED') throw new ActivityVerificationError('REGISTRATION_CANCELLED', '该报名已取消')
  if (current.LinkedMaterialRedemption?.source === 'ACTIVITY_REGISTRATION_AUTO' && activity.startsAt && now < activity.startsAt) {
    throw new ActivityVerificationError('LINKED_MATERIAL_UNAVAILABLE', '活动尚未开始，暂不能核销活动物料')
  }

  const linkedMaterial = await redeemLinkedMaterialInTransaction(tx, current, input.adminId, 'ACTIVITY_CHECK_IN', now)
  if (current.verifiedAt) return { alreadyVerified: true, registrationId: current.id, verifiedAt: current.verifiedAt.toISOString(), verificationMethod: current.verificationMethod, checkInSource: current.checkInSource, rewardGranted: false, linkedMaterialRedemptionId: linkedMaterial.orderId, linkedMaterialRedeemed: linkedMaterial.changed }

  const verifiedAt = now
  await tx.activityRegistration.update({ where: { id: current.id }, data: { verifiedAt, verifiedById: input.adminId, verificationMethod: input.method, checkedInAt: verifiedAt, checkInSource: input.method }, select: { id: true } })
  const reward = activity.ActivityReward.find((item) => item.type === 'BADGE')
  let rewardGranted = false
  let rewardId: string | null = null
  let rewardBadgeId: string | null = null
  if (reward) {
    rewardId = reward.id
    rewardBadgeId = reward.badgeId
    const granted = await grantBadgeWithTransaction(tx, {
      userId: current.userId,
      badgeId: reward.badgeId,
      sourceType: 'ACTIVITY_VERIFICATION',
      sourceId: activity.id,
      grantReason: `活动「${activity.title}」完成现场核销`,
      actorId: input.adminId,
      availabilityMode: 'ADMIN_MANUAL',
    })
    rewardGranted = granted.created
  }
  await createAdminActionAudit(tx, {
    operatorId: input.adminId,
    action: 'CREATE_ACTIVITY',
    operationType: adminAuditOperations.ACTIVITY_REGISTRATION_VERIFY,
    targetType: 'ACTIVITY_REGISTRATION',
    targetId: current.id,
    targetTitle: activity.title,
    targetUserId: current.userId,
    metadata: { activityId: activity.id, registrationId: current.id, rewardId, method: input.method, rewardBadgeId, rewardGranted, linkedMaterialRedemptionId: linkedMaterial.orderId, linkedMaterialRedeemed: linkedMaterial.changed } as Prisma.InputJsonValue,
  })
  return { alreadyVerified: false, registrationId: current.id, verifiedAt: verifiedAt.toISOString(), verificationMethod: input.method, checkInSource: input.method, rewardGranted, linkedMaterialRedemptionId: linkedMaterial.orderId, linkedMaterialRedeemed: linkedMaterial.changed }
}

export async function verifyActivityRegistration(input: ActivityVerificationTransactionInput) {
  return prismaTransaction((tx) => verifyActivityRegistrationInTransaction(tx, input))
}

export async function autoCheckInActivityRegistrationInTransaction(tx: Prisma.TransactionClient, registrationId: string, now = new Date()) {
  const initial = await tx.activityRegistration.findUnique({ where: { id: registrationId }, select: { activityId: true } })
  if (!initial) return { processed: false, reason: 'NOT_FOUND' as const }
  await tx.$queryRaw`SELECT \`id\` FROM \`Activity\` WHERE \`id\` = ${initial.activityId} FOR UPDATE`
  await tx.$queryRaw`SELECT \`id\` FROM \`ActivityRegistration\` WHERE \`id\` = ${registrationId} FOR UPDATE`
  const registration = await tx.activityRegistration.findUnique({ where: { id: registrationId }, select: verificationRegistrationSelect })
  const activity = await tx.activity.findUnique({ where: { id: initial.activityId }, select: { id: true, title: true, endsAt: true, ActivityReward: { where: { enabled: true }, select: { id: true, type: true, badgeId: true } } } })
  if (!registration || !activity) return { processed: false, reason: 'NOT_FOUND' as const }
  if (registration.status === 'CANCELLED') return { processed: false, reason: 'CANCELLED' as const }
  if (registration.verifiedAt) return { processed: false, reason: 'ALREADY_VERIFIED' as const }
  if (!activity.endsAt || activity.endsAt >= now) return { processed: false, reason: 'NOT_ENDED' as const }
  const linkedMaterial = await redeemLinkedMaterialInTransaction(tx, registration, '', 'ACTIVITY_AUTO_CHECK_IN', now)
  await tx.activityRegistration.update({ where: { id: registration.id }, data: { verifiedAt: now, checkedInAt: now, verifiedById: null, verificationMethod: null, checkInSource: 'AUTO_AFTER_ACTIVITY_END' }, select: { id: true } })
  const reward = activity.ActivityReward.find((item) => item.type === 'BADGE')
  let rewardGranted = false
  if (reward) {
    const granted = await grantBadgeWithTransaction(tx, {
      userId: registration.userId,
      badgeId: reward.badgeId,
      sourceType: 'ACTIVITY_VERIFICATION',
      sourceId: activity.id,
      grantReason: `活动「${activity.title}」结束后自动完成核销`,
      availabilityMode: 'ADMIN_MANUAL',
    })
    rewardGranted = granted.created
  }
  return { processed: true, registrationId: registration.id, activityId: activity.id, linkedMaterialRedemptionId: linkedMaterial.orderId, rewardGranted }
}

export async function autoCheckInEndedActivityRegistrations(options: { activityId?: string; batchSize?: number; now?: Date } = {}) {
  const now = options.now || new Date()
  const batchSize = Math.min(Math.max(options.batchSize || 100, 1), 500)
  const candidates = await prisma.activityRegistration.findMany({
    where: {
      ...(options.activityId ? { activityId: options.activityId } : {}),
      status: 'ACTIVE',
      verifiedAt: null,
      Activity: { endsAt: { lt: now } },
    },
    orderBy: [{ registeredAt: 'asc' }, { id: 'asc' }],
    take: batchSize,
    select: { id: true },
  })
  let processed = 0
  let failed = 0
  for (const candidate of candidates) {
    try {
      const result = await prismaTransaction((tx) => autoCheckInActivityRegistrationInTransaction(tx, candidate.id, now))
      if (result.processed) processed += 1
    } catch (error) {
      failed += 1
      console.error('[activities.auto-check-in]', { registrationId: candidate.id, error: error instanceof Error ? error.message : String(error) })
    }
  }
  return { scanned: candidates.length, processed, failed }
}

async function prismaTransaction<T>(callback: (tx: Prisma.TransactionClient) => Promise<T>) {
  const { prisma } = await import('@/lib/prisma')
  return prisma.$transaction(callback, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted, timeout: 15_000, maxWait: 5_000 })
}
