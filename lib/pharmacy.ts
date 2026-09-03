import { randomInt, randomUUID } from 'node:crypto'
import { Prisma, type PharmacyCampaignStatus, type PharmacyDrawResultType, type PharmacyPrizeType } from '@prisma/client'
import { createAdminActionAudit, adminAuditOperations } from '@/lib/admin-audit'
import { getBadgeAvailability } from '@/lib/badge-phase2'
import { grantBadgeWithTransaction } from '@/lib/badge-service'
import { processBadgeGrantEffects } from '@/lib/badge-phase3'
import { getBeijingDateKey, formatBeijingMonthDayTime } from '@/lib/beijing-time'
import { getShanghaiDayRange } from '@/lib/checkin'
import { publicImageUrl } from '@/lib/images'
import { prisma } from '@/lib/prisma'
import { awardRegistrationFee, consumeRegistrationFee } from '@/lib/registration-fee'
import { parseBeijingDateTime } from '@/lib/registration-availability'

export const ANGEL_GIFT_MODULE_NAME = '天使的礼物'
export const ANGEL_GIFT_SUBTITLE = '有些药，不写在处方上。'
export const ANGEL_GIFT_BADGE_SOURCE = 'ANGEL_GIFT'
export const PHARMACY_HISTORY_PAGE_SIZE = 10
export const PHARMACY_MAX_WEIGHT = 1_000_000_000

export type PharmacyErrorCode =
  | 'CAMPAIGN_NOT_FOUND'
  | 'CAMPAIGN_DRAFT'
  | 'CAMPAIGN_NOT_STARTED'
  | 'CAMPAIGN_PAUSED'
  | 'CAMPAIGN_ENDED'
  | 'DAILY_LIMIT_REACHED'
  | 'TOTAL_LIMIT_REACHED'
  | 'INSUFFICIENT_POINTS'
  | 'NO_ENABLED_PRIZES'
  | 'INVALID_PRIZE_POOL'
  | 'INVALID_PRIZE'
  | 'UNSUPPORTED_PRIZE_TYPE'
  | 'INVALID_CAMPAIGN_CONFIG'
  | 'RECYCLE_DISABLED'
  | 'RECYCLE_NOT_AVAILABLE'
  | 'DUPLICATE_INSUFFICIENT'
  | 'IDEMPOTENCY_KEY_INVALID'

export class PharmacyError extends Error {
  readonly code: PharmacyErrorCode
  readonly status: number
  readonly details: Record<string, unknown>

  constructor(code: PharmacyErrorCode, message: string, status = 400, details: Record<string, unknown> = {}) {
    super(message)
    this.name = 'PharmacyError'
    this.code = code
    this.status = status
    this.details = details
  }
}

export type PharmacyCampaignDisplayStatus = PharmacyCampaignStatus

const CAMPAIGN_STATUS_VALUES: readonly PharmacyCampaignStatus[] = ['DRAFT', 'SCHEDULED', 'ACTIVE', 'PAUSED', 'ENDED']
const PRIZE_TYPE_VALUES: readonly PharmacyPrizeType[] = ['BADGE', 'POINTS', 'EMPTY', 'ITEM', 'COUPON', 'CUSTOM']

const rarityRank: Record<string, number> = {
  LIMITED: 5,
  LEGENDARY: 4,
  EPIC: 3,
  RARE: 2,
  COMMON: 1,
}

function isValidDate(value: Date | null | undefined): value is Date {
  return Boolean(value && !Number.isNaN(value.getTime()))
}

function positiveInteger(value: unknown, field: string, options: { nullable?: boolean; max?: number } = {}) {
  if (value === null || value === undefined || value === '') {
    if (options.nullable) return null
    throw new PharmacyError('INVALID_CAMPAIGN_CONFIG', `${field}必须是正整数`)
  }
  const parsed = typeof value === 'number' ? value : Number(value)
  const max = options.max || Number.MAX_SAFE_INTEGER
  if (!Number.isSafeInteger(parsed) || parsed <= 0 || parsed > max) {
    throw new PharmacyError('INVALID_CAMPAIGN_CONFIG', `${field}必须是正整数`)
  }
  return parsed
}

function booleanValue(value: unknown, fallback = false) {
  if (value === undefined || value === null || value === '') return fallback
  if (value === true || value === 1 || value === 'true' || value === '1') return true
  if (value === false || value === 0 || value === 'false' || value === '0') return false
  return fallback
}

function nonNegativeInteger(value: unknown, field: string) {
  const parsed = typeof value === 'number' ? value : Number(value)
  if (!Number.isSafeInteger(parsed) || parsed < 0 || parsed > PHARMACY_MAX_WEIGHT) {
    throw new PharmacyError('INVALID_PRIZE', `${field}必须是 0 至 ${PHARMACY_MAX_WEIGHT} 的整数`)
  }
  return parsed
}

function parseDateInput(value: unknown, field: string, nullable = true) {
  if (value === null || value === undefined || value === '') {
    if (nullable) return null
    throw new PharmacyError('INVALID_CAMPAIGN_CONFIG', `${field}不能为空`)
  }
  if (value instanceof Date) return isValidDate(value) ? value : null
  if (typeof value !== 'string') throw new PharmacyError('INVALID_CAMPAIGN_CONFIG', `${field}格式不正确`)
  const normalized = value.trim()
  const beijing = parseBeijingDateTime(normalized)
  if (beijing) return beijing
  const parsed = new Date(normalized)
  if (!isValidDate(parsed)) throw new PharmacyError('INVALID_CAMPAIGN_CONFIG', `${field}格式不正确`)
  return parsed
}

export function effectivePharmacyCampaignStatus(
  campaign: Pick<Prisma.PharmacyCampaignGetPayload<{ select: { status: true; startsAt: true; endsAt: true } }>, 'status' | 'startsAt' | 'endsAt'>,
  now = new Date(),
): PharmacyCampaignDisplayStatus {
  if (campaign.status === 'DRAFT' || campaign.status === 'ENDED') return campaign.status
  if (campaign.endsAt && now >= campaign.endsAt) return 'ENDED'
  if (campaign.status === 'PAUSED') return 'PAUSED'
  if (campaign.startsAt && now < campaign.startsAt) return 'SCHEDULED'
  return 'ACTIVE'
}

export function normalizePharmacyCampaignInput(
  value: Record<string, unknown>,
  current?: Partial<{
    title: string
    subtitle: string | null
    description: string | null
    status: PharmacyCampaignStatus
    startsAt: Date | null
    endsAt: Date | null
    drawCost: number
    duplicateRecycleEnabled: boolean
    duplicateRecycleRequired: number | null
    duplicateRecycleReward: number | null
    recycleAfterEndEnabled: boolean
    probabilityPublic: boolean
    dailyDrawLimit: number | null
    totalDrawLimit: number | null
    visualUrl: string | null
  }>,
) {
  const get = (key: string) => Object.prototype.hasOwnProperty.call(value, key) ? value[key] : undefined
  const title = String(get('title') ?? current?.title ?? '').trim().slice(0, 191)
  if (!title) throw new PharmacyError('INVALID_CAMPAIGN_CONFIG', '请填写主题名称')
  const subtitleValue = get('subtitle') ?? current?.subtitle ?? null
  const descriptionValue = get('description') ?? current?.description ?? null
  const statusValue = get('status') ?? current?.status ?? 'DRAFT'
  if (!CAMPAIGN_STATUS_VALUES.includes(statusValue as PharmacyCampaignStatus)) throw new PharmacyError('INVALID_CAMPAIGN_CONFIG', '主题状态不正确')
  const startsAt = get('startsAt') === undefined ? current?.startsAt ?? null : parseDateInput(get('startsAt'), '开始时间')
  const endsAt = get('endsAt') === undefined ? current?.endsAt ?? null : parseDateInput(get('endsAt'), '结束时间')
  if (startsAt && endsAt && endsAt <= startsAt) throw new PharmacyError('INVALID_CAMPAIGN_CONFIG', '结束时间必须晚于开始时间')
  if (statusValue === 'SCHEDULED' && !startsAt) throw new PharmacyError('INVALID_CAMPAIGN_CONFIG', '待开始的主题必须设置开始时间')
  if ((statusValue === 'SCHEDULED' || statusValue === 'ACTIVE') && !endsAt) throw new PharmacyError('INVALID_CAMPAIGN_CONFIG', '进行中的主题必须设置结束时间')
  const drawCost = get('drawCost') === undefined ? current?.drawCost : positiveInteger(get('drawCost'), '执药费用')
  if (!drawCost) throw new PharmacyError('INVALID_CAMPAIGN_CONFIG', '执药费用必须是正整数')
  const duplicateRecycleEnabled = get('duplicateRecycleEnabled') === undefined ? Boolean(current?.duplicateRecycleEnabled) : booleanValue(get('duplicateRecycleEnabled'))
  const duplicateRecycleRequired = get('duplicateRecycleRequired') === undefined
    ? current?.duplicateRecycleRequired ?? null
    : positiveInteger(get('duplicateRecycleRequired'), '余药回收所需数量', { nullable: true })
  const duplicateRecycleReward = get('duplicateRecycleReward') === undefined
    ? current?.duplicateRecycleReward ?? null
    : positiveInteger(get('duplicateRecycleReward'), '余药回收奖励', { nullable: true })
  if (duplicateRecycleEnabled && (!duplicateRecycleRequired || !duplicateRecycleReward)) throw new PharmacyError('INVALID_CAMPAIGN_CONFIG', '启用余药回收后必须设置所需数量和奖励')
  const dailyDrawLimit = get('dailyDrawLimit') === undefined ? current?.dailyDrawLimit ?? null : positiveInteger(get('dailyDrawLimit'), '每日执药次数限制', { nullable: true })
  const totalDrawLimit = get('totalDrawLimit') === undefined ? current?.totalDrawLimit ?? null : positiveInteger(get('totalDrawLimit'), '主题总执药次数限制', { nullable: true })
  const visualUrlValue = get('visualUrl') === undefined ? current?.visualUrl ?? null : get('visualUrl')
  const visualUrl = typeof visualUrlValue === 'string' && visualUrlValue.trim() ? visualUrlValue.trim().slice(0, 2000) : null
  return {
    title,
    subtitle: typeof subtitleValue === 'string' && subtitleValue.trim() ? subtitleValue.trim().slice(0, 300) : null,
    description: typeof descriptionValue === 'string' && descriptionValue.trim() ? descriptionValue.trim().slice(0, 10000) : null,
    status: statusValue as PharmacyCampaignStatus,
    startsAt,
    endsAt,
    drawCost,
    duplicateRecycleEnabled,
    duplicateRecycleRequired,
    duplicateRecycleReward,
    recycleAfterEndEnabled: get('recycleAfterEndEnabled') === undefined ? current?.recycleAfterEndEnabled ?? true : booleanValue(get('recycleAfterEndEnabled')),
    probabilityPublic: get('probabilityPublic') === undefined ? current?.probabilityPublic ?? false : booleanValue(get('probabilityPublic')),
    dailyDrawLimit,
    totalDrawLimit,
    visualUrl,
  }
}

export function calculatePharmacyProbability(weight: number, totalWeight: number) {
  if (!Number.isSafeInteger(weight) || weight < 0 || !Number.isSafeInteger(totalWeight) || totalWeight <= 0) return 0
  return (weight / totalWeight) * 100
}

export function chooseWeightedPharmacyPrize<T extends { weight: number }>(prizes: readonly T[], roll: number): T {
  const totalWeight = prizes.reduce((total, prize) => total + prize.weight, 0)
  if (!prizes.length || totalWeight <= 0) throw new PharmacyError('INVALID_PRIZE_POOL', '奖池配置异常')
  if (!Number.isSafeInteger(roll) || roll < 0 || roll >= totalWeight) throw new RangeError('PHARMACY_ROLL_OUT_OF_RANGE')
  let cursor = 0
  for (const prize of prizes) {
    cursor += prize.weight
    if (roll < cursor) return prize
  }
  return prizes[prizes.length - 1]
}

function decimalToNumber(value: unknown) {
  if (typeof value === 'number') return value
  if (typeof value === 'string') return Number(value)
  if (value && typeof value === 'object' && 'toString' in value) return Number(String(value))
  return 0
}

const drawSelect = {
  id: true,
  userId: true,
  campaignId: true,
  prizeId: true,
  idempotencyKey: true,
  drawAt: true,
  campaignTitle: true,
  drawCost: true,
  prizeType: true,
  prizeName: true,
  badgeId: true,
  badgeName: true,
  badgeIconUrl: true,
  rarity: true,
  rewardAmount: true,
  configuredWeight: true,
  calculatedProbability: true,
  resultType: true,
  isNewBadge: true,
  isDuplicate: true,
  duplicateQuantity: true,
  balanceBefore: true,
  balanceAfter: true,
  createdAt: true,
} as const

type DrawRow = Prisma.PharmacyDrawGetPayload<{ select: typeof drawSelect }>

export type PharmacyDrawView = {
  id: string
  campaignId: string
  campaignTitle: string
  drawCost: number
  prizeType: PharmacyPrizeType
  prizeName: string
  badge: { id: string; name: string; imageUrl: string | null; rarity: string | null } | null
  rewardAmount: number | null
  configuredWeight: number
  calculatedProbability: number
  resultType: PharmacyDrawResultType
  isNewBadge: boolean
  isDuplicate: boolean
  duplicateQuantity: number
  balanceBefore: number
  balanceAfter: number
  drawAt: string
}

function serializeDraw(row: DrawRow): PharmacyDrawView {
  return {
    id: row.id,
    campaignId: row.campaignId,
    campaignTitle: row.campaignTitle,
    drawCost: row.drawCost,
    prizeType: row.prizeType,
    prizeName: row.prizeName,
    badge: row.badgeId && row.badgeName ? { id: row.badgeId, name: row.badgeName, imageUrl: publicImageUrl(row.badgeIconUrl), rarity: row.rarity } : null,
    rewardAmount: row.rewardAmount,
    configuredWeight: row.configuredWeight,
    calculatedProbability: decimalToNumber(row.calculatedProbability),
    resultType: row.resultType,
    isNewBadge: row.isNewBadge,
    isDuplicate: row.isDuplicate,
    duplicateQuantity: row.duplicateQuantity,
    balanceBefore: row.balanceBefore,
    balanceAfter: row.balanceAfter,
    drawAt: row.drawAt.toISOString(),
  }
}

type PrizeRow = Prisma.PharmacyPrizeGetPayload<{
  select: {
    id: true
    campaignId: true
    type: true
    name: true
    quantity: true
    rewardAmount: true
    weight: true
    enabled: true
    sortOrder: true
    badgeId: true
    Badge: { select: { id: true; name: true; iconUrl: true; rarity: true; visibility: true; isEnabled: true; isActive: true; availableFrom: true; availableUntil: true; sortOrder: true } }
  }
}>

const prizeSelect = {
  id: true,
  campaignId: true,
  type: true,
  name: true,
  quantity: true,
  rewardAmount: true,
  weight: true,
  enabled: true,
  sortOrder: true,
  badgeId: true,
  Badge: { select: { id: true, name: true, iconUrl: true, rarity: true, visibility: true, isEnabled: true, isActive: true, availableFrom: true, availableUntil: true, sortOrder: true } },
} as const

function usableBadge(prize: PrizeRow) {
  const badge = prize.Badge
  if (prize.type !== 'BADGE' || !prize.badgeId || !badge || !badge.isEnabled || !badge.isActive) return false
  const availability = getBadgeAvailability(badge)
  return availability === 'PERMANENT' || availability === 'AVAILABLE'
}

function validatePrizeForDraw(prize: PrizeRow) {
  if (prize.type === 'BADGE' && !usableBadge(prize)) throw new PharmacyError('INVALID_PRIZE_POOL', '奖池中存在不可用的勋章奖品')
  if (prize.type === 'POINTS' && (!prize.rewardAmount || prize.rewardAmount <= 0)) throw new PharmacyError('INVALID_PRIZE_POOL', '挂号费奖品配置异常')
  if (prize.type !== 'BADGE' && prize.type !== 'POINTS') throw new PharmacyError('UNSUPPORTED_PRIZE_TYPE', '当前奖池包含暂未开放的奖品类型')
  if (prize.weight <= 0) throw new PharmacyError('INVALID_PRIZE_POOL', '启用奖品权重必须大于 0')
}

async function getEnabledPrizePool(db: Prisma.TransactionClient | typeof prisma, campaignId: string) {
  try {
    const prizes = await db.pharmacyPrize.findMany({
      where: { campaignId, enabled: true },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
      select: prizeSelect,
    })
    if (!prizes.length) throw new PharmacyError('NO_ENABLED_PRIZES', '当前主题没有启用奖品')
    const unsupported = prizes.find((prize) => !['BADGE', 'POINTS'].includes(prize.type))
    if (unsupported) throw new PharmacyError('UNSUPPORTED_PRIZE_TYPE', '当前奖池包含暂未开放的奖品类型')
    if (prizes.some((prize) => prize.weight <= 0)) throw new PharmacyError('INVALID_PRIZE_POOL', '奖池配置异常：启用奖品权重必须大于 0')
    const weighted = prizes
    if (!weighted.length) throw new PharmacyError('INVALID_PRIZE_POOL', '奖池配置异常：启用奖品总权重必须大于 0')
    weighted.forEach(validatePrizeForDraw)
    const totalWeight = weighted.reduce((total, prize) => total + prize.weight, 0)
    if (!Number.isSafeInteger(totalWeight) || totalWeight <= 0) throw new PharmacyError('INVALID_PRIZE_POOL', '奖池配置异常')
    return { prizes: weighted, totalWeight }
  } catch (error) {
    if (error instanceof PharmacyError) console.error('[angel-gift.prize-pool]', { campaignId, code: error.code, message: error.message })
    throw error
  }
}

export async function validatePharmacyPrizePool(campaignId: string, db: Prisma.TransactionClient | typeof prisma = prisma) {
  return getEnabledPrizePool(db, campaignId)
}

function prizeDisplayName(prize: PrizeRow) {
  if (prize.type === 'POINTS') return prize.name?.trim() || `+${prize.rewardAmount || 0} 挂号费`
  return prize.name?.trim() || prize.Badge?.name || '未命名奖品'
}

async function lockUser(db: Prisma.TransactionClient, userId: string) {
  const rows = await db.$queryRaw<Array<{ id: string; points: number }>>`
    SELECT \`id\`, \`points\` FROM \`User\` WHERE \`id\` = ${userId} FOR UPDATE
  `
  const user = rows[0]
  if (!user) throw new PharmacyError('CAMPAIGN_NOT_FOUND', '用户不存在', 404)
  return user
}

async function lockCampaign(db: Prisma.TransactionClient, campaignId: string) {
  await db.$queryRaw<Array<{ id: string }>>`
    SELECT \`id\` FROM \`PharmacyCampaign\` WHERE \`id\` = ${campaignId} FOR UPDATE
  `
}

function assertCampaignAllowsDraw(campaign: { status: PharmacyCampaignStatus; startsAt: Date | null; endsAt: Date | null }, now: Date) {
  const status = effectivePharmacyCampaignStatus(campaign, now)
  if (status === 'DRAFT') throw new PharmacyError('CAMPAIGN_DRAFT', '该主题还在准备中')
  if (status === 'SCHEDULED') throw new PharmacyError('CAMPAIGN_NOT_STARTED', '主题尚未开始')
  if (status === 'PAUSED') throw new PharmacyError('CAMPAIGN_PAUSED', '药房暂时停诊')
  if (status === 'ENDED') throw new PharmacyError('CAMPAIGN_ENDED', '该主题已经结束')
}

function assertCampaignAllowsRecycle(campaign: { status: PharmacyCampaignStatus; startsAt: Date | null; endsAt: Date | null; duplicateRecycleEnabled: boolean; recycleAfterEndEnabled: boolean }, now: Date) {
  if (!campaign.duplicateRecycleEnabled) throw new PharmacyError('RECYCLE_DISABLED', '当前主题未开启余药回收')
  const status = effectivePharmacyCampaignStatus(campaign, now)
  if (status === 'DRAFT' || status === 'SCHEDULED') throw new PharmacyError('RECYCLE_NOT_AVAILABLE', '余药回收尚未开放')
  if (status === 'ENDED' && !campaign.recycleAfterEndEnabled) throw new PharmacyError('RECYCLE_NOT_AVAILABLE', '主题结束后不再回收余药')
}

async function getDuplicateTotal(userId: string, campaignId: string) {
  const aggregate = await prisma.pharmacyDuplicateInventory.aggregate({
    where: { userId, campaignId },
    _sum: { quantity: true },
  })
  return aggregate._sum.quantity || 0
}

export type PharmacyDrawResult = {
  ok: true
  duplicateRequest: boolean
  draw: PharmacyDrawView
  balance: number
  duplicateTotal: number
  duplicateRequired: number | null
}

export async function executePharmacyDraw(input: { userId: string; campaignId: string; idempotencyKey: string; now?: Date }): Promise<PharmacyDrawResult> {
  const campaignId = input.campaignId.trim()
  const idempotencyKey = input.idempotencyKey.trim()
  if (!campaignId || !idempotencyKey || idempotencyKey.length > 191) throw new PharmacyError('IDEMPOTENCY_KEY_INVALID', '执药请求标识不正确')
  const now = input.now || new Date()
  let newBadgeGrant: { badgeId: string; recordId: string } | null = null

  const outcome = await prisma.$transaction(async (tx) => {
    const lockedUser = await lockUser(tx, input.userId)
    const existing = await tx.pharmacyDraw.findUnique({
      where: { userId_idempotencyKey: { userId: input.userId, idempotencyKey } },
      select: drawSelect,
    })
    if (existing) {
      const campaign = await tx.pharmacyCampaign.findUnique({ where: { id: existing.campaignId }, select: { duplicateRecycleRequired: true } })
      return { existing, duplicateRequest: true, balance: existing.balanceAfter, duplicateRequired: campaign?.duplicateRecycleRequired ?? null }
    }

    await lockCampaign(tx, campaignId)
    const campaign = await tx.pharmacyCampaign.findUnique({ where: { id: campaignId } })
    if (!campaign) throw new PharmacyError('CAMPAIGN_NOT_FOUND', '主题不存在', 404)
    assertCampaignAllowsDraw(campaign, now)
    const pool = await getEnabledPrizePool(tx, campaign.id)
    const dateKey = getBeijingDateKey(now)
    const { start, end } = getShanghaiDayRange(now)
    const [todayCount, totalCount] = await Promise.all([
      campaign.dailyDrawLimit === null ? Promise.resolve(0) : tx.pharmacyDraw.count({ where: { userId: input.userId, campaignId: campaign.id, drawAt: { gte: start, lt: end } } }),
      campaign.totalDrawLimit === null ? Promise.resolve(0) : tx.pharmacyDraw.count({ where: { userId: input.userId, campaignId: campaign.id } }),
    ])
    if (campaign.dailyDrawLimit !== null && todayCount >= campaign.dailyDrawLimit) throw new PharmacyError('DAILY_LIMIT_REACHED', '今日已执完', 409, { current: todayCount, limit: campaign.dailyDrawLimit, dateKey })
    if (campaign.totalDrawLimit !== null && totalCount >= campaign.totalDrawLimit) throw new PharmacyError('TOTAL_LIMIT_REACHED', '本期已执完', 409, { current: totalCount, limit: campaign.totalDrawLimit })
    if (lockedUser.points < campaign.drawCost) throw new PharmacyError('INSUFFICIENT_POINTS', '挂号费不够，今天的药先欠着。', 409, { balance: lockedUser.points, required: campaign.drawCost })

    const roll = randomInt(pool.totalWeight)
    const selected = chooseWeightedPharmacyPrize(pool.prizes, roll)
    const selectedName = prizeDisplayName(selected)
    const probability = calculatePharmacyProbability(selected.weight, pool.totalWeight)
    const drawId = randomUUID()
    const isBadge = selected.type === 'BADGE'
    const ownedBadge = isBadge && selected.badgeId
      ? await tx.userBadge.findUnique({ where: { userId_badgeId: { userId: input.userId, badgeId: selected.badgeId } }, select: { id: true } })
      : null
    const predictedDuplicate = Boolean(ownedBadge)
    const resultType: PharmacyDrawResultType = isBadge ? (predictedDuplicate ? 'BADGE_DUPLICATE' : 'BADGE_NEW') : 'POINTS_REWARD'
    const expectedReward = selected.type === 'POINTS' ? selected.rewardAmount || 0 : 0

    await tx.pharmacyDraw.create({
      data: {
        id: drawId,
        userId: input.userId,
        campaignId: campaign.id,
        prizeId: selected.id,
        idempotencyKey,
        drawAt: now,
        campaignTitle: campaign.title,
        drawCost: campaign.drawCost,
        prizeType: selected.type,
        prizeName: selectedName,
        badgeId: selected.Badge?.id || null,
        badgeName: selected.Badge?.name || null,
        badgeIconUrl: selected.Badge?.iconUrl || null,
        rarity: selected.Badge?.rarity || null,
        rewardAmount: selected.type === 'POINTS' ? expectedReward : null,
        configuredWeight: selected.weight,
        calculatedProbability: probability.toFixed(6),
        resultType,
        isNewBadge: isBadge && !predictedDuplicate,
        isDuplicate: isBadge && predictedDuplicate,
        duplicateQuantity: isBadge && predictedDuplicate ? 1 : 0,
        balanceBefore: lockedUser.points,
        balanceAfter: lockedUser.points - campaign.drawCost + expectedReward,
        createdAt: now,
      },
    })

    const consumed = await consumeRegistrationFee(tx, {
      userId: input.userId,
      amount: campaign.drawCost,
      action: 'PHARMACY_DRAW_COST',
      reason: `「${campaign.title}」执药`,
      businessKey: `pharmacy:draw:${drawId}:cost`,
      pharmacyDrawId: drawId,
      now,
    })

    let finalBalance = consumed.totalPoints
    let isNewBadge = false
    let isDuplicate = false
    let resultTypeFinal: PharmacyDrawResultType = resultType
    if (selected.type === 'BADGE' && selected.badgeId) {
      const granted = await grantBadgeWithTransaction(tx, {
        userId: input.userId,
        badgeId: selected.badgeId,
        sourceType: ANGEL_GIFT_BADGE_SOURCE,
        sourceId: drawId,
        grantReason: `于「${ANGEL_GIFT_MODULE_NAME}」主题「${campaign.title}」执药获得`,
        obtainedAt: now,
        deferPhase3Effects: true,
      })
      isNewBadge = granted.created
      isDuplicate = !granted.created
      resultTypeFinal = isNewBadge ? 'BADGE_NEW' : 'BADGE_DUPLICATE'
      if (isDuplicate) {
        await tx.pharmacyDuplicateInventory.upsert({
          where: { userId_campaignId_sourceBadgeId: { userId: input.userId, campaignId: campaign.id, sourceBadgeId: selected.badgeId } },
          update: { quantity: { increment: 1 } },
          create: { userId: input.userId, campaignId: campaign.id, sourceBadgeId: selected.badgeId, quantity: 1, createdAt: now, updatedAt: now },
        })
      } else {
        newBadgeGrant = { badgeId: granted.badgeId, recordId: granted.recordId }
      }
    } else if (selected.type === 'POINTS') {
      const rewarded = await awardRegistrationFee(tx, {
        userId: input.userId,
        requestedAmount: expectedReward,
        action: 'PHARMACY_PRIZE_REWARD',
        reason: `「${campaign.title}」药房找零`,
        businessKey: `pharmacy:draw:${drawId}:reward`,
        pharmacyDrawId: drawId,
        now,
      })
      finalBalance = rewarded.totalPoints
    }

    const updated = await tx.pharmacyDraw.update({
      where: { id: drawId },
      data: { resultType: resultTypeFinal, isNewBadge, isDuplicate, duplicateQuantity: isDuplicate ? 1 : 0, balanceAfter: finalBalance },
      select: drawSelect,
    })
    return { existing: updated, duplicateRequest: false, balance: finalBalance, duplicateRequired: campaign.duplicateRecycleRequired }
  }, { timeout: 15000 })

  if (newBadgeGrant) {
    try {
      await processBadgeGrantEffects({ userId: input.userId, grants: [newBadgeGrant] })
    } catch (error) {
      console.error('[pharmacy.badge-effects]', { userId: input.userId, drawId: outcome.existing.id, error })
    }
  }
  const duplicateTotal = await getDuplicateTotal(input.userId, outcome.existing.campaignId)
  return {
    ok: true,
    duplicateRequest: outcome.duplicateRequest,
    draw: serializeDraw(outcome.existing),
    balance: outcome.balance,
    duplicateTotal,
    duplicateRequired: outcome.duplicateRequired,
  }
}

export type PharmacyRecycleResult = {
  ok: true
  duplicateRequest: boolean
  recycle: { id: string; campaignId: string; campaignTitle: string; quantity: number; rewardAmount: number; balanceBefore: number; balanceAfter: number; createdAt: string }
  balance: number
  duplicateTotal: number
  duplicateRequired: number
}

export async function recyclePharmacyDuplicates(input: { userId: string; campaignId: string; idempotencyKey: string; now?: Date }): Promise<PharmacyRecycleResult> {
  const campaignId = input.campaignId.trim()
  const idempotencyKey = input.idempotencyKey.trim()
  if (!campaignId || !idempotencyKey || idempotencyKey.length > 191) throw new PharmacyError('IDEMPOTENCY_KEY_INVALID', '回收请求标识不正确')
  const now = input.now || new Date()
  const outcome = await prisma.$transaction(async (tx) => {
    const lockedUser = await lockUser(tx, input.userId)
    const existing = await tx.pharmacyRecycleLog.findUnique({ where: { userId_idempotencyKey: { userId: input.userId, idempotencyKey } } })
    if (existing) return { existing, duplicateRequest: true, balance: existing.balanceAfter }
    await lockCampaign(tx, campaignId)
    const campaign = await tx.pharmacyCampaign.findUnique({ where: { id: campaignId } })
    if (!campaign) throw new PharmacyError('CAMPAIGN_NOT_FOUND', '主题不存在', 404)
    assertCampaignAllowsRecycle(campaign, now)
    const requiredCount = campaign.duplicateRecycleRequired
    const rewardAmount = campaign.duplicateRecycleReward
    if (!requiredCount || !rewardAmount) throw new PharmacyError('RECYCLE_DISABLED', '当前主题未配置余药回收规则')

    const inventory = await tx.pharmacyDuplicateInventory.findMany({ where: { userId: input.userId, campaignId: campaign.id, quantity: { gt: 0 } }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] })
    const beforeQuantity = inventory.reduce((total, row) => total + row.quantity, 0)
    if (beforeQuantity < requiredCount) throw new PharmacyError('DUPLICATE_INSUFFICIENT', `还差 ${requiredCount - beforeQuantity} 份余药`, 409, { current: beforeQuantity, required: requiredCount })
    const afterQuantity = beforeQuantity - requiredCount
    const recycleId = randomUUID()
    let remaining = requiredCount
    for (const row of inventory) {
      if (remaining <= 0) break
      const take = Math.min(row.quantity, remaining)
      const changed = await tx.pharmacyDuplicateInventory.updateMany({ where: { id: row.id, quantity: { gte: take } }, data: { quantity: { decrement: take } } })
      if (changed.count !== 1) throw new PharmacyError('DUPLICATE_INSUFFICIENT', '余药库存已发生变化，请刷新后重试', 409)
      remaining -= take
    }
    if (remaining !== 0) throw new PharmacyError('DUPLICATE_INSUFFICIENT', '余药库存已发生变化，请刷新后重试', 409)

    await tx.pharmacyRecycleLog.create({
      data: { id: recycleId, userId: input.userId, campaignId: campaign.id, idempotencyKey, campaignTitle: campaign.title, requiredCount, rewardAmount, beforeQuantity, afterQuantity, balanceBefore: lockedUser.points, balanceAfter: lockedUser.points + rewardAmount, createdAt: now },
    })
    const awarded = await awardRegistrationFee(tx, {
      userId: input.userId,
      requestedAmount: rewardAmount,
      action: 'PHARMACY_DUPLICATE_RECYCLE',
      reason: `「${campaign.title}」药房已回收 ${requiredCount} 份余药`,
      businessKey: `pharmacy:recycle:${recycleId}:reward`,
      pharmacyRecycleLogId: recycleId,
      now,
    })
    const updated = await tx.pharmacyRecycleLog.update({ where: { id: recycleId }, data: { balanceAfter: awarded.totalPoints } })
    return { existing: updated, duplicateRequest: false, balance: awarded.totalPoints }
  }, { timeout: 15000 })
  const duplicateTotal = await getDuplicateTotal(input.userId, outcome.existing.campaignId)
  return {
    ok: true,
    duplicateRequest: outcome.duplicateRequest,
    recycle: { id: outcome.existing.id, campaignId: outcome.existing.campaignId, campaignTitle: outcome.existing.campaignTitle, quantity: outcome.existing.requiredCount, rewardAmount: outcome.existing.rewardAmount, balanceBefore: outcome.existing.balanceBefore, balanceAfter: outcome.existing.balanceAfter, createdAt: outcome.existing.createdAt.toISOString() },
    balance: outcome.balance,
    duplicateTotal,
    duplicateRequired: outcome.existing.requiredCount,
  }
}

type PublicCampaignRow = Prisma.PharmacyCampaignGetPayload<{
  select: {
    id: true; title: true; subtitle: true; description: true; status: true; startsAt: true; endsAt: true; drawCost: true; duplicateRecycleEnabled: true; duplicateRecycleRequired: true; duplicateRecycleReward: true; recycleAfterEndEnabled: true; probabilityPublic: true; dailyDrawLimit: true; totalDrawLimit: true; visualUrl: true;
    PharmacyPrize: { select: typeof prizeSelect }
  }
}>

export type PharmacyPageData = {
  moduleName: typeof ANGEL_GIFT_MODULE_NAME
  moduleSubtitle: typeof ANGEL_GIFT_SUBTITLE
  isAuthenticated: boolean
  user: { balance: number; todayCount: number; totalCount: number } | null
  campaign: {
    id: string; title: string; subtitle: string | null; description: string | null; status: PharmacyCampaignDisplayStatus; startsAt: string | null; endsAt: string | null; drawCost: number; duplicateRecycleEnabled: boolean; duplicateRecycleRequired: number | null; duplicateRecycleReward: number | null; recycleAfterEndEnabled: boolean; probabilityPublic: boolean; dailyDrawLimit: number | null; totalDrawLimit: number | null; visualUrl: string | null; prizePoolValid: boolean
    prizes: Array<{ id: string; type: PharmacyPrizeType; name: string; rewardAmount: number | null; probability: number | null; badge: { id: string; name: string; imageUrl: string | null; rarity: string; locked: boolean } | null }>
    cabinet: Array<{ id: string; name: string; imageUrl: string | null; rarity: string | null; obtainedAt: string | null; locked: boolean }>
  } | null
  duplicate: { total: number; required: number | null; byBadge: Array<{ badgeId: string; badgeName: string; imageUrl: string | null; quantity: number }> }
  history: PharmacyHistoryItem[]
  historyHasMore: boolean
}

export type PharmacyHistoryItem = {
  id: string
  kind: 'DRAW' | 'RECYCLE'
  createdAt: string
  drawCost?: number
  result?: string
  resultType?: PharmacyDrawResultType
  rewardAmount?: number | null
  badgeName?: string | null
  isNewBadge?: boolean
  isDuplicate?: boolean
  quantity?: number
  balanceAfter?: number
}

function sortCabinetItems<T extends { sortOrder?: number; rarity: string | null; name: string }>(items: T[]) {
  return items.sort((left, right) => (left.sortOrder || 0) - (right.sortOrder || 0) || (rarityRank[right.rarity || 'COMMON'] || 0) - (rarityRank[left.rarity || 'COMMON'] || 0) || left.name.localeCompare(right.name, 'zh-CN'))
}

function publicPrizeName(prize: PrizeRow, locked: boolean) {
  if (prize.type === 'BADGE') return locked ? '???' : prize.Badge?.name || '???'
  return prizeDisplayName(prize)
}

async function findPublicCampaign(campaignId?: string | null): Promise<PublicCampaignRow | null> {
  const select = {
    id: true, title: true, subtitle: true, description: true, status: true, startsAt: true, endsAt: true, drawCost: true, duplicateRecycleEnabled: true, duplicateRecycleRequired: true, duplicateRecycleReward: true, recycleAfterEndEnabled: true, probabilityPublic: true, dailyDrawLimit: true, totalDrawLimit: true, visualUrl: true,
    PharmacyPrize: { orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }] as Prisma.PharmacyPrizeOrderByWithRelationInput[], select: prizeSelect },
  } as const
  if (campaignId) return prisma.pharmacyCampaign.findFirst({ where: { id: campaignId, status: { not: 'DRAFT' } }, select })
  const campaigns = await prisma.pharmacyCampaign.findMany({ where: { status: { in: ['SCHEDULED', 'ACTIVE', 'PAUSED', 'ENDED'] } }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 50, select })
  const now = new Date()
  return campaigns.find((campaign) => ['ACTIVE', 'SCHEDULED', 'PAUSED'].includes(effectivePharmacyCampaignStatus(campaign, now))) || campaigns.find((campaign) => effectivePharmacyCampaignStatus(campaign, now) === 'ENDED') || null
}

export async function getPharmacyHistoryPage(userId: string, campaignId: string, options: { page?: number; pageSize?: number } = {}) {
  const pageSize = Math.min(Math.max(Math.trunc(options.pageSize || PHARMACY_HISTORY_PAGE_SIZE) || PHARMACY_HISTORY_PAGE_SIZE, 1), 50)
  const page = Math.max(1, Math.trunc(options.page || 1) || 1)
  const visibleCount = page * pageSize
  const [draws, recycles] = await Promise.all([
    prisma.pharmacyDraw.findMany({ where: { userId, campaignId }, orderBy: [{ drawAt: 'desc' }, { id: 'desc' }], take: visibleCount + 1, select: drawSelect }),
    prisma.pharmacyRecycleLog.findMany({ where: { userId, campaignId }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: visibleCount + 1 }),
  ])
  const items: PharmacyHistoryItem[] = [
    ...draws.slice(0, visibleCount + 1).map((draw) => ({ id: draw.id, kind: 'DRAW' as const, createdAt: draw.drawAt.toISOString(), drawCost: draw.drawCost, result: draw.isNewBadge ? `${draw.prizeName} · 新药` : draw.isDuplicate ? `${draw.prizeName} · 余药 +1` : draw.resultType === 'POINTS_REWARD' ? `药房找零 +${draw.rewardAmount || 0}` : draw.prizeName, resultType: draw.resultType, rewardAmount: draw.rewardAmount, badgeName: draw.badgeName, isNewBadge: draw.isNewBadge, isDuplicate: draw.isDuplicate, balanceAfter: draw.balanceAfter })),
    ...recycles.slice(0, visibleCount + 1).map((recycle) => ({ id: recycle.id, kind: 'RECYCLE' as const, createdAt: recycle.createdAt.toISOString(), result: `余药 ×${recycle.requiredCount}`, quantity: recycle.requiredCount, rewardAmount: recycle.rewardAmount, balanceAfter: recycle.balanceAfter })),
  ].sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime() || right.id.localeCompare(left.id))
  const skip = (page - 1) * pageSize
  return { items: items.slice(skip, skip + pageSize), page, pageSize, hasMore: items.length > skip + pageSize }
}

export async function getPharmacyPageData(userId?: string | null, campaignId?: string | null): Promise<PharmacyPageData> {
  const [campaign, userRow] = await Promise.all([
    findPublicCampaign(campaignId),
    userId ? prisma.user.findUnique({ where: { id: userId }, select: { points: true } }) : Promise.resolve(null),
  ])
  if (!campaign) return { moduleName: ANGEL_GIFT_MODULE_NAME, moduleSubtitle: ANGEL_GIFT_SUBTITLE, isAuthenticated: Boolean(userId), user: userId ? { balance: userRow?.points ?? 0, todayCount: 0, totalCount: 0 } : null, campaign: null, duplicate: { total: 0, required: null, byBadge: [] }, history: [], historyHasMore: false }
  const now = new Date()
  const effectiveStatus = effectivePharmacyCampaignStatus(campaign, now)
  const enabledPrizeRows = campaign.PharmacyPrize.filter((prize) => prize.enabled)
  const prizePoolValid = enabledPrizeRows.length > 0 && enabledPrizeRows.every((prize) => prize.weight > 0 && (prize.type === 'BADGE' ? usableBadge(prize) : prize.type === 'POINTS' && Boolean(prize.rewardAmount && prize.rewardAmount > 0)))
  const badgePrizeRows = campaign.PharmacyPrize.filter((prize) => prize.type === 'BADGE' && prize.Badge && prize.badgeId)
  const badgeIds = [...new Set(badgePrizeRows.map((prize) => prize.badgeId!).filter(Boolean))]
  const [ownedRows, inventoryRows, history] = await Promise.all([
    userId && badgeIds.length ? prisma.userBadge.findMany({ where: { userId, badgeId: { in: badgeIds } }, select: { badgeId: true, obtainedAt: true } }) : Promise.resolve([]),
    userId ? prisma.pharmacyDuplicateInventory.findMany({ where: { userId, campaignId: campaign.id, quantity: { gt: 0 } }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], select: { sourceBadgeId: true, quantity: true, SourceBadge: { select: { id: true, name: true, iconUrl: true } } } }) : Promise.resolve([]),
    userId ? getPharmacyHistoryPage(userId, campaign.id) : Promise.resolve({ items: [] as PharmacyHistoryItem[], hasMore: false, page: 1, pageSize: PHARMACY_HISTORY_PAGE_SIZE }),
  ])
  const ownedById = new Map(ownedRows.map((row) => [row.badgeId, row]))
  const { totalWeight } = campaign.PharmacyPrize.reduce((state, prize) => ({ totalWeight: state.totalWeight + (prize.enabled && prize.weight > 0 ? prize.weight : 0) }), { totalWeight: 0 })
  const prizes = campaign.PharmacyPrize.filter((prize) => prize.enabled && prize.weight > 0).map((prize) => {
    const owned = prize.badgeId ? ownedById.get(prize.badgeId) : null
    const locked = Boolean(prize.Badge && (prize.Badge.visibility === 'SECRET' || prize.Badge.visibility === 'HIDDEN') && !owned)
    return {
      id: prize.id,
      type: prize.type,
      name: publicPrizeName(prize, locked),
      rewardAmount: prize.type === 'POINTS' ? prize.rewardAmount : null,
      probability: campaign.probabilityPublic && totalWeight > 0 ? calculatePharmacyProbability(prize.weight, totalWeight) : null,
      badge: prize.Badge && prize.badgeId ? { id: prize.badgeId, name: locked ? '???' : prize.Badge.name, imageUrl: locked ? null : publicImageUrl(prize.Badge.iconUrl), rarity: locked ? 'COMMON' : prize.Badge.rarity, locked } : null,
    }
  })
  const cabinet = sortCabinetItems(badgePrizeRows.map((prize) => {
    const badge = prize.Badge!
    const owned = ownedById.get(prize.badgeId!)
    const locked = Boolean((badge.visibility === 'SECRET' || badge.visibility === 'HIDDEN') && !owned)
    return { id: badge.id, name: locked ? '???' : badge.name, imageUrl: locked ? null : publicImageUrl(badge.iconUrl), rarity: locked ? null : badge.rarity, obtainedAt: owned?.obtainedAt.toISOString() || null, locked, sortOrder: badge.sortOrder }
  }))
  const duplicateTotal = inventoryRows.reduce((total, row) => total + row.quantity, 0)
  return {
    moduleName: ANGEL_GIFT_MODULE_NAME,
    moduleSubtitle: ANGEL_GIFT_SUBTITLE,
    isAuthenticated: Boolean(userId),
    user: userId ? { balance: userRow?.points ?? 0, todayCount: campaign.dailyDrawLimit === null ? 0 : await prisma.pharmacyDraw.count({ where: { userId, campaignId: campaign.id, drawAt: { gte: getShanghaiDayRange(now).start, lt: getShanghaiDayRange(now).end } } }), totalCount: campaign.totalDrawLimit === null ? 0 : await prisma.pharmacyDraw.count({ where: { userId, campaignId: campaign.id } }) } : null,
    campaign: { id: campaign.id, title: campaign.title, subtitle: campaign.subtitle, description: campaign.description, status: effectiveStatus, startsAt: campaign.startsAt?.toISOString() || null, endsAt: campaign.endsAt?.toISOString() || null, drawCost: campaign.drawCost, duplicateRecycleEnabled: campaign.duplicateRecycleEnabled, duplicateRecycleRequired: campaign.duplicateRecycleRequired, duplicateRecycleReward: campaign.duplicateRecycleReward, recycleAfterEndEnabled: campaign.recycleAfterEndEnabled, probabilityPublic: campaign.probabilityPublic, dailyDrawLimit: campaign.dailyDrawLimit, totalDrawLimit: campaign.totalDrawLimit, visualUrl: publicImageUrl(campaign.visualUrl), prizePoolValid, prizes, cabinet },
    duplicate: { total: duplicateTotal, required: campaign.duplicateRecycleEnabled ? campaign.duplicateRecycleRequired : null, byBadge: inventoryRows.map((row) => ({ badgeId: row.sourceBadgeId, badgeName: row.SourceBadge.name, imageUrl: publicImageUrl(row.SourceBadge.iconUrl), quantity: row.quantity })) },
    history: history.items,
    historyHasMore: history.hasMore,
  }
}

export async function getAdminPharmacyCampaigns() {
  const campaigns = await prisma.pharmacyCampaign.findMany({ orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 200, include: { _count: { select: { PharmacyPrize: true, PharmacyDraw: true, PharmacyRecycleLog: true } } } })
  return Promise.all(campaigns.map(async (campaign) => {
    const [participants, cost] = await Promise.all([
      prisma.pharmacyDraw.groupBy({ by: ['userId'], where: { campaignId: campaign.id } }),
      prisma.pharmacyDraw.aggregate({ where: { campaignId: campaign.id }, _sum: { drawCost: true } }),
    ])
    return { ...campaign, displayStatus: effectivePharmacyCampaignStatus(campaign, new Date()), participantCount: participants.length, drawCostTotal: cost._sum.drawCost || 0 }
  }))
}

export async function getAdminPharmacyCampaign(campaignId: string) {
  const campaign = await prisma.pharmacyCampaign.findUnique({ where: { id: campaignId }, include: { PharmacyPrize: { orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }], include: { Badge: { select: { id: true, name: true, iconUrl: true, rarity: true, visibility: true, isEnabled: true, isActive: true } } } } } })
  if (!campaign) return null
  const [drawCount, participants, costs, rewards, recycleRewards, prizeStats, duplicateStats, recycled, inventoryStats] = await Promise.all([
    prisma.pharmacyDraw.count({ where: { campaignId } }),
    prisma.pharmacyDraw.groupBy({ by: ['userId'], where: { campaignId } }),
    prisma.pharmacyDraw.aggregate({ where: { campaignId }, _sum: { drawCost: true } }),
    prisma.pharmacyDraw.aggregate({ where: { campaignId, resultType: 'POINTS_REWARD' }, _sum: { rewardAmount: true } }),
    prisma.pharmacyRecycleLog.aggregate({ where: { campaignId }, _sum: { rewardAmount: true } }),
    prisma.pharmacyDraw.groupBy({ by: ['prizeId', 'isNewBadge', 'isDuplicate'], where: { campaignId }, _count: { _all: true }, _sum: { rewardAmount: true } }),
    prisma.pharmacyDraw.aggregate({ where: { campaignId, isDuplicate: true }, _sum: { duplicateQuantity: true } }),
    prisma.pharmacyRecycleLog.aggregate({ where: { campaignId }, _sum: { requiredCount: true } }),
    prisma.pharmacyDuplicateInventory.aggregate({ where: { campaignId }, _sum: { quantity: true } }),
  ])
  const statsByPrize = new Map<string, { drawCount: number; newBadgeCount: number; duplicateCount: number; rewardTotal: number }>()
  for (const row of prizeStats) {
    if (!row.prizeId) continue
    const current = statsByPrize.get(row.prizeId) || { drawCount: 0, newBadgeCount: 0, duplicateCount: 0, rewardTotal: 0 }
    current.drawCount += row._count._all
    if (row.isNewBadge) current.newBadgeCount += row._count._all
    if (row.isDuplicate) current.duplicateCount += row._count._all
    current.rewardTotal += row._sum.rewardAmount || 0
    statsByPrize.set(row.prizeId, current)
  }
  const totalDraws = drawCount || 1
  const configuredWeightTotal = campaign.PharmacyPrize.reduce((total, prize) => total + (prize.enabled && prize.weight > 0 ? prize.weight : 0), 0)
  const prizeViews = campaign.PharmacyPrize.map((prize) => { const stats = statsByPrize.get(prize.id) || { drawCount: 0, newBadgeCount: 0, duplicateCount: 0, rewardTotal: 0 }; return { ...prize, badge: prize.Badge ? { ...prize.Badge, iconUrl: publicImageUrl(prize.Badge.iconUrl) } : null, calculatedProbability: prize.enabled && configuredWeightTotal > 0 ? calculatePharmacyProbability(prize.weight, configuredWeightTotal) : 0, drawCount: stats.drawCount, actualRate: (stats.drawCount / totalDraws) * 100, newBadgeCount: stats.newBadgeCount, duplicateCount: stats.duplicateCount, rewardTotal: stats.rewardTotal } })
  const costTotal = costs._sum.drawCost || 0
  const pointsRewardTotal = rewards._sum.rewardAmount || 0
  const recycleRewardTotal = recycleRewards._sum.rewardAmount || 0
  return { ...campaign, displayStatus: effectivePharmacyCampaignStatus(campaign, new Date()), prizes: prizeViews, stats: { drawCount, participantCount: participants.length, costTotal, pointsRewardTotal, recycleRewardTotal, netCost: costTotal - pointsRewardTotal - recycleRewardTotal, duplicateProduced: duplicateStats._sum.duplicateQuantity || 0, duplicateRecycled: recycled._sum.requiredCount || 0, currentDuplicate: inventoryStats._sum.quantity || 0 } }
}

export async function getAdminPharmacyBadges(search?: string | null) {
  const keyword = search?.trim()
  const badges = await prisma.badge.findMany({ where: { ...(keyword ? { OR: [{ name: { contains: keyword } }, { code: { contains: keyword } }] } : {}) }, orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }], take: 100, select: { id: true, name: true, code: true, iconUrl: true, rarity: true, visibility: true, isEnabled: true, isActive: true } })
  return badges.map((badge) => ({ ...badge, iconUrl: publicImageUrl(badge.iconUrl) }))
}

function normalizePrizeInput(value: Record<string, unknown>) {
  const type = value.type
  if (!PRIZE_TYPE_VALUES.includes(type as PharmacyPrizeType) || (type !== 'BADGE' && type !== 'POINTS')) throw new PharmacyError('UNSUPPORTED_PRIZE_TYPE', '当前只支持勋章和挂号费奖品')
  const weight = nonNegativeInteger(value.weight, '权重')
  if (weight <= 0 && value.enabled !== false) throw new PharmacyError('INVALID_PRIZE', '启用奖品权重必须大于 0')
  const enabled = value.enabled === undefined ? true : booleanValue(value.enabled, true)
  const sortOrder = Number(value.sortOrder ?? 0)
  if (!Number.isSafeInteger(sortOrder) || sortOrder < 0) throw new PharmacyError('INVALID_PRIZE', '排序必须是非负整数')
  const quantity = positiveInteger(value.quantity ?? 1, '数量') ?? 1
  const rewardAmount = type === 'POINTS' ? positiveInteger(value.rewardAmount, '奖励数量') : null
  const badgeId = type === 'BADGE' && typeof value.badgeId === 'string' && value.badgeId.trim() ? value.badgeId.trim() : null
  if (type === 'BADGE' && !badgeId) throw new PharmacyError('INVALID_PRIZE', '请选择现有勋章')
  return { type: type as PharmacyPrizeType, name: typeof value.name === 'string' && value.name.trim() ? value.name.trim().slice(0, 191) : null, quantity, rewardAmount, weight, enabled, sortOrder, badgeId }
}

export async function createPharmacyCampaign(input: { operatorId: string; data: Record<string, unknown> }) {
  const data = normalizePharmacyCampaignInput(input.data)
  return prisma.$transaction(async (tx) => {
    const campaign = await tx.pharmacyCampaign.create({ data: { ...data, createdById: input.operatorId, updatedById: input.operatorId } })
    if (campaign.status === 'ACTIVE' || campaign.status === 'SCHEDULED') await getEnabledPrizePool(tx, campaign.id)
    await createAdminActionAudit(tx, { operatorId: input.operatorId, action: 'UPDATE_SETTING', operationType: adminAuditOperations.ANGEL_GIFT_CAMPAIGN_CREATE, targetType: 'PHARMACY_CAMPAIGN', targetId: campaign.id, targetTitle: campaign.title, metadata: { status: campaign.status, drawCost: campaign.drawCost } as Prisma.InputJsonValue })
    return campaign
  })
}

export async function updatePharmacyCampaign(input: { operatorId: string; campaignId: string; data: Record<string, unknown> }) {
  return prisma.$transaction(async (tx) => {
    await lockCampaign(tx, input.campaignId)
    const current = await tx.pharmacyCampaign.findUnique({ where: { id: input.campaignId } })
    if (!current) throw new PharmacyError('CAMPAIGN_NOT_FOUND', '主题不存在', 404)
    const data = normalizePharmacyCampaignInput(input.data, current)
    const updated = await tx.pharmacyCampaign.update({ where: { id: current.id }, data: { ...data, updatedById: input.operatorId } })
    if (updated.status === 'ACTIVE' || updated.status === 'SCHEDULED') await getEnabledPrizePool(tx, updated.id)
    const operationType = current.status !== updated.status ? adminAuditOperations.ANGEL_GIFT_CAMPAIGN_STATUS : adminAuditOperations.ANGEL_GIFT_CAMPAIGN_UPDATE
    await createAdminActionAudit(tx, { operatorId: input.operatorId, action: 'UPDATE_SETTING', operationType, targetType: 'PHARMACY_CAMPAIGN', targetId: updated.id, targetTitle: updated.title, metadata: { fromStatus: current.status, toStatus: updated.status, drawCost: updated.drawCost } as Prisma.InputJsonValue })
    return updated
  })
}

export async function createPharmacyPrize(input: { operatorId: string; campaignId: string; data: Record<string, unknown> }) {
  const data = normalizePrizeInput(input.data)
  return prisma.$transaction(async (tx) => {
    await lockCampaign(tx, input.campaignId)
    const campaign = await tx.pharmacyCampaign.findUnique({ where: { id: input.campaignId } })
    if (!campaign) throw new PharmacyError('CAMPAIGN_NOT_FOUND', '主题不存在', 404)
    if (data.badgeId) {
      const badge = await tx.badge.findUnique({ where: { id: data.badgeId }, select: { id: true, isEnabled: true, isActive: true } })
      if (!badge) throw new PharmacyError('INVALID_PRIZE', '所选勋章不存在')
    }
    const prize = await tx.pharmacyPrize.create({ data: { campaignId: input.campaignId, ...data } })
    if (campaign.status === 'ACTIVE' || campaign.status === 'SCHEDULED') await getEnabledPrizePool(tx, campaign.id)
    await createAdminActionAudit(tx, { operatorId: input.operatorId, action: 'UPDATE_SETTING', operationType: adminAuditOperations.ANGEL_GIFT_PRIZE_UPDATE, targetType: 'PHARMACY_PRIZE', targetId: prize.id, targetTitle: data.name, metadata: { campaignId: campaign.id, type: data.type, badgeId: data.badgeId, weight: data.weight, rewardAmount: data.rewardAmount } as Prisma.InputJsonValue })
    return prize
  })
}

export async function updatePharmacyPrize(input: { operatorId: string; prizeId: string; data: Record<string, unknown> }) {
  const data = normalizePrizeInput(input.data)
  return prisma.$transaction(async (tx) => {
    const target = await tx.pharmacyPrize.findUnique({ where: { id: input.prizeId }, select: { id: true, campaignId: true } })
    if (!target) throw new PharmacyError('INVALID_PRIZE', '奖品不存在', 404)
    await lockCampaign(tx, target.campaignId)
    const current = await tx.pharmacyPrize.findUnique({ where: { id: input.prizeId }, include: { Campaign: true } })
    if (!current) throw new PharmacyError('INVALID_PRIZE', '奖品不存在', 404)
    if (data.badgeId) {
      const badge = await tx.badge.findUnique({ where: { id: data.badgeId }, select: { id: true } })
      if (!badge) throw new PharmacyError('INVALID_PRIZE', '所选勋章不存在')
    }
    const updated = await tx.pharmacyPrize.update({ where: { id: current.id }, data })
    if (current.Campaign.status === 'ACTIVE' || current.Campaign.status === 'SCHEDULED') await getEnabledPrizePool(tx, current.campaignId)
    await createAdminActionAudit(tx, { operatorId: input.operatorId, action: 'UPDATE_SETTING', operationType: adminAuditOperations.ANGEL_GIFT_PRIZE_UPDATE, targetType: 'PHARMACY_PRIZE', targetId: updated.id, targetTitle: data.name, metadata: { campaignId: current.campaignId, type: data.type, weight: data.weight, rewardAmount: data.rewardAmount } as Prisma.InputJsonValue })
    return updated
  })
}

export async function disablePharmacyPrize(input: { operatorId: string; prizeId: string }) {
  return prisma.$transaction(async (tx) => {
    const target = await tx.pharmacyPrize.findUnique({ where: { id: input.prizeId }, select: { id: true, campaignId: true } })
    if (!target) throw new PharmacyError('INVALID_PRIZE', '奖品不存在', 404)
    await lockCampaign(tx, target.campaignId)
    const current = await tx.pharmacyPrize.findUnique({ where: { id: input.prizeId }, include: { Campaign: true } })
    if (!current) throw new PharmacyError('INVALID_PRIZE', '奖品不存在', 404)
    const updated = await tx.pharmacyPrize.update({ where: { id: current.id }, data: { enabled: false, weight: 0 } })
    await createAdminActionAudit(tx, { operatorId: input.operatorId, action: 'UPDATE_SETTING', operationType: adminAuditOperations.ANGEL_GIFT_PRIZE_UPDATE, targetType: 'PHARMACY_PRIZE', targetId: current.id, targetTitle: current.name, reason: '停用奖品以保留历史开奖快照', metadata: { campaignId: current.campaignId, softDeleted: true } as Prisma.InputJsonValue })
    if (current.Campaign.status === 'ACTIVE' || current.Campaign.status === 'SCHEDULED') {
      try {
        await getEnabledPrizePool(tx, current.campaignId)
      } catch (error) {
        if (error instanceof PharmacyError) throw new PharmacyError('INVALID_PRIZE_POOL', '不能停用奖池中的最后一个有效奖品')
        throw error
      }
    }
    return updated
  })
}

export async function getAdminPharmacyDraws(campaignId: string, options: { page?: number; pageSize?: number } = {}) {
  const pageSize = Math.min(Math.max(Math.trunc(options.pageSize || 20) || 20, 1), 100)
  const page = Math.max(1, Math.trunc(options.page || 1) || 1)
  const rows = await prisma.pharmacyDraw.findMany({
    where: { campaignId },
    orderBy: [{ drawAt: 'desc' }, { id: 'desc' }],
    skip: (page - 1) * pageSize,
    take: pageSize + 1,
    select: { ...drawSelect, User: { select: { uid: true, nickname: true } } },
  })
  const hasMore = rows.length > pageSize
  return {
    draws: rows.slice(0, pageSize).map((row) => ({ ...serializeDraw(row), user: row.User })),
    page,
    pageSize,
    hasMore,
  }
}

export function formatPharmacyHistoryTime(value: string | Date) {
  return formatBeijingMonthDayTime(value)
}
