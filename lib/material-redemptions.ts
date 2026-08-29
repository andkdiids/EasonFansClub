import { randomBytes } from 'node:crypto'
import { Prisma, type PrismaClient } from '@prisma/client'
import { accountAgeDays } from '@/lib/badge-metrics'
import { calculateCheckinStreaks } from '@/lib/checkin'
import { publicImageUrl } from '@/lib/images'
import { prisma } from '@/lib/prisma'
import { awardRegistrationFee, consumeRegistrationFee } from '@/lib/registration-fee'
import { generateMaterialRedeemCode } from '@/lib/material-redemption-code'
import {
  canExchangeMaterial,
  canRedeemMaterial,
  compareMaterialRuleValue,
  getMaterialExchangeState,
  isMaterialRedeemToken,
  isMaterialRedemptionRuleOperator,
  isMaterialRedemptionRuleType,
  parseMaterialRedeemCode,
  parseDateInput,
  parsePositiveInteger,
  validateMaterialRedemptionSchedule,
  type MaterialRedemptionStatusValue,
  type MaterialRedemptionSchedule,
} from '@/lib/material-redemption-domain'
import { sanitizeText } from '@/lib/security'
import { createNotification } from '@/lib/notification-write'
import { autoCheckInActivityRegistrationInTransaction, verifyActivityRegistrationInTransaction } from '@/lib/activity-registration'
import { ACTIVITY_MATERIAL_RULE, activityMaterialSchedule, isActivityMaterialRule, ActivityMaterialConfigurationError } from '@/lib/activity-material'

export const MATERIAL_REDEMPTION_PERMISSION = 'material_redemption_manage' as const

export const materialRuleTypeLabels = {
  NONE: '无门槛',
  ACTIVITY_REGISTRATION_REQUIRED: '需报名指定活动',
  REGISTER_DAYS: '注册满指定天数',
  CHECKIN_TOTAL: '累计挂号天数',
  CHECKIN_STREAK: '连续挂号天数',
  HAS_BADGE: '拥有指定勋章',
  ATTENDED_CONCERT: '记录过指定演唱会',
  SPECIFIC_USER: '指定用户',
} as const

export const materialRuleOperatorLabels = {
  GTE: '大于等于',
  EQ: '等于',
  LTE: '小于等于',
} as const

export const materialOrderStatusLabels = {
  SUCCESS: '待核销',
  REDEEMED: '已核销',
  CANCELLED: '兑换已取消',
  EXPIRED: '已超过核销截止时间',
  REFUNDED: '已退款，兑换码无效',
} as const

export const materialOrderSourceLabels = {
  MANUAL: '普通兑换',
  ACTIVITY_REGISTRATION_AUTO: '活动报名自动兑换',
} as const

export const materialOrderRedemptionSourceLabels = {
  MANUAL: '物料码核销',
  ACTIVITY_CHECK_IN: '活动核销联动',
  ACTIVITY_AUTO_CHECK_IN: '活动结束自动核销',
} as const

type MaterialRuleType = keyof typeof materialRuleTypeLabels
type MaterialRuleOperator = keyof typeof materialRuleOperatorLabels

export type MaterialRuleInput = {
  type: MaterialRuleType
  operator: MaterialRuleOperator
  value: string
}

export class MaterialRedemptionError extends Error {
  readonly code: string
  readonly status: number
  readonly details?: Record<string, unknown>

  constructor(code: string, message: string, status = 409, details?: Record<string, unknown>) {
    super(message)
    this.name = 'MaterialRedemptionError'
    this.code = code
    this.status = status
    this.details = details
  }
}

type MaterialDb = Prisma.TransactionClient | PrismaClient

const materialWithRulesInclude = {
  rules: { orderBy: { sortOrder: 'asc' as const } },
  linkedActivity: { select: { id: true, title: true, status: true, startsAt: true, endsAt: true, registrationFee: true } },
} satisfies Prisma.MaterialRedemptionInclude

type MaterialWithRules = Prisma.MaterialRedemptionGetPayload<{ include: typeof materialWithRulesInclude }>

const materialOrderInclude = {
  material: { include: { linkedActivity: { select: { id: true, title: true, startsAt: true, endsAt: true, registrationFee: true } } } },
  user: { select: { id: true, uid: true, nickname: true, username: true } },
  redeemedByAdmin: { select: { id: true, uid: true, nickname: true, username: true } },
  linkedActivity: { select: { id: true, title: true, startsAt: true, endsAt: true, registrationFee: true } },
  linkedRegistration: { select: { id: true, activityId: true, status: true, registeredAt: true, cancelledAt: true, verifiedAt: true, checkedInAt: true, checkInSource: true } },
} satisfies Prisma.MaterialRedemptionOrderInclude

type MaterialOrderWithRelations = Prisma.MaterialRedemptionOrderGetPayload<{
  include: typeof materialOrderInclude
}>

function materialOrderSchedule(order: Pick<MaterialOrderWithRelations, 'material' | 'linkedActivity'>): MaterialRedemptionSchedule {
  if (order.linkedActivity) {
    const inherited = activityMaterialSchedule(order.linkedActivity.startsAt, order.linkedActivity.endsAt)
    if (inherited) return inherited
  }
  return materialScheduleFromRow(order.material)
}

function getRuleReferenceType(type: MaterialRuleType) {
  if (type === 'HAS_BADGE') return 'badge'
  if (type === 'ATTENDED_CONCERT') return 'concert'
  if (type === 'SPECIFIC_USER') return 'user'
  if (type === 'ACTIVITY_REGISTRATION_REQUIRED') return 'activity'
  return null
}

function isNumericRuleType(type: MaterialRuleType) {
  return type === 'REGISTER_DAYS' || type === 'CHECKIN_TOTAL' || type === 'CHECKIN_STREAK'
}

export function normalizeMaterialRules(value: unknown): { rules: MaterialRuleInput[] } | { error: string } {
  if (!Array.isArray(value) || value.length > 20) return { error: '兑换条件格式不正确，最多设置 20 条' }
  const rules: MaterialRuleInput[] = []
  for (const item of value) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return { error: '兑换条件格式不正确' }
    const row = item as Record<string, unknown>
    const type = row.type
    const operator = row.operator
    const rawValue = typeof row.value === 'string' || typeof row.value === 'number' ? String(row.value).trim() : ''
    if (!isMaterialRedemptionRuleType(type) || !isMaterialRedemptionRuleOperator(operator)) return { error: '兑换条件类型或运算符无效' }
    if (!rawValue && type !== 'NONE') return { error: `${materialRuleTypeLabels[type]}需要填写条件值` }
    if (rawValue.length > 191) return { error: '兑换条件值过长' }
    if (type === 'NONE' && (rules.length > 0 || rawValue)) return { error: '无门槛条件不能与其他条件同时存在' }
    if (type !== 'NONE' && rules.some((rule) => rule.type === 'NONE')) return { error: '无门槛条件不能与其他条件同时存在' }
    if (isNumericRuleType(type)) {
      const numericValue = Number(rawValue)
      if (!Number.isSafeInteger(numericValue) || numericValue < 0) return { error: `${materialRuleTypeLabels[type]}必须是非负整数` }
    } else if (type === 'NONE') {
      if (operator !== 'EQ') return { error: '无门槛条件的运算符必须为等于' }
    } else if (operator !== 'EQ') {
      return { error: `${materialRuleTypeLabels[type]}只能使用等于` }
    }
    rules.push({ type, operator, value: rawValue })
  }
  return { rules }
}

async function validateRuleReferences(db: MaterialDb, rules: readonly MaterialRuleInput[]) {
  for (const rule of rules) {
    const referenceType = getRuleReferenceType(rule.type)
    if (referenceType === 'badge') {
      const badge = await db.badge.findFirst({ where: { id: rule.value, isEnabled: true }, select: { id: true } })
      if (!badge) throw new MaterialRedemptionError('INVALID_RULE_REFERENCE', '选择的勋章不存在或已停用', 400)
    } else if (referenceType === 'concert') {
      const concert = await db.musicConcert.findFirst({ where: { id: rule.value }, select: { id: true } })
      if (!concert) throw new MaterialRedemptionError('INVALID_RULE_REFERENCE', '选择的演唱会场次不存在', 400)
    } else if (referenceType === 'user') {
      const user = await db.user.findFirst({ where: { id: rule.value, status: 'ACTIVE', isDeleted: false }, select: { id: true } })
      if (!user) throw new MaterialRedemptionError('INVALID_RULE_REFERENCE', '指定用户不存在或已停用', 400)
    } else if (referenceType === 'activity') {
      const activity = await db.activity.findFirst({ where: { id: rule.value }, select: { id: true, startsAt: true, endsAt: true, status: true } })
      if (!activity) throw new MaterialRedemptionError('INVALID_RULE_REFERENCE', '指定活动不存在', 400)
      if (!activity.startsAt || !activity.endsAt || activity.endsAt <= activity.startsAt) throw new MaterialRedemptionError('INVALID_RULE_REFERENCE', '指定活动必须先设置有效的开始和结束时间', 400)
    }
  }
}

type MaterialDraftData = {
  title: string
  description: string
  coverImageUrl: string | null
  instructions: string | null
  cost: number
  stockTotal: number
  perUserLimit: number
  exchangeStartAt: Date | null
  exchangeEndAt: Date | null
  redeemEndAt: Date | null
  status: MaterialRedemptionStatusValue | undefined
  redemptionRule: 'DEFAULT' | typeof ACTIVITY_MATERIAL_RULE
  linkedActivityId: string | null
  rules: MaterialRuleInput[]
}

type MaterialDraftExisting = { stockTotal: number; stockRemaining: number; redemptionRule?: string; linkedActivityId?: string | null }

type ResolvedMaterialDraftData = Omit<MaterialDraftData, 'exchangeStartAt' | 'exchangeEndAt' | 'redeemEndAt'> & {
  exchangeStartAt: Date
  exchangeEndAt: Date
  redeemEndAt: Date
}

function normalizeMaterialDraft(body: Record<string, unknown>, existing?: MaterialDraftExisting) {
  const title = sanitizeText(body.title, 100)
  const description = sanitizeText(body.description, 5000)
  const coverImageUrl = sanitizeText(body.coverImageUrl, 1000) || null
  const instructions = sanitizeText(body.instructions, 5000) || null
  const cost = parsePositiveInteger(body.cost, -1)
  const stockTotal = parsePositiveInteger(body.stockTotal, -1)
  const perUserLimit = parsePositiveInteger(body.perUserLimit, -1)
  const exchangeStartAt = parseDateInput(body.exchangeStartAt)
  const exchangeEndAt = parseDateInput(body.exchangeEndAt)
  const redeemEndAt = parseDateInput(body.redeemEndAt)
  const status = body.status === undefined ? existing ? undefined : 'DRAFT' : body.status
  const explicitRuleMode = Object.prototype.hasOwnProperty.call(body, 'redemptionRule')
  const rawRuleMode = body.redemptionRule === undefined ? existing?.redemptionRule || 'DEFAULT' : body.redemptionRule
  const redemptionRule = rawRuleMode === 'DEFAULT' || rawRuleMode === ACTIVITY_MATERIAL_RULE ? rawRuleMode : null
  const linkedActivityId = sanitizeText(body.linkedActivityId === undefined ? existing?.linkedActivityId : body.linkedActivityId, 191) || null
  if (!title) return { error: '请填写物料标题' } as const
  if (!description) return { error: '请填写物料说明' } as const
  if (cost < 0) return { error: '兑换所需挂号费必须是非负整数' } as const
  if (stockTotal < 0) return { error: '库存必须是非负整数' } as const
  if (perUserLimit < 1) return { error: '每位用户限兑数量必须至少为 1' } as const
  if (!redemptionRule) return { error: '兑换条件类型无效' } as const
  if (existing && stockTotal < existing.stockTotal - existing.stockRemaining) return { error: '库存总量不能低于已兑换数量' } as const
  if (status !== undefined && !['DRAFT', 'PUBLISHED', 'PAUSED', 'ENDED', 'ARCHIVED'].includes(String(status))) return { error: '物料状态无效' } as const
  const parsedRules = normalizeMaterialRules(body.rules ?? [])
  if ('error' in parsedRules) return parsedRules
  const activityRule = parsedRules.rules.find((rule) => rule.type === ACTIVITY_MATERIAL_RULE)
  const activityMode = redemptionRule === ACTIVITY_MATERIAL_RULE || (!explicitRuleMode && Boolean(activityRule))
  if (activityMode && !linkedActivityId && !activityRule?.value) return { error: '请选择指定活动' } as const
  if (!activityMode && (linkedActivityId || activityRule)) return { error: '指定活动物料必须选择“需报名指定活动”' } as const
  const resolvedActivityId = activityMode ? linkedActivityId || activityRule!.value : null
  const rules = activityMode
    ? [{ type: ACTIVITY_MATERIAL_RULE as MaterialRuleType, operator: 'EQ' as const, value: resolvedActivityId! }]
    : parsedRules.rules
  if (!activityMode) {
    if (!exchangeStartAt || !exchangeEndAt || !redeemEndAt) return { error: '请填写完整的兑换和核销时间' } as const
    const scheduleError = validateMaterialRedemptionSchedule({ exchangeStartAt, exchangeEndAt, redeemEndAt })
    if (scheduleError) return { error: scheduleError } as const
  }
  return {
    data: {
      title,
      description,
      coverImageUrl,
      instructions,
      cost,
      stockTotal,
      perUserLimit,
      exchangeStartAt,
      exchangeEndAt,
      redeemEndAt,
      status: status as MaterialRedemptionStatusValue | undefined,
      redemptionRule: activityMode ? ACTIVITY_MATERIAL_RULE : 'DEFAULT',
      linkedActivityId: resolvedActivityId,
      rules,
    },
  } as const
}

async function resolveMaterialDraftSchedule(db: MaterialDb, data: MaterialDraftData): Promise<ResolvedMaterialDraftData> {
  if (data.redemptionRule === ACTIVITY_MATERIAL_RULE) {
    const activity = await db.activity.findUnique({ where: { id: data.linkedActivityId || '' }, select: { id: true, title: true, startsAt: true, endsAt: true } })
    if (!activity) throw new MaterialRedemptionError('INVALID_RULE_REFERENCE', '指定活动不存在', 400)
    const schedule = activityMaterialSchedule(activity.startsAt, activity.endsAt)
    if (!schedule) throw new MaterialRedemptionError('INVALID_RULE_REFERENCE', '指定活动必须先设置有效的开始和结束时间', 400)
    return { ...data, exchangeStartAt: schedule.exchangeStartAt, exchangeEndAt: schedule.exchangeEndAt, redeemEndAt: schedule.redeemEndAt }
  }
  if (!data.exchangeStartAt || !data.exchangeEndAt || !data.redeemEndAt) throw new MaterialRedemptionError('INVALID_MATERIAL', '请填写完整的兑换和核销时间', 400)
  const scheduleError = validateMaterialRedemptionSchedule({ exchangeStartAt: data.exchangeStartAt, exchangeEndAt: data.exchangeEndAt, redeemEndAt: data.redeemEndAt })
  if (scheduleError) throw new MaterialRedemptionError('INVALID_MATERIAL', scheduleError, 400)
  return data as ResolvedMaterialDraftData
}

type MaterialScheduleRow = Pick<MaterialWithRules, 'exchangeStartAt' | 'exchangeEndAt' | 'redeemEndAt' | 'redemptionRule' | 'linkedActivityId'> & {
  linkedActivity?: { startsAt: Date | null; endsAt: Date | null } | null
}

export function materialScheduleFromRow(row: MaterialScheduleRow): MaterialRedemptionSchedule {
  if (isActivityMaterialRule(row.redemptionRule) && row.linkedActivity) {
    const inherited = activityMaterialSchedule(row.linkedActivity.startsAt, row.linkedActivity.endsAt)
    if (inherited) return inherited
  }
  return { exchangeStartAt: row.exchangeStartAt, exchangeEndAt: row.exchangeEndAt, redeemEndAt: row.redeemEndAt }
}

export function serializePublicMaterial(material: MaterialWithRules, now = new Date()) {
  const schedule = materialScheduleFromRow(material)
  const state = getMaterialExchangeState(material.status, schedule, now)
  return {
    id: material.id,
    title: material.title,
    description: material.description,
    coverImageUrl: publicImageUrl(material.coverImageUrl),
    instructions: material.instructions,
    cost: material.cost,
    stockTotal: material.stockTotal,
    stockRemaining: material.stockRemaining,
    perUserLimit: material.perUserLimit,
    exchangeStartAt: schedule.exchangeStartAt.toISOString(),
    exchangeEndAt: schedule.exchangeEndAt.toISOString(),
    redeemEndAt: schedule.redeemEndAt.toISOString(),
    status: material.status,
    redemptionRule: material.redemptionRule,
    linkedActivityId: material.linkedActivityId,
    linkedActivity: material.linkedActivity ? {
      id: material.linkedActivity.id,
      title: material.linkedActivity.title,
      startsAt: material.linkedActivity.startsAt?.toISOString() || null,
      endsAt: material.linkedActivity.endsAt?.toISOString() || null,
      registrationFee: material.linkedActivity.registrationFee,
    } : null,
    isActivityBound: isActivityMaterialRule(material.redemptionRule) && Boolean(material.linkedActivityId),
    state,
    stateLabel: getMaterialExchangeStateLabel(state),
    publishedAt: material.publishedAt?.toISOString() || null,
    rules: material.rules
      .filter((rule) => rule.type !== 'NONE')
      .filter((rule) => rule.type !== ACTIVITY_MATERIAL_RULE)
      .map((rule) => ({
        type: rule.type,
        operator: rule.operator,
        label: isNumericRuleType(rule.type as MaterialRuleType)
          ? `${materialRuleTypeLabels[rule.type as MaterialRuleType]}${materialRuleOperatorLabels[rule.operator as MaterialRuleOperator]} ${rule.value}`
          : materialRuleTypeLabels[rule.type as MaterialRuleType],
      })),
  }
}

export function getMaterialExchangeStateLabel(state: ReturnType<typeof getMaterialExchangeState>) {
  return ({ DRAFT: '草稿', UPCOMING: '即将开始', ACTIVE: '兑换中', PAUSED: '已暂停', ENDED: '兑换结束', ARCHIVED: '已归档' } as const)[state]
}

export function serializeAdminMaterial(material: MaterialWithRules, now = new Date(), redeemedQuantity = 0) {
  return {
    ...serializePublicMaterial(material, now),
    exchangedQuantity: Math.max(0, material.stockTotal - material.stockRemaining),
    redeemedQuantity,
    rules: material.rules.map((rule) => ({
      id: rule.id,
      type: rule.type,
      operator: rule.operator,
      value: rule.value,
      sortOrder: rule.sortOrder,
      typeLabel: materialRuleTypeLabels[rule.type as MaterialRuleType],
      operatorLabel: materialRuleOperatorLabels[rule.operator as MaterialRuleOperator],
    })),
    createdByAdminId: material.createdByAdminId,
    createdAt: material.createdAt.toISOString(),
    updatedAt: material.updatedAt.toISOString(),
  }
}

function makeRedeemToken() {
  return randomBytes(32).toString('base64url')
}

function isUniqueConstraintError(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002'
}

function materialRedeemIdentifierCandidates(value: unknown) {
  const code = parseMaterialRedeemCode(value)
  if (code) return { kind: 'code' as const, values: code.candidates }
  const token = typeof value === 'string' ? value.trim() : ''
  if (isMaterialRedeemToken(token)) return { kind: 'token' as const, values: [token] as [string] }
  throw new MaterialRedemptionError('INVALID_REDEEM_TOKEN', '请提供有效的兑换码或核销令牌', 400)
}

async function findMaterialOrderByRedeemIdentifier(db: MaterialDb, value: unknown) {
  const identifier = materialRedeemIdentifierCandidates(value)
  if (identifier.kind === 'token') {
    return db.materialRedemptionOrder.findUnique({ where: { redeemToken: identifier.values[0] }, include: materialOrderInclude })
  }
  for (const redeemCode of identifier.values) {
    const order = await db.materialRedemptionOrder.findUnique({ where: { redeemCode }, include: materialOrderInclude })
    if (order) return order
  }
  const token = typeof value === 'string' ? value.trim() : ''
  if (isMaterialRedeemToken(token)) {
    return db.materialRedemptionOrder.findUnique({ where: { redeemToken: token }, include: materialOrderInclude })
  }
  return null
}

async function writeMaterialAdminLog(
  tx: Prisma.TransactionClient,
  input: { adminId: string; targetUserId?: string; action: string; detail: Prisma.InputJsonValue },
) {
  return tx.adminActionLog.create({
    data: {
      adminId: input.adminId,
      targetUserId: input.targetUserId || input.adminId,
      action: input.action,
      detail: input.detail,
    },
  })
}

export async function listPublicMaterialRedemptions(now = new Date()) {
  const materials = await prisma.materialRedemption.findMany({
    where: { status: { in: ['PUBLISHED', 'PAUSED', 'ENDED'] } },
    orderBy: [{ exchangeStartAt: 'desc' }, { createdAt: 'desc' }],
    take: 100,
    include: materialWithRulesInclude,
  })
  return materials.map((material) => serializePublicMaterial(material, now))
}

export async function getPublicMaterialRedemption(materialId: string, userId?: string, now = new Date()) {
  const material = await prisma.materialRedemption.findFirst({
    where: { id: materialId, status: { in: ['PUBLISHED', 'PAUSED', 'ENDED'] } },
    include: materialWithRulesInclude,
  })
  if (!material) return null
  const response: Record<string, unknown> = serializePublicMaterial(material, now)
  if (userId) {
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { points: true } })
    const currentBalance = user?.points ?? 0
    if (isActivityMaterialRule(material.redemptionRule) && material.linkedActivityId && material.linkedActivity) {
      const registration = await prisma.activityRegistration.findUnique({
        where: { activityId_userId: { activityId: material.linkedActivityId, userId } },
        select: {
          id: true,
          status: true,
          paidRegistrationFee: true,
          verifiedAt: true,
          checkedInAt: true,
          checkInSource: true,
          LinkedMaterialRedemption: { select: { id: true, status: true, redeemCode: true, redeemedAt: true } },
        },
      })
      const linkedOrder = registration?.LinkedMaterialRedemption || null
      const activeRegistration = registration?.status === 'ACTIVE'
      const priorQuantity = linkedOrder && ['SUCCESS', 'REDEEMED'].includes(linkedOrder.status) ? 1 : 0
      const reasons = registration?.status === 'CANCELLED'
        ? ['你已取消过本活动报名，无法再次报名']
        : activeRegistration
          ? linkedOrder ? ['已通过活动报名自动兑换'] : ['报名成功后将自动兑换']
          : [`需报名「${material.linkedActivity.title}」后自动兑换`]
      response.activityRegistration = registration ? {
        id: registration.id,
        status: registration.status,
        paidRegistrationFee: registration.paidRegistrationFee,
        verifiedAt: registration.verifiedAt?.toISOString() || null,
        checkedInAt: registration.checkedInAt?.toISOString() || null,
        checkInSource: registration.checkInSource,
        linkedMaterialRedemption: linkedOrder ? { ...linkedOrder, redeemedAt: linkedOrder.redeemedAt?.toISOString() || null } : null,
      } : null
      response.eligibility = {
        qualified: activeRegistration,
        reasons,
        progress: [{ type: ACTIVITY_MATERIAL_RULE, operator: 'EQ', actual: activeRegistration, qualified: activeRegistration }],
        priorQuantity,
        remainingUserQuota: Math.max(0, material.perUserLimit - priorQuantity),
        balanceEnough: currentBalance >= material.linkedActivity.registrationFee,
        // Activity-bound material is never exchanged from the material page.
        canExchange: false,
      }
    } else {
      const eligibility = await evaluateMaterialEligibility(prisma, userId, material.rules, now)
      const priorQuantity = await getUserMaterialQuantity(prisma, material.id, userId)
      response.eligibility = {
        qualified: eligibility.qualified,
        reasons: eligibility.reasons,
        progress: eligibility.snapshot.rules.filter((rule) => rule.type !== 'NONE').map((rule) => ({ type: rule.type, operator: rule.operator, actual: rule.actual, qualified: rule.qualified })),
        priorQuantity,
        remainingUserQuota: Math.max(0, material.perUserLimit - priorQuantity),
        balanceEnough: currentBalance >= material.cost,
        canExchange: canExchangeMaterial(material.status, materialScheduleFromRow(material), now) && eligibility.qualified && material.stockRemaining > 0 && currentBalance >= material.cost,
      }
    }
    response.currentBalance = currentBalance
  }
  return response
}

export async function listAdminMaterialRedemptions() {
  const [materials, redeemedStats] = await Promise.all([
    prisma.materialRedemption.findMany({
      orderBy: [{ createdAt: 'desc' }],
      include: materialWithRulesInclude,
    }),
    prisma.materialRedemptionOrder.groupBy({
      by: ['materialId'],
      where: { status: 'REDEEMED' },
      _sum: { quantity: true },
    }),
  ])
  const redeemedByMaterial = new Map(redeemedStats.map((row) => [row.materialId, row._sum.quantity || 0]))
  return materials.map((material) => serializeAdminMaterial(material, new Date(), redeemedByMaterial.get(material.id) || 0))
}

export async function createMaterialRedemption(adminId: string, body: Record<string, unknown>) {
  const parsed = normalizeMaterialDraft(body)
  if ('error' in parsed) throw new MaterialRedemptionError('INVALID_MATERIAL', parsed.error || '物料参数无效', 400)
  const data = parsed.data
  const initialStatus = parsed.data.status || 'DRAFT'
  if (initialStatus === 'PUBLISHED') {
    if (!data.coverImageUrl) throw new MaterialRedemptionError('INVALID_MATERIAL', '发布物料前请上传物料图片', 400)
    if (data.stockTotal < 1) throw new MaterialRedemptionError('INVALID_MATERIAL', '发布物料前库存总量必须大于 0', 400)
    if (!data.instructions) throw new MaterialRedemptionError('INVALID_MATERIAL', '发布物料前请填写兑换说明', 400)
  }
  const material = await prisma.$transaction(async (tx) => {
    const data = await resolveMaterialDraftSchedule(tx, parsed.data)
    await validateRuleReferences(tx, data.rules)
    if (data.redemptionRule === ACTIVITY_MATERIAL_RULE && data.linkedActivityId) {
      const occupied = await tx.materialRedemption.findFirst({ where: { linkedActivityId: data.linkedActivityId }, select: { id: true } })
      if (occupied) throw new MaterialRedemptionError('ACTIVITY_MATERIAL_ALREADY_BOUND', '该活动已经绑定其他活动物料', 409)
    }
    const created = await tx.materialRedemption.create({
      data: {
        title: data.title,
        description: data.description,
        coverImageUrl: data.coverImageUrl,
        instructions: data.instructions,
        cost: data.cost,
        stockTotal: data.stockTotal,
        stockRemaining: data.stockTotal,
        perUserLimit: data.perUserLimit,
        exchangeStartAt: data.exchangeStartAt,
        exchangeEndAt: data.exchangeEndAt,
        redeemEndAt: data.redeemEndAt,
        redemptionRule: data.redemptionRule,
        linkedActivityId: data.linkedActivityId,
        status: initialStatus,
        publishedAt: initialStatus === 'PUBLISHED' ? new Date() : null,
        createdByAdminId: adminId,
        rules: { create: data.rules.map((rule, index) => ({ type: rule.type, operator: rule.operator, value: rule.value, sortOrder: index })) },
      },
      include: materialWithRulesInclude,
    })
    await writeMaterialAdminLog(tx, {
      adminId,
      action: initialStatus === 'PUBLISHED' ? 'MATERIAL_REDEMPTION_PUBLISH' : 'MATERIAL_REDEMPTION_CREATE',
      detail: { materialId: created.id, title: created.title, status: created.status, stockTotal: created.stockTotal },
    })
    return created
  })
  return serializeAdminMaterial(material)
}

export async function updateMaterialRedemption(adminId: string, materialId: string, body: Record<string, unknown>) {
  const current = await prisma.materialRedemption.findUnique({ where: { id: materialId }, include: materialWithRulesInclude })
  if (!current) throw new MaterialRedemptionError('MATERIAL_NOT_FOUND', '物料不存在', 404)
  const parsed = normalizeMaterialDraft(body, { stockTotal: current.stockTotal, stockRemaining: current.stockRemaining, redemptionRule: current.redemptionRule, linkedActivityId: current.linkedActivityId })
  if ('error' in parsed) throw new MaterialRedemptionError('INVALID_MATERIAL', parsed.error || '物料参数无效', 400)
  const data = parsed.data
  if (parsed.data.status === 'PUBLISHED') {
    if (!data.coverImageUrl) throw new MaterialRedemptionError('INVALID_MATERIAL', '发布物料前请上传物料图片', 400)
    if (data.stockTotal < 1) throw new MaterialRedemptionError('INVALID_MATERIAL', '发布物料前库存总量必须大于 0', 400)
    if (!data.instructions) throw new MaterialRedemptionError('INVALID_MATERIAL', '发布物料前请填写兑换说明', 400)
  }
  const material = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT \`id\` FROM \`MaterialRedemption\` WHERE \`id\` = ${materialId} FOR UPDATE`
    const locked = await tx.materialRedemption.findUnique({ where: { id: materialId }, select: { id: true, status: true, title: true, stockTotal: true, stockRemaining: true, publishedAt: true, redemptionRule: true, linkedActivityId: true } })
    if (!locked) throw new MaterialRedemptionError('MATERIAL_NOT_FOUND', '物料不存在', 404)
    const data = await resolveMaterialDraftSchedule(tx, parsed.data)
    const nextStatus = data.status || locked.status
    if (locked.redemptionRule !== ACTIVITY_MATERIAL_RULE && data.redemptionRule === ACTIVITY_MATERIAL_RULE) {
      const existingOrders = await tx.materialRedemptionOrder.count({ where: { materialId } })
      if (existingOrders > 0) throw new MaterialRedemptionError('INVALID_RULE_CHANGE', '已有普通兑换订单的物料不能直接改为活动报名物料', 409)
    }
    if (data.redemptionRule === ACTIVITY_MATERIAL_RULE && data.linkedActivityId) {
      const occupied = await tx.materialRedemption.findFirst({ where: { linkedActivityId: data.linkedActivityId, id: { not: materialId } }, select: { id: true } })
      if (occupied) throw new MaterialRedemptionError('ACTIVITY_MATERIAL_ALREADY_BOUND', '该活动已经绑定其他活动物料', 409)
    }
    if (nextStatus === 'PUBLISHED') {
      if (!data.coverImageUrl) throw new MaterialRedemptionError('INVALID_MATERIAL', '发布物料前请上传物料图片', 400)
      if (data.stockTotal < 1) throw new MaterialRedemptionError('INVALID_MATERIAL', '发布物料前库存总量必须大于 0', 400)
      if (!data.instructions) throw new MaterialRedemptionError('INVALID_MATERIAL', '发布物料前请填写兑换说明', 400)
    }
    const occupiedStock = locked.stockTotal - locked.stockRemaining
    if (data.stockTotal < occupiedStock) throw new MaterialRedemptionError('INVALID_STOCK_ADJUSTMENT', '库存总量不能低于已占用库存', 400)
    const stockTotalDelta = data.stockTotal - locked.stockTotal
    const nextStockRemaining = locked.stockRemaining + stockTotalDelta
    if (nextStockRemaining < 0 || nextStockRemaining > data.stockTotal) throw new MaterialRedemptionError('INVALID_STOCK_ADJUSTMENT', '库存调整后的剩余库存不合法', 400)
    await validateRuleReferences(tx, data.rules)
    const updated = await tx.materialRedemption.update({
      where: { id: materialId },
      data: {
        title: data.title,
        description: data.description,
        coverImageUrl: data.coverImageUrl,
        instructions: data.instructions,
        cost: data.cost,
        stockTotal: data.stockTotal,
        stockRemaining: nextStockRemaining,
        perUserLimit: data.perUserLimit,
        exchangeStartAt: data.exchangeStartAt,
        exchangeEndAt: data.exchangeEndAt,
        redeemEndAt: data.redeemEndAt,
        redemptionRule: data.redemptionRule,
        linkedActivityId: data.linkedActivityId,
        status: nextStatus,
        publishedAt: nextStatus === 'PUBLISHED' ? locked.publishedAt || new Date() : locked.publishedAt,
      },
      include: materialWithRulesInclude,
    })
    await tx.materialRedemptionRule.deleteMany({ where: { materialId } })
    if (data.rules.length) await tx.materialRedemptionRule.createMany({ data: data.rules.map((rule, index) => ({ materialId, type: rule.type, operator: rule.operator, value: rule.value, sortOrder: index })) })
    await writeMaterialAdminLog(tx, {
      adminId,
      action: nextStatus === 'PUBLISHED' && locked.status !== 'PUBLISHED'
        ? 'MATERIAL_REDEMPTION_PUBLISH'
        : nextStatus === 'PAUSED' && locked.status !== 'PAUSED'
          ? 'MATERIAL_REDEMPTION_PAUSE'
          : nextStatus === 'ENDED' && locked.status !== 'ENDED'
            ? 'MATERIAL_REDEMPTION_END'
            : 'MATERIAL_REDEMPTION_UPDATE',
      detail: {
        materialId,
        title: updated.title,
        beforeStatus: locked.status,
        afterStatus: nextStatus,
        stockTotalBefore: locked.stockTotal,
        stockTotalAfter: updated.stockTotal,
        stockRemainingBefore: locked.stockRemaining,
        stockRemainingAfter: updated.stockRemaining,
      },
    })
    return tx.materialRedemption.findUniqueOrThrow({ where: { id: materialId }, include: materialWithRulesInclude })
  })
  return serializeAdminMaterial(material)
}

export async function adjustMaterialInventory(adminId: string, materialId: string, delta: number, reason: string) {
  if (!Number.isSafeInteger(delta) || delta === 0 || Math.abs(delta) > 1_000_000) throw new MaterialRedemptionError('INVALID_STOCK_ADJUSTMENT', '库存调整数量无效', 400)
  const normalizedReason = sanitizeText(reason, 500)
  if (!normalizedReason) throw new MaterialRedemptionError('INVALID_STOCK_ADJUSTMENT', '库存调整必须填写原因', 400)
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT \`id\` FROM \`MaterialRedemption\` WHERE \`id\` = ${materialId} FOR UPDATE`
    const material = await tx.materialRedemption.findUnique({ where: { id: materialId }, select: { id: true, title: true, stockTotal: true, stockRemaining: true } })
    if (!material) throw new MaterialRedemptionError('MATERIAL_NOT_FOUND', '物料不存在', 404)
    const occupiedStock = material.stockTotal - material.stockRemaining
    const nextTotal = material.stockTotal + delta
    const nextRemaining = material.stockRemaining + delta
    if (nextTotal < occupiedStock || nextRemaining < 0) throw new MaterialRedemptionError('INVALID_STOCK_ADJUSTMENT', '减少库存不能低于已占用库存或 0', 400)
    const updated = await tx.materialRedemption.update({ where: { id: materialId }, data: { stockTotal: nextTotal, stockRemaining: nextRemaining }, select: { id: true, stockTotal: true, stockRemaining: true } })
    await writeMaterialAdminLog(tx, {
      adminId,
      action: 'MATERIAL_REDEMPTION_STOCK_ADJUST',
      detail: {
        materialId,
        title: material.title,
        delta,
        stockTotalBefore: material.stockTotal,
        stockTotalAfter: updated.stockTotal,
        stockRemainingBefore: material.stockRemaining,
        stockRemainingAfter: updated.stockRemaining,
        reason: normalizedReason,
      },
    })
    return { materialId, stockTotal: updated.stockTotal, stockRemaining: updated.stockRemaining }
  })
}

async function getUserMaterialQuantity(db: MaterialDb, materialId: string, userId: string) {
  const aggregate = await db.materialRedemptionOrder.aggregate({
    where: { materialId, userId, status: { in: ['SUCCESS', 'REDEEMED'] } },
    _sum: { quantity: true },
  })
  return aggregate._sum.quantity || 0
}

type MaterialEligibilityResult = {
  qualified: boolean
  reasons: string[]
  snapshot: {
    evaluatedAt: string
    qualified: boolean
    rules: Array<{ type: string; operator: string; value: string; actual: number | boolean; qualified: boolean }>
  }
}

async function evaluateMaterialEligibility(db: MaterialDb, userId: string, rules: readonly { type: string; operator: string; value: string }[], now = new Date()): Promise<MaterialEligibilityResult> {
  const user = await db.user.findUnique({ where: { id: userId }, select: { id: true, createdAt: true } })
  if (!user) throw new MaterialRedemptionError('USER_NOT_FOUND', '用户不存在', 404)
  const results: MaterialEligibilityResult['snapshot']['rules'] = []
  const reasons: string[] = []
  for (const rule of rules.length ? rules : [{ type: 'NONE', operator: 'EQ', value: '' }]) {
    let actual: number | boolean = true
    let qualified = true
    if (rule.type === 'REGISTER_DAYS') {
      actual = accountAgeDays(user.createdAt, now)
      qualified = compareMaterialRuleValue(actual, rule.operator as MaterialRuleOperator, Number(rule.value))
    } else if (rule.type === 'CHECKIN_TOTAL') {
      const rows = await db.checkIn.findMany({ where: { userId }, select: { checkinDateKey: true } })
      actual = new Set(rows.map((row) => row.checkinDateKey)).size
      qualified = compareMaterialRuleValue(actual, rule.operator as MaterialRuleOperator, Number(rule.value))
    } else if (rule.type === 'CHECKIN_STREAK') {
      const rows = await db.checkIn.findMany({ where: { userId }, select: { checkinDateKey: true } })
      actual = calculateCheckinStreaks(rows.map((row) => row.checkinDateKey), now).currentStreak
      qualified = compareMaterialRuleValue(actual, rule.operator as MaterialRuleOperator, Number(rule.value))
    } else if (rule.type === 'HAS_BADGE') {
      actual = Boolean(await db.userBadge.findUnique({ where: { userId_badgeId: { userId, badgeId: rule.value } }, select: { id: true } }))
      qualified = actual
    } else if (rule.type === 'ATTENDED_CONCERT') {
      actual = Boolean(await db.userMusicConcert.findUnique({ where: { userId_concertId: { userId, concertId: rule.value } }, select: { id: true } }))
      qualified = actual
    } else if (rule.type === 'SPECIFIC_USER') {
      actual = userId === rule.value
      qualified = actual
    }
    if (!qualified) reasons.push(`${materialRuleTypeLabels[rule.type as MaterialRuleType] || '兑换条件'}未满足`)
    results.push({ type: rule.type, operator: rule.operator, value: rule.value, actual, qualified })
  }
  const qualified = results.every((rule) => rule.qualified)
  return { qualified, reasons, snapshot: { evaluatedAt: now.toISOString(), qualified, rules: results } }
}

async function expireOrders(db: MaterialDb, userId?: string) {
  const now = new Date()
  await db.materialRedemptionOrder.updateMany({
    where: {
      status: 'SUCCESS',
      source: 'MANUAL',
      ...(userId ? { userId } : {}),
      material: { redeemEndAt: { lt: now } },
    },
    data: { status: 'EXPIRED', expiredAt: now },
  })
}

function serializeOrder(order: MaterialOrderWithRelations, includePrivate = false) {
  const schedule = materialOrderSchedule(order)
  const linkedActivity = order.linkedActivity || order.material.linkedActivity
  return {
    id: order.id,
    materialId: order.materialId,
    material: {
      id: order.material.id,
      title: order.material.title,
      coverImageUrl: publicImageUrl(order.material.coverImageUrl),
      exchangeStartAt: schedule.exchangeStartAt.toISOString(),
      exchangeEndAt: schedule.exchangeEndAt.toISOString(),
      redeemEndAt: schedule.redeemEndAt.toISOString(),
    },
    user: { id: order.user.id, uid: order.user.uid, nickname: order.user.nickname },
    quantity: order.quantity,
    unitCost: order.unitCost,
    totalCost: order.totalCost,
    status: order.status,
    statusLabel: materialOrderStatusLabels[order.status as keyof typeof materialOrderStatusLabels],
    source: order.source,
    sourceLabel: materialOrderSourceLabels[order.source],
    linkedActivity: linkedActivity ? {
      id: linkedActivity.id,
      title: linkedActivity.title,
      startsAt: linkedActivity.startsAt?.toISOString() || null,
      endsAt: linkedActivity.endsAt?.toISOString() || null,
    } : null,
    redemptionSource: order.redemptionSource,
    redemptionSourceLabel: order.redemptionSource ? materialOrderRedemptionSourceLabels[order.redemptionSource] : null,
    linkedRegistration: order.linkedRegistration ? {
      id: order.linkedRegistration.id,
      activityId: order.linkedRegistration.activityId,
      status: order.linkedRegistration.status,
      registeredAt: order.linkedRegistration.registeredAt.toISOString(),
      cancelledAt: order.linkedRegistration.cancelledAt?.toISOString() || null,
      verifiedAt: order.linkedRegistration.verifiedAt?.toISOString() || null,
      checkedInAt: order.linkedRegistration.checkedInAt?.toISOString() || null,
      checkInSource: order.linkedRegistration.checkInSource,
    } : null,
    redeemCode: order.redeemCode,
    ...(includePrivate ? { redeemToken: order.redeemToken, eligibilitySnapshot: order.eligibilitySnapshot } : {}),
    createdAt: order.createdAt.toISOString(),
    updatedAt: order.updatedAt.toISOString(),
    redeemedAt: order.redeemedAt?.toISOString() || null,
    redeemedByAdmin: order.redeemedByAdmin ? { uid: order.redeemedByAdmin.uid, nickname: order.redeemedByAdmin.nickname } : null,
    expiredAt: order.expiredAt?.toISOString() || null,
    cancelledAt: order.cancelledAt?.toISOString() || null,
    refundedAt: order.refundedAt?.toISOString() || null,
    refundReason: order.refundReason,
  }
}

export async function listOwnMaterialRedemptionOrders(userId: string, status?: string) {
  await expireOrders(prisma, userId)
  const validStatus = ['SUCCESS', 'REDEEMED', 'CANCELLED', 'EXPIRED', 'REFUNDED'].includes(status || '') ? status as keyof typeof materialOrderStatusLabels : undefined
  const orders = await prisma.materialRedemptionOrder.findMany({
    where: { userId, ...(validStatus ? { status: validStatus } : {}) },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: 100,
    include: materialOrderInclude,
  })
  return orders.map((order) => serializeOrder(order, true))
}

export async function getOwnMaterialRedemptionOrder(userId: string, orderId: string) {
  await expireOrders(prisma, userId)
  const order = await prisma.materialRedemptionOrder.findFirst({
    where: { id: orderId, userId },
    include: materialOrderInclude,
  })
  return order ? serializeOrder(order, true) : null
}

export async function exchangeMaterialRedemption(userId: string, materialId: string, input: { idempotencyKey: string; quantity: number }) {
  if (!/^[A-Za-z0-9._:-]{16,191}$/.test(input.idempotencyKey)) throw new MaterialRedemptionError('INVALID_IDEMPOTENCY_KEY', '请提供有效的兑换请求标识', 400)
  if (!Number.isSafeInteger(input.quantity) || input.quantity < 1 || input.quantity > 100) throw new MaterialRedemptionError('INVALID_QUANTITY', '兑换数量必须是 1 至 100 的整数', 400)
  const now = new Date()
  try {
    const result = await prisma.$transaction(async (tx) => {
      const duplicate = await tx.materialRedemptionOrder.findUnique({ where: { idempotencyKey: input.idempotencyKey }, include: materialOrderInclude })
      if (duplicate) {
        if (duplicate.userId !== userId || duplicate.materialId !== materialId) throw new MaterialRedemptionError('IDEMPOTENCY_KEY_CONFLICT', '该兑换请求标识已经用于其他请求', 409)
        return { duplicate: true, order: serializeOrder(duplicate, true), balance: null }
      }
      await tx.$queryRaw`SELECT \`id\` FROM \`User\` WHERE \`id\` = ${userId} FOR UPDATE`
      const [material, user] = await Promise.all([
        tx.materialRedemption.findUnique({ where: { id: materialId }, include: materialWithRulesInclude }),
        tx.user.findUnique({ where: { id: userId }, select: { id: true, status: true, isDeleted: true, points: true } }),
      ])
      if (!material) throw new MaterialRedemptionError('MATERIAL_NOT_FOUND', '物料不存在', 404)
      if (!user || user.isDeleted || user.status !== 'ACTIVE') throw new MaterialRedemptionError('USER_NOT_ACTIVE', '当前账号不可兑换', 403)
      if (isActivityMaterialRule(material.redemptionRule)) throw new MaterialRedemptionError('ACTIVITY_MATERIAL_AUTO_ONLY', '该物料需报名指定活动后自动兑换，请前往活动详情报名', 409)
      const schedule = materialScheduleFromRow(material)
      if (material.status === 'PAUSED') throw new MaterialRedemptionError('PAUSED', '该物料兑换已暂停')
      if (material.status !== 'PUBLISHED') throw new MaterialRedemptionError(material.status === 'DRAFT' ? 'NOT_PUBLISHED' : 'EXCHANGE_ENDED', '该物料当前不可兑换')
      if (now < schedule.exchangeStartAt) throw new MaterialRedemptionError('NOT_STARTED', '兑换尚未开始')
      if (now > schedule.exchangeEndAt) throw new MaterialRedemptionError('EXCHANGE_ENDED', '兑换时间已结束')
      const eligibility = await evaluateMaterialEligibility(tx, userId, material.rules, now)
      if (!eligibility.qualified) throw new MaterialRedemptionError('NOT_QUALIFIED', eligibility.reasons.join('；') || '未满足兑换条件', 403, { reasons: eligibility.reasons })
      const previousQuantity = await getUserMaterialQuantity(tx, material.id, userId)
      if (previousQuantity + input.quantity > material.perUserLimit) throw new MaterialRedemptionError('LIMIT_REACHED', `每位用户最多兑换 ${material.perUserLimit} 件`, 409)
      const totalCost = material.cost * input.quantity
      if (!Number.isSafeInteger(totalCost)) throw new MaterialRedemptionError('INVALID_COST', '兑换金额超出安全范围', 400)
      if (user.points < totalCost) throw new MaterialRedemptionError('INSUFFICIENT_BALANCE', `挂号费不足，需要 ${totalCost}，当前余额 ${user.points}`, 409, { required: totalCost, balance: user.points })
      const stockChanged = await tx.materialRedemption.updateMany({
        where: { id: material.id, status: 'PUBLISHED', exchangeStartAt: { lte: now }, exchangeEndAt: { gte: now }, stockRemaining: { gte: input.quantity } },
        data: { stockRemaining: { decrement: input.quantity } },
      })
      if (stockChanged.count !== 1) throw new MaterialRedemptionError('OUT_OF_STOCK', '库存不足，请稍后再试')
      const eligibilitySnapshot = {
        ...eligibility.snapshot,
        quantity: input.quantity,
        cost: totalCost,
        balanceBefore: user.points,
      }
      const created = await tx.materialRedemptionOrder.create({
        data: {
          materialId: material.id,
          userId,
          quantity: input.quantity,
          unitCost: material.cost,
          totalCost,
          status: 'SUCCESS',
          redeemCode: generateMaterialRedeemCode(),
          redeemToken: makeRedeemToken(),
          eligibilitySnapshot: eligibilitySnapshot as unknown as Prisma.InputJsonValue,
          idempotencyKey: input.idempotencyKey,
        },
        include: materialOrderInclude,
      })
      if (totalCost > 0) {
        await consumeRegistrationFee(tx, {
          userId,
          amount: totalCost,
          action: 'MATERIAL_REDEMPTION',
          reason: `兑换物料：${material.title}`,
          businessKey: `material-redemption:${created.id}`,
          now,
        })
      }
      const balance = await tx.user.findUniqueOrThrow({ where: { id: userId }, select: { points: true } })
      return { duplicate: false, order: serializeOrder(created, true), balance: balance.points }
    }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted })
    if (!result.duplicate) {
      const redeemDeadline = new Date(result.order.material.redeemEndAt).toLocaleString('zh-CN', { hour12: false, timeZone: 'Asia/Shanghai' })
      await notifyMaterialOrder(userId, result.order.id, `你已成功兑换「${result.order.material.title}」，兑换码：${result.order.redeemCode}。请在 ${redeemDeadline} 前完成领取。`, '兑换成功')
    }
    return result
  } catch (error) {
    if (error instanceof MaterialRedemptionError) throw error
    if (isUniqueConstraintError(error)) {
      const duplicate = await prisma.materialRedemptionOrder.findUnique({ where: { idempotencyKey: input.idempotencyKey }, include: materialOrderInclude })
      if (duplicate && duplicate.userId === userId && duplicate.materialId === materialId) return { duplicate: true, order: serializeOrder(duplicate, true), balance: null }
      if (duplicate) throw new MaterialRedemptionError('IDEMPOTENCY_KEY_CONFLICT', '该兑换请求标识已经用于其他请求', 409)
    }
    throw error
  }
}

async function notifyMaterialOrder(userId: string, orderId: string, content: string, title: string) {
  try {
    await createNotification({
      data: {
        recipientId: userId,
        type: 'ACTIVITY',
        title,
        content,
        link: `/material-redemptions/orders/${orderId}`,
        key: `material-redemption:${orderId}:${title}`,
      },
    })
  } catch (error) {
    console.error('[material-redemption.notification]', { userId, orderId, error: error instanceof Error ? error.message : String(error) })
  }
}

export async function getAdminMaterialOrderPreview(token: string) {
  const order = await findMaterialOrderByRedeemIdentifier(prisma, token)
  if (!order) throw new MaterialRedemptionError('ORDER_NOT_FOUND', '兑换订单不存在', 404)
  const now = new Date()
  const activityBound = order.source === 'ACTIVITY_REGISTRATION_AUTO'
  const effectiveSchedule = materialOrderSchedule(order)
  const notStarted = activityBound && order.status === 'SUCCESS' && now < effectiveSchedule.exchangeStartAt
  const expired = !activityBound && (order.status === 'EXPIRED' || (order.status === 'SUCCESS' && !canRedeemMaterial(order.material.status, effectiveSchedule.redeemEndAt, now)))
  return {
    ...serializeOrder(order, false),
    canRedeem: order.status === 'SUCCESS' && !expired && !notStarted,
    expired,
    notStarted,
    redeemTokenLast4: order.redeemToken.slice(-4),
  }
}

export async function redeemMaterialOrder(adminId: string, token: string) {
  const now = new Date()
  const result = await prisma.$transaction(async (tx) => {
    const order = await findMaterialOrderByRedeemIdentifier(tx, token)
    if (!order) throw new MaterialRedemptionError('ORDER_NOT_FOUND', '兑换订单不存在', 404)
    // Activity-bound orders are the second half of the one-scan operation.
    // Re-scanning their material code must be idempotent just like
    // re-scanning the activity code, while ordinary material orders retain
    // their existing duplicate-scan error.
    if (order.status === 'REDEEMED') {
      if (order.source !== 'ACTIVITY_REGISTRATION_AUTO') throw new MaterialRedemptionError('ALREADY_REDEEMED', '该兑换码已经核销', 409)
      return { expired: false as const, alreadyRedeemed: true, order }
    }
    if (order.status !== 'SUCCESS') throw new MaterialRedemptionError('ORDER_NOT_REDEEMABLE', `该订单当前状态为${materialOrderStatusLabels[order.status as keyof typeof materialOrderStatusLabels] || order.status}`)

    if (order.source === 'ACTIVITY_REGISTRATION_AUTO') {
      const effectiveSchedule = materialOrderSchedule(order)
      if (now < effectiveSchedule.exchangeStartAt) throw new MaterialRedemptionError('ACTIVITY_NOT_STARTED', '活动尚未开始，暂不能核销活动物料', 409)
      const activityId = order.linkedActivityId || order.material.linkedActivity?.id
      const registrationId = order.linkedRegistration?.id
      if (!activityId || !registrationId) throw new MaterialRedemptionError('ACTIVITY_LINK_MISSING', '活动物料缺少报名关联记录，请联系管理员', 409)
      const activityEndsAt = order.linkedActivity?.endsAt || order.material.linkedActivity?.endsAt
      const verification = activityEndsAt && activityEndsAt < now
        ? await autoCheckInActivityRegistrationInTransaction(tx, registrationId, now)
        : await verifyActivityRegistrationInTransaction(tx, { activityId, registrationId, adminId, method: 'MANUAL', allowLinkedMaterial: true }, now)
      if ('processed' in verification && !verification.processed && verification.reason !== 'ALREADY_VERIFIED') {
        throw new MaterialRedemptionError('ACTIVITY_LINK_MISSING', '活动报名当前无法核销，请刷新后重试', 409)
      }
      if (!('processed' in verification) && !verification.alreadyVerified) {
        await writeMaterialAdminLog(tx, {
          adminId,
          targetUserId: order.userId,
          action: 'MATERIAL_REDEMPTION_REDEEM',
          detail: { orderId: order.id, materialId: order.materialId, redeemCode: order.redeemCode, quantity: order.quantity, source: order.source, linkedActivityId: activityId, redemptionSource: verification.checkInSource === 'AUTO_AFTER_ACTIVITY_END' ? 'ACTIVITY_AUTO_CHECK_IN' : 'ACTIVITY_CHECK_IN' },
        })
      }
      return {
        expired: false as const,
        alreadyRedeemed: 'alreadyVerified' in verification ? verification.alreadyVerified : verification.reason === 'ALREADY_VERIFIED',
        order: await tx.materialRedemptionOrder.findUniqueOrThrow({ where: { id: order.id }, include: materialOrderInclude }),
      }
    }

    const effectiveSchedule = materialScheduleFromRow(order.material)
    if (!canRedeemMaterial(order.material.status, effectiveSchedule.redeemEndAt, now)) {
      await tx.materialRedemptionOrder.updateMany({ where: { id: order.id, status: 'SUCCESS' }, data: { status: 'EXPIRED', expiredAt: now } })
      return { expired: true as const, alreadyRedeemed: false, order }
    }
    const changed = await tx.materialRedemptionOrder.updateMany({
      where: { id: order.id, status: 'SUCCESS' },
      data: { status: 'REDEEMED', redeemedAt: now, redeemedByAdminId: adminId },
    })
    if (changed.count !== 1) throw new MaterialRedemptionError('ALREADY_REDEEMED', '该兑换码已经被其他管理员核销')
    await writeMaterialAdminLog(tx, {
      adminId,
      targetUserId: order.userId,
      action: 'MATERIAL_REDEMPTION_REDEEM',
      detail: { orderId: order.id, materialId: order.materialId, redeemCode: order.redeemCode, quantity: order.quantity },
    })
    return { expired: false as const, alreadyRedeemed: false, order: await tx.materialRedemptionOrder.findUniqueOrThrow({ where: { id: order.id }, include: materialOrderInclude }) }
  })
  if (result.expired) throw new MaterialRedemptionError('REDEEM_EXPIRED', '该订单已经超过核销截止时间')
  if (!result.alreadyRedeemed) await notifyMaterialOrder(result.order.userId, result.order.id, `「${result.order.material.title}」已完成核销`, '物料已核销')
  return { ...serializeOrder(result.order, false), alreadyRedeemed: result.alreadyRedeemed }
}

export async function refundMaterialOrder(adminId: string, orderId: string, input: { reason: string; restoreStock: boolean }) {
  const reason = sanitizeText(input.reason, 500)
  if (!reason) throw new MaterialRedemptionError('INVALID_REFUND_REASON', '退款必须填写原因', 400)
  const result = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT \`id\` FROM \`MaterialRedemptionOrder\` WHERE \`id\` = ${orderId} FOR UPDATE`
    const order = await tx.materialRedemptionOrder.findUnique({ where: { id: orderId }, include: materialOrderInclude })
    if (!order) throw new MaterialRedemptionError('ORDER_NOT_FOUND', '兑换订单不存在', 404)
    if (order.source === 'ACTIVITY_REGISTRATION_AUTO') throw new MaterialRedemptionError('ACTIVITY_MATERIAL_REFUND_UNSUPPORTED', '活动报名自动兑换物料请通过取消报名处理', 409)
    if (order.status === 'REFUNDED') return { duplicate: true, order }
    if (order.status === 'REDEEMED') throw new MaterialRedemptionError('REDEEMED_REFUND_UNSUPPORTED', '已核销订单暂不支持退款')
    if (order.status !== 'SUCCESS') throw new MaterialRedemptionError('ORDER_NOT_REFUNDABLE', '只有待核销订单可以退款')
    if (input.restoreStock) {
      const restored = await tx.materialRedemption.updateMany({
        where: { id: order.materialId, stockRemaining: { lte: order.material.stockTotal - order.quantity } },
        data: { stockRemaining: { increment: order.quantity } },
      })
      if (restored.count !== 1) throw new MaterialRedemptionError('INVENTORY_RESTORE_FAILED', '库存恢复失败，请先核对库存')
    }
    const changed = await tx.materialRedemptionOrder.updateMany({
      where: { id: order.id, status: 'SUCCESS' },
      data: { status: 'REFUNDED', refundedAt: new Date(), refundedByAdminId: adminId, refundReason: reason },
    })
    if (changed.count !== 1) throw new MaterialRedemptionError('ORDER_NOT_REFUNDABLE', '订单状态已发生变化，请刷新后重试')
    if (order.totalCost > 0) {
      await awardRegistrationFee(tx, {
        userId: order.userId,
        requestedAmount: order.totalCost,
        action: 'MATERIAL_REDEMPTION_REFUND',
        reason: `物料兑换退款：${reason}`,
        businessKey: `material-redemption-refund:${order.id}`,
      })
    }
    await writeMaterialAdminLog(tx, {
      adminId,
      targetUserId: order.userId,
      action: 'MATERIAL_REDEMPTION_REFUND',
      detail: { orderId: order.id, materialId: order.materialId, totalCost: order.totalCost, quantity: order.quantity, restoreStock: input.restoreStock, reason },
    })
    return { duplicate: false, order: await tx.materialRedemptionOrder.findUniqueOrThrow({ where: { id: order.id }, include: materialOrderInclude }) }
  })
  if (!result.duplicate) await notifyMaterialOrder(result.order.userId, result.order.id, `「${result.order.material.title}」兑换已退款，挂号费已退回`, '物料兑换退款')
  return { duplicate: result.duplicate, order: serializeOrder(result.order, false) }
}

export async function listAdminMaterialOrders(params: { status?: string; query?: string; page?: number; pageSize?: number } = {}) {
  await expireOrders(prisma)
  const requestedPageSize = Number.isSafeInteger(params.pageSize) ? params.pageSize! : 50
  const requestedPage = Number.isSafeInteger(params.page) ? params.page! : 1
  const pageSize = Math.min(Math.max(requestedPageSize, 1), 200)
  const page = Math.max(1, requestedPage)
  const query = sanitizeText(params.query, 80)
  const status = params.status && Object.prototype.hasOwnProperty.call(materialOrderStatusLabels, params.status) ? params.status as keyof typeof materialOrderStatusLabels : undefined
  const numericUid = query ? Number(query) : NaN
  const codeQuery = parseMaterialRedeemCode(query)
  const tokenQuery = !codeQuery && isMaterialRedeemToken(query) ? query.trim() : ''
  const identifierSearch: Prisma.MaterialRedemptionOrderWhereInput[] = codeQuery
    ? [{ redeemCode: { in: codeQuery.candidates } }, ...(isMaterialRedeemToken(query) ? [{ redeemToken: query.trim() }] : [])]
    : tokenQuery
      ? [{ redeemToken: tokenQuery }]
      : []
  const searchFilter: Prisma.MaterialRedemptionOrderWhereInput | undefined = query ? {
    OR: [
      ...identifierSearch,
      { material: { title: { contains: query } } },
      {
        user: {
          OR: [
            { nickname: { contains: query } },
            { username: { contains: query } },
            ...(Number.isSafeInteger(numericUid) ? [{ uid: numericUid }] : []),
          ],
        },
      },
    ],
  } : undefined
  const where: Prisma.MaterialRedemptionOrderWhereInput = {
    ...(status ? { status } : {}),
    ...(searchFilter || {}),
  }
  const [total, orders] = await Promise.all([
    prisma.materialRedemptionOrder.count({ where }),
    prisma.materialRedemptionOrder.findMany({ where, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], skip: (page - 1) * pageSize, take: pageSize, include: materialOrderInclude }),
  ])
  return { orders: orders.map((order) => serializeOrder(order, false)), total, page, pageSize, totalPages: Math.max(1, Math.ceil(total / pageSize)) }
}
