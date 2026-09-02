import { randomInt } from 'node:crypto'
import { Prisma } from '@prisma/client'
import { parseActivityDateInput } from '@/lib/activity'
import { adminAuditOperations, createAdminActionAudit } from '@/lib/admin-audit'
import { activityLotteryTierName, MAX_ACTIVITY_LOTTERY_PRIZES } from '@/lib/activity-lottery-levels'
import { storedActivityImageUrl } from '@/lib/activity-image-url'
import { createManyNotificationsWithDb } from '@/lib/notification-write'
import { safeNotificationWrite } from '@/lib/notification-transaction'
import { publicImageUrl } from '@/lib/images'
import { prisma } from '@/lib/prisma'
import { sanitizeText } from '@/lib/security'
import { hasValidActivityParticipation, type ActivityParticipationCheckInSnapshot } from '@/lib/activity-participation'
import { fulfillActivityLotteryWinners, type ActivityLotteryFulfillmentSummary } from '@/lib/activity-lottery-fulfillment'
import { ACTIVITY_LOTTERY_PRIZE_TYPES, ACTIVITY_LOTTERY_VIRTUAL_PRIZE_TYPES, MAX_ACTIVITY_LOTTERY_REGISTRATION_FEE, type ActivityLotteryPrizeType, type ActivityLotteryVirtualPrizeType } from '@/lib/activity-lottery-types'

export const ACTIVITY_LOTTERY_ALGORITHM_VERSION = 'SECURE_SHUFFLE_V1'
export const MAX_ACTIVITY_LOTTERY_PRIZE_QUANTITY = 100_000
export { ACTIVITY_LOTTERY_PRIZE_TYPES, ACTIVITY_LOTTERY_VIRTUAL_PRIZE_TYPES, MAX_ACTIVITY_LOTTERY_REGISTRATION_FEE } from '@/lib/activity-lottery-types'
export type { ActivityLotteryPrizeType, ActivityLotteryVirtualPrizeType } from '@/lib/activity-lottery-types'
export { activityLotteryTierName, MAX_ACTIVITY_LOTTERY_PRIZES } from '@/lib/activity-lottery-levels'

export type ActivityLotteryErrorCode =
  | 'ACTIVITY_NOT_FOUND'
  | 'LOTTERY_NOT_FOUND'
  | 'ACTIVITY_END_REQUIRED'
  | 'INVALID_DRAW_AT'
  | 'LOTTERY_NOT_DUE'
  | 'LOTTERY_ACTIVITY_ENDED'
  | 'LOTTERY_NO_ELIGIBLE_REGISTRATIONS'
  | 'LOTTERY_ALREADY_DRAWN'
  | 'LOTTERY_CANCELLED'
  | 'LOTTERY_LOCKED'
  | 'INVALID_PRIZES'
  | 'INVALID_LOTTERY'

export class ActivityLotteryError extends Error {
  constructor(readonly code: ActivityLotteryErrorCode, message: string, readonly status = 409) {
    super(message)
    this.name = 'ActivityLotteryError'
  }
}

export type LotteryPrizeInput = {
  tierName: string
  name: string
  imageUrl: string | null
  description: string | null
  quantity: number
  prizeType: ActivityLotteryPrizeType
  virtualPrizeType: ActivityLotteryVirtualPrizeType | null
  badgeId: string | null
  registrationFeeAmount: number | null
}

export type NormalizedActivityLotteryInput = {
  title: string
  description: string | null
  drawAt: Date
  prizes: LotteryPrizeInput[]
}

export type ActivityLotteryWinnerRedemptionState = 'REDEEMABLE' | 'WAITING_FOR_CHECK_IN' | 'EXPIRED' | 'REDEEMED'

export type ActivityLotteryCheckInSnapshot = ActivityParticipationCheckInSnapshot

export function hasValidActivityLotteryCheckIn(registration: ActivityLotteryCheckInSnapshot | null | undefined, activityEndAt: Date | null | undefined, now = new Date()) {
  return hasValidActivityParticipation(registration, activityEndAt, now)
}

export function getActivityLotteryWinnerRedemptionState(input: {
  redemptionStatus: 'PENDING' | 'REDEEMED'
  registration: ActivityLotteryCheckInSnapshot | null | undefined
  activityEndAt: Date | null | undefined
  activityCancelled?: boolean
  now?: Date
}): ActivityLotteryWinnerRedemptionState {
  if (input.redemptionStatus === 'REDEEMED') return 'REDEEMED'
  if (input.activityCancelled) return 'EXPIRED'
  const now = input.now || new Date()
  if (hasValidActivityLotteryCheckIn(input.registration, input.activityEndAt, now)) return 'REDEEMABLE'
  if (input.activityEndAt && !Number.isNaN(input.activityEndAt.getTime()) && now.getTime() >= input.activityEndAt.getTime()) return 'EXPIRED'
  return 'WAITING_FOR_CHECK_IN'
}

export function validateLotterySchedule(activityEndAt: Date | null | undefined, drawAt: Date | null | undefined) {
  if (!drawAt || Number.isNaN(drawAt.getTime())) return '请设置有效的开奖时间。'
  if (!activityEndAt || Number.isNaN(activityEndAt.getTime())) return '请先设置活动结束时间，再创建抽奖。'
  if (drawAt.getTime() >= activityEndAt.getTime()) return '开奖时间必须早于活动结束时间。'
  return null
}

export type ActivityLotteryDrawTrigger = 'SCHEDULED' | 'ADMIN_MANUAL'

export type ActivityLotteryDrawTimingFailure = {
  code: 'ACTIVITY_END_REQUIRED' | 'INVALID_DRAW_AT' | 'LOTTERY_NOT_DUE' | 'LOTTERY_ACTIVITY_ENDED'
  message: string
}

export function validateActivityLotteryDrawTiming(input: {
  trigger: ActivityLotteryDrawTrigger
  now: Date
  drawAt: Date | null | undefined
  activityEndAt: Date | null | undefined
}): ActivityLotteryDrawTimingFailure | null {
  if (!input.drawAt || Number.isNaN(input.drawAt.getTime())) return { code: 'INVALID_DRAW_AT', message: '开奖时间无效，无法开奖。' }
  if (!input.activityEndAt || Number.isNaN(input.activityEndAt.getTime())) return { code: 'ACTIVITY_END_REQUIRED', message: '活动结束时间未设置，无法开奖。' }
  const scheduleError = validateLotterySchedule(input.activityEndAt, input.drawAt)
  if (scheduleError) return { code: 'INVALID_DRAW_AT', message: scheduleError }
  if (input.now.getTime() >= input.activityEndAt.getTime()) return { code: 'LOTTERY_ACTIVITY_ENDED', message: '活动已经结束，无法开奖。' }
  if (input.trigger === 'SCHEDULED' && input.now.getTime() < input.drawAt.getTime()) return { code: 'LOTTERY_NOT_DUE', message: '自动开奖时间尚未到达。' }
  return null
}

export function calculateLotteryWinRate(totalPrizeSlots: number, participantCount: number) {
  if (participantCount <= 0 || totalPrizeSlots <= 0) return 0
  return Math.min(100, (totalPrizeSlots / participantCount) * 100)
}

type RandomIntSource = (maxExclusive: number) => number

export function secureShuffle<T>(items: readonly T[], source: RandomIntSource = (maxExclusive) => randomInt(maxExclusive)) {
  const result = [...items]
  for (let index = result.length - 1; index > 0; index -= 1) {
    const swapIndex = source(index + 1)
    if (!Number.isInteger(swapIndex) || swapIndex < 0 || swapIndex > index) throw new RangeError('随机源返回了无效索引')
    const current = result[index]
    result[index] = result[swapIndex]
    result[swapIndex] = current
  }
  return result
}

function parseDate(value: unknown) {
  const parsed = parseActivityDateInput(value)
  return parsed && !Number.isNaN(parsed.getTime()) ? parsed : null
}

function parseString(value: unknown, maxLength: number) {
  const normalized = sanitizeText(value, maxLength)
  return normalized || null
}

function legacyPrizeImageValue(item: Record<string, unknown>) {
  for (const key of ['imageUrl', 'prizeImageUrl', 'rewardImage']) {
    if (Object.prototype.hasOwnProperty.call(item, key)) return item[key]
  }
  return undefined
}

function parsePrizeImageUrl(value: unknown) {
  if (value === undefined || value === null || value === '') return { valid: true, value: null as string | null }
  if (typeof value !== 'string') return { valid: false, value: null as string | null }
  const normalized = parseString(value, 2_000)
  if (!normalized) return { valid: true, value: null as string | null }
  const storedActivityUrl = storedActivityImageUrl(normalized)
  if (storedActivityUrl) return { valid: true, value: storedActivityUrl }
  try {
    const parsed = new URL(normalized)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return { valid: false, value: null as string | null }
    return { valid: true, value: normalized }
  } catch {
    return { valid: false, value: null as string | null }
  }
}

function parsePositiveInteger(value: unknown, max: number) {
  const text = typeof value === 'number' ? String(value) : typeof value === 'string' ? value.trim() : ''
  if (!/^[1-9]\d*$/.test(text)) return null
  const parsed = Number(text)
  return Number.isSafeInteger(parsed) && parsed <= max ? parsed : null
}

function parseBadgeId(value: unknown) {
  const badgeId = parseString(value, 191)
  return badgeId && /^[A-Za-z0-9_-]+$/.test(badgeId) ? badgeId : null
}

export function normalizeActivityLotteryInput(value: unknown): { valid: true; value: NormalizedActivityLotteryInput } | { valid: false; message: string } {
  const input = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
  const title = sanitizeText(input.title, 160)
  if (!title) return { valid: false, message: '请填写抽奖名称。' }
  const drawAt = parseDate(input.drawAt)
  if (!drawAt) return { valid: false, message: '请设置有效的开奖时间。' }

  if (!Array.isArray(input.prizes) || input.prizes.length < 1 || input.prizes.length > MAX_ACTIVITY_LOTTERY_PRIZES) {
    return { valid: false, message: `抽奖至少需要 1 个奖项，最多支持 ${MAX_ACTIVITY_LOTTERY_PRIZES} 个奖项。` }
  }
  const prizes: LotteryPrizeInput[] = []
  for (let index = 0; index < input.prizes.length; index += 1) {
    const raw = input.prizes[index]
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { valid: false, message: `第 ${index + 1} 个奖项格式不正确。` }
    const item = raw as Record<string, unknown>
    const tierName = activityLotteryTierName(index)
    const name = sanitizeText(item.name ?? item.prizeName, 300)
    const quantity = typeof item.quantity === 'number' ? Math.trunc(item.quantity) : Number.parseInt(String(item.quantity ?? ''), 10)
    const prizeType = item.prizeType === undefined ? 'PHYSICAL' : item.prizeType
    if (!tierName) return { valid: false, message: `第 ${index + 1} 个奖项等级无效。` }
    if (!name) return { valid: false, message: `第 ${index + 1} 个奖项请填写奖品名称。` }
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > MAX_ACTIVITY_LOTTERY_PRIZE_QUANTITY) return { valid: false, message: `第 ${index + 1} 个奖项数量必须在 1-${MAX_ACTIVITY_LOTTERY_PRIZE_QUANTITY} 之间。` }
    if (!ACTIVITY_LOTTERY_PRIZE_TYPES.includes(prizeType as ActivityLotteryPrizeType)) return { valid: false, message: `第 ${index + 1} 个奖项类型无效。` }
    const image = parsePrizeImageUrl(legacyPrizeImageValue(item))
    if (!image.valid) return { valid: false, message: `第 ${index + 1} 个奖项图片无效，请通过上传图片添加。` }
    let virtualPrizeType: ActivityLotteryVirtualPrizeType | null = null
    let badgeId: string | null = null
    let registrationFeeAmount: number | null = null
    if (prizeType === 'VIRTUAL') {
      if (!ACTIVITY_LOTTERY_VIRTUAL_PRIZE_TYPES.includes(item.virtualPrizeType as ActivityLotteryVirtualPrizeType)) return { valid: false, message: `第 ${index + 1} 个虚拟奖品请选择具体类型。` }
      virtualPrizeType = item.virtualPrizeType as ActivityLotteryVirtualPrizeType
      if (virtualPrizeType === 'BADGE') {
        badgeId = parseBadgeId(item.badgeId)
        if (!badgeId) return { valid: false, message: `第 ${index + 1} 个虚拟奖品请选择有效勋章。` }
      } else {
        registrationFeeAmount = parsePositiveInteger(item.registrationFeeAmount, MAX_ACTIVITY_LOTTERY_REGISTRATION_FEE)
        if (!registrationFeeAmount) return { valid: false, message: `第 ${index + 1} 个虚拟奖品挂号费必须是 1-${MAX_ACTIVITY_LOTTERY_REGISTRATION_FEE} 的整数。` }
      }
    }
    prizes.push({
      tierName,
      name,
      imageUrl: image.value,
      description: parseString(item.description, 2000),
      quantity,
      prizeType: prizeType as ActivityLotteryPrizeType,
      virtualPrizeType,
      badgeId,
      registrationFeeAmount,
    })
  }
  return { valid: true, value: { title, description: parseString(input.description, 2000), drawAt, prizes } }
}

function iso(value: Date | null | undefined) {
  return value ? value.toISOString() : null
}

function legacyPrizeImageFromMetadata(value: Prisma.JsonValue | null | undefined) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const metadata = value as Record<string, unknown>
  for (const key of ['imageUrl', 'prizeImageUrl', 'rewardImage']) {
    const candidate = metadata[key]
    if (typeof candidate === 'string' && candidate.trim()) return candidate
    if (candidate && typeof candidate === 'object' && !Array.isArray(candidate)) {
      const url = (candidate as Record<string, unknown>).url
      if (typeof url === 'string' && url.trim()) return url
    }
  }
  return null
}

function publicPrizeImageUrl(imageUrl: string | null, metadata?: Prisma.JsonValue | null) {
  return publicImageUrl(imageUrl) || publicImageUrl(legacyPrizeImageFromMetadata(metadata))
}

const adminLotterySelect = {
  id: true,
  title: true,
  description: true,
  drawAt: true,
  status: true,
  eligibleCount: true,
  winnerCount: true,
  drawnAt: true,
  cancelledAt: true,
  algorithmVersion: true,
  createdAt: true,
  updatedAt: true,
  Activity: { select: { status: true, endsAt: true } },
  LotteryPrize: {
    orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
    select: {
      id: true,
      tierName: true,
      name: true,
      imageUrl: true,
      metadata: true,
      description: true,
      prizeType: true,
      virtualPrizeType: true,
      badgeId: true,
      registrationFeeAmount: true,
      Badge: { select: { id: true, name: true, iconUrl: true } },
      quantity: true,
      remaining: true,
      sortOrder: true,
      _count: { select: { LotteryEntry: true } },
    },
  },
  LotteryEntry: {
    orderBy: [{ wonAt: 'asc' }, { id: 'asc' }],
    select: {
      id: true,
      userId: true,
      registrationId: true,
      redemptionStatus: true,
      wonAt: true,
      redeemedAt: true,
      fulfillmentStatus: true,
      fulfilledAt: true,
      fulfillmentError: true,
      LotteryPrize: { select: { id: true, tierName: true, name: true, prizeType: true, virtualPrizeType: true, registrationFeeAmount: true } },
      Registration: { select: { id: true, status: true, verifiedAt: true, checkedInAt: true, checkInSource: true } },
      User: { select: { uid: true, nickname: true } },
    },
  },
} satisfies Prisma.LotterySelect

type AdminLotteryRow = Prisma.LotteryGetPayload<{ select: typeof adminLotterySelect }>

export type ActivityLotteryAdminView = {
  id: string
  title: string
  description: string | null
  drawAt: string | null
  status: 'DRAFT' | 'SCHEDULED' | 'DRAWN' | 'CANCELLED'
  eligibleCount: number | null
  winnerCount: number | null
  drawnAt: string | null
  cancelledAt: string | null
  algorithmVersion: string | null
  createdAt: string
  updatedAt: string
  prizes: Array<{
    id: string
    tierName: string | null
     name: string
     imageUrl: string | null
     description: string | null
     prizeType: ActivityLotteryPrizeType
     virtualPrizeType: ActivityLotteryVirtualPrizeType | null
     badgeId: string | null
     badge: { id: string; name: string; imageUrl: string | null } | null
     registrationFeeAmount: number | null
     quantity: number
    remaining: number
    sortOrder: number
    winnerCount: number
  }>
  winners: Array<{
    id: string
    uid: number
    nickname: string
    tierName: string
     prizeName: string
     prizeType: ActivityLotteryPrizeType
     virtualPrizeType: ActivityLotteryVirtualPrizeType | null
     registrationFeeAmount: number | null
     redemptionStatus: 'PENDING' | 'REDEEMED'
     redemptionState: ActivityLotteryWinnerRedemptionState | null
     fulfillmentStatus: 'NOT_REQUIRED' | 'PENDING' | 'FULFILLED' | 'FAILED'
     fulfilledAt: string | null
     fulfillmentError: string | null
     wonAt: string
    redeemedAt: string | null
  }>
}

export type ActivityLotteryAdminListView = {
  activity: {
    id: string
    title: string
    status: string
    startsAt: string | null
    endsAt: string | null
    registrationEndAt: string | null
    signupLimit: number | null
    activeParticipantCount: number
  }
  lotteries: ActivityLotteryAdminView[]
}

function serializeAdminLottery(row: AdminLotteryRow, now = new Date()): ActivityLotteryAdminView {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    drawAt: iso(row.drawAt),
    status: row.status,
    eligibleCount: row.eligibleCount,
    winnerCount: row.winnerCount,
    drawnAt: iso(row.drawnAt),
    cancelledAt: iso(row.cancelledAt),
    algorithmVersion: row.algorithmVersion,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    prizes: row.LotteryPrize.map((prize) => ({
      id: prize.id,
      tierName: prize.tierName,
      name: prize.name,
      imageUrl: publicPrizeImageUrl(prize.imageUrl, prize.metadata),
      description: prize.description,
      prizeType: prize.prizeType,
      virtualPrizeType: prize.virtualPrizeType,
      badgeId: prize.badgeId,
      badge: prize.Badge ? { id: prize.Badge.id, name: prize.Badge.name, imageUrl: publicImageUrl(prize.Badge.iconUrl) } : null,
      registrationFeeAmount: prize.registrationFeeAmount,
      quantity: prize.quantity,
      remaining: prize.remaining,
      sortOrder: prize.sortOrder,
      winnerCount: prize._count.LotteryEntry,
    })),
    winners: row.LotteryEntry.map((entry) => ({
      id: entry.id,
      uid: entry.User.uid,
      nickname: entry.User.nickname,
      tierName: entry.LotteryPrize?.tierName || '中奖奖项',
      prizeName: entry.LotteryPrize?.name || '奖品',
      prizeType: entry.LotteryPrize?.prizeType || 'PHYSICAL',
      virtualPrizeType: entry.LotteryPrize?.virtualPrizeType || null,
      registrationFeeAmount: entry.LotteryPrize?.registrationFeeAmount || null,
      redemptionStatus: entry.redemptionStatus,
      redemptionState: entry.LotteryPrize?.prizeType === 'VIRTUAL' ? null : getActivityLotteryWinnerRedemptionState({ redemptionStatus: entry.redemptionStatus, registration: entry.Registration, activityEndAt: row.Activity?.endsAt, activityCancelled: row.Activity?.status === 'CANCELLED', now }),
      fulfillmentStatus: entry.fulfillmentStatus,
      fulfilledAt: iso(entry.fulfilledAt),
      fulfillmentError: entry.fulfillmentError,
      wonAt: entry.wonAt.toISOString(),
      redeemedAt: iso(entry.redeemedAt),
    })),
  }
}

export async function getAdminActivityLotteries(activityId: string): Promise<ActivityLotteryAdminListView | null> {
  const [activity, lotteries, activeParticipantCount] = await Promise.all([
    prisma.activity.findUnique({ where: { id: activityId }, select: { id: true, title: true, status: true, startsAt: true, endsAt: true, registrationEndAt: true, signupLimit: true } }),
    prisma.lottery.findMany({ where: { activityId }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], select: adminLotterySelect }),
    prisma.activityRegistration.count({ where: { activityId, status: 'ACTIVE', User: { status: 'ACTIVE', isDeleted: false } } }),
  ])
  if (!activity) return null
  return {
    activity: {
      id: activity.id,
      title: activity.title,
      status: activity.status,
      startsAt: iso(activity.startsAt),
      endsAt: iso(activity.endsAt),
      registrationEndAt: iso(activity.registrationEndAt),
      signupLimit: activity.signupLimit,
      activeParticipantCount,
    },
    lotteries: lotteries.map((lottery) => serializeAdminLottery(lottery)),
  }
}

export type ActivityLotteryPublicView = {
  id: string
  title: string
  description: string | null
  drawAt: string | null
  status: 'SCHEDULED' | 'DRAWN'
  eligibleCount: number | null
  winnerCount: number | null
  drawnAt: string | null
  prizes: Array<{
    id: string
    tierName: string | null
    name: string
    imageUrl: string | null
    description: string | null
    quantity: number
    prizeType: ActivityLotteryPrizeType
    virtualPrizeType: ActivityLotteryVirtualPrizeType | null
    badge: { id: string; name: string; imageUrl: string | null } | null
    registrationFeeAmount: number | null
  }>
  winner: {
    tierName: string
    prizeName: string
    prizeType: 'PHYSICAL'
    virtualPrizeType: null
    badge: null
    registrationFeeAmount: null
    redemptionStatus: 'PENDING' | 'REDEEMED'
    redemptionState: ActivityLotteryWinnerRedemptionState
    redeemable: boolean
    fulfillmentStatus: 'NOT_REQUIRED'
    fulfilledAt: null
    redeemedAt: string | null
  } | {
    tierName: string
    prizeName: string
    prizeType: 'VIRTUAL'
    virtualPrizeType: ActivityLotteryVirtualPrizeType
    badge: { id: string; name: string; imageUrl: string | null } | null
    registrationFeeAmount: number | null
    redemptionStatus: 'PENDING' | 'REDEEMED'
    redemptionState: null
    redeemable: false
    fulfillmentStatus: 'PENDING' | 'FULFILLED' | 'FAILED' | 'NOT_REQUIRED'
    fulfilledAt: string | null
    redeemedAt: string | null
  } | null
}

export async function getPublicActivityLotteries(activityId: string, viewerId?: string | null): Promise<ActivityLotteryPublicView[]> {
  const lotteries = await prisma.lottery.findMany({
    where: { activityId, status: { in: ['SCHEDULED', 'DRAWN'] }, Activity: { status: 'PUBLISHED' } },
    orderBy: [{ drawAt: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
    select: {
      id: true,
      title: true,
      description: true,
      drawAt: true,
      status: true,
      eligibleCount: true,
      winnerCount: true,
      drawnAt: true,
      Activity: { select: { status: true, endsAt: true } },
      LotteryPrize: {
        orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
        select: {
          id: true,
          tierName: true,
          name: true,
          imageUrl: true,
          metadata: true,
          description: true,
          quantity: true,
          prizeType: true,
          virtualPrizeType: true,
          registrationFeeAmount: true,
          Badge: { select: { id: true, name: true, iconUrl: true } },
        },
      },
    },
  })
  const winnerRows = viewerId && lotteries.length
    ? await prisma.lotteryEntry.findMany({
        where: { userId: viewerId, lotteryId: { in: lotteries.map((lottery) => lottery.id) } },
        select: {
          lotteryId: true,
          redemptionStatus: true,
          redeemedAt: true,
          registrationId: true,
          fulfillmentStatus: true,
          fulfilledAt: true,
          Registration: { select: { id: true, status: true, verifiedAt: true, checkedInAt: true, checkInSource: true } },
          LotteryPrize: { select: { tierName: true, name: true, prizeType: true, virtualPrizeType: true, registrationFeeAmount: true, Badge: { select: { id: true, name: true, iconUrl: true } } } },
        },
      })
    : []
  const winners = new Map(winnerRows.map((winner) => [winner.lotteryId, winner]))
  return lotteries.filter((lottery): lottery is typeof lottery & { status: 'SCHEDULED' | 'DRAWN' } => lottery.status === 'SCHEDULED' || lottery.status === 'DRAWN').map((lottery) => {
    const winner = winners.get(lottery.id)
    const redemptionState = winner && winner.LotteryPrize?.prizeType !== 'VIRTUAL'
      ? getActivityLotteryWinnerRedemptionState({ redemptionStatus: winner.redemptionStatus, registration: winner.Registration, activityEndAt: lottery.Activity?.endsAt })
      : null
    return {
      id: lottery.id,
      title: lottery.title,
      description: lottery.description,
      drawAt: iso(lottery.drawAt),
      status: lottery.status,
      eligibleCount: lottery.eligibleCount,
      winnerCount: lottery.winnerCount,
      drawnAt: iso(lottery.drawnAt),
      prizes: lottery.LotteryPrize.map((prize) => ({
        id: prize.id,
        tierName: prize.tierName,
        name: prize.name,
        imageUrl: publicPrizeImageUrl(prize.imageUrl, prize.metadata),
        description: prize.description,
        quantity: prize.quantity,
        prizeType: prize.prizeType,
        virtualPrizeType: prize.virtualPrizeType,
        badge: prize.Badge ? { id: prize.Badge.id, name: prize.Badge.name, imageUrl: publicImageUrl(prize.Badge.iconUrl) } : null,
        registrationFeeAmount: prize.registrationFeeAmount,
      })),
      winner: winner && winner.LotteryPrize
        ? winner.LotteryPrize.prizeType === 'VIRTUAL'
          ? {
              tierName: winner.LotteryPrize.tierName || '中奖奖项',
              prizeName: winner.LotteryPrize.name,
              prizeType: 'VIRTUAL' as const,
              virtualPrizeType: winner.LotteryPrize.virtualPrizeType || 'BADGE',
              badge: winner.LotteryPrize.Badge ? { id: winner.LotteryPrize.Badge.id, name: winner.LotteryPrize.Badge.name, imageUrl: publicImageUrl(winner.LotteryPrize.Badge.iconUrl) } : null,
              registrationFeeAmount: winner.LotteryPrize.registrationFeeAmount,
              redemptionStatus: winner.redemptionStatus,
              redemptionState: null,
              redeemable: false as const,
              fulfillmentStatus: winner.fulfillmentStatus,
              fulfilledAt: iso(winner.fulfilledAt),
              redeemedAt: iso(winner.redeemedAt),
            }
          : {
              tierName: winner.LotteryPrize.tierName || '中奖奖项',
              prizeName: winner.LotteryPrize.name,
              prizeType: 'PHYSICAL' as const,
              virtualPrizeType: null,
              badge: null,
              registrationFeeAmount: null,
              redemptionStatus: winner.redemptionStatus,
              redemptionState: redemptionState || 'WAITING_FOR_CHECK_IN',
              redeemable: redemptionState === 'REDEEMABLE',
              fulfillmentStatus: 'NOT_REQUIRED' as const,
              fulfilledAt: null,
              redeemedAt: iso(winner.redeemedAt),
            }
        : null,
    }
  })
}

async function lockActivity(tx: Prisma.TransactionClient, activityId: string) {
  const locked = await tx.$queryRaw<Array<{ id: string }>>`SELECT \`id\` FROM \`Activity\` WHERE \`id\` = ${activityId} FOR UPDATE`
  if (!locked.length) throw new ActivityLotteryError('ACTIVITY_NOT_FOUND', '活动不存在', 404)
  const activity = await tx.activity.findUnique({ where: { id: activityId }, select: { id: true, title: true, status: true, endsAt: true, registrationEndAt: true, signupLimit: true } })
  if (!activity) throw new ActivityLotteryError('ACTIVITY_NOT_FOUND', '活动不存在', 404)
  return activity
}

function prizeCreateData(prizes: LotteryPrizeInput[]) {
  return prizes.map((prize, sortOrder) => ({
    name: prize.name,
    tierName: prize.tierName,
    imageUrl: prize.imageUrl,
    description: prize.description,
    // Keep the old RewardType column populated for legacy readers while the
    // explicit prizeType/virtualPrizeType columns are the source of truth.
    type: prize.prizeType === 'VIRTUAL' && prize.virtualPrizeType === 'BADGE' ? 'BADGE' as const : prize.prizeType === 'VIRTUAL' ? 'POINTS' as const : 'PHYSICAL' as const,
    prizeType: prize.prizeType,
    virtualPrizeType: prize.virtualPrizeType,
    badgeId: prize.badgeId,
    registrationFeeAmount: prize.registrationFeeAmount,
    quantity: prize.quantity,
    remaining: prize.quantity,
    sortOrder,
  }))
}

async function validateLotteryPrizeReferences(tx: Prisma.TransactionClient, prizes: LotteryPrizeInput[]) {
  const badgeIds = [...new Set(prizes.flatMap((prize) => prize.badgeId ? [prize.badgeId] : []))]
  if (!badgeIds.length) return
  const badges = await tx.badge.findMany({ where: { id: { in: badgeIds }, isEnabled: true, isActive: true }, select: { id: true } })
  const availableIds = new Set(badges.map((badge) => badge.id))
  if (badgeIds.some((badgeId) => !availableIds.has(badgeId))) throw new ActivityLotteryError('INVALID_PRIZES', '所选勋章不存在或当前未启用。', 400)
}

export async function createActivityLottery(activityId: string, adminId: string, input: unknown) {
  const normalized = normalizeActivityLotteryInput(input)
  if (!normalized.valid) throw new ActivityLotteryError('INVALID_LOTTERY', normalized.message, 400)
  const result = await prisma.$transaction(async (tx) => {
    const activity = await lockActivity(tx, activityId)
    if (activity.status === 'CANCELLED') throw new ActivityLotteryError('LOTTERY_CANCELLED', '已取消的活动不能创建抽奖')
    const scheduleError = validateLotterySchedule(activity.endsAt, normalized.value.drawAt)
    if (scheduleError) throw new ActivityLotteryError(activity.endsAt ? 'INVALID_DRAW_AT' : 'ACTIVITY_END_REQUIRED', scheduleError, 400)
    await validateLotteryPrizeReferences(tx, normalized.value.prizes)
    const lottery = await tx.lottery.create({
      data: {
        title: normalized.value.title,
        description: normalized.value.description,
        drawAt: normalized.value.drawAt,
        status: 'SCHEDULED',
        pointsCost: 0,
        activityId,
        createdById: adminId,
        LotteryPrize: { create: prizeCreateData(normalized.value.prizes) },
      },
      select: { id: true },
    })
    await createAdminActionAudit(tx, {
      operatorId: adminId,
      action: 'CREATE_ACTIVITY',
      operationType: adminAuditOperations.ACTIVITY_LOTTERY_CREATE,
      targetType: 'ACTIVITY_LOTTERY',
      targetId: lottery.id,
      targetTitle: normalized.value.title,
      metadata: { activityId, drawAt: normalized.value.drawAt.toISOString(), prizeCount: normalized.value.prizes.length } as Prisma.InputJsonValue,
    })
    return lottery
  }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted, timeout: 15_000, maxWait: 5_000 })
  return result
}

export async function updateActivityLottery(activityId: string, lotteryId: string, adminId: string, input: unknown) {
  const normalized = normalizeActivityLotteryInput(input)
  if (!normalized.valid) throw new ActivityLotteryError('INVALID_LOTTERY', normalized.message, 400)
  return prisma.$transaction(async (tx) => {
    const activity = await lockActivity(tx, activityId)
    if (activity.status === 'CANCELLED') throw new ActivityLotteryError('LOTTERY_CANCELLED', '已取消的活动不能编辑抽奖')
    const lottery = await tx.lottery.findFirst({ where: { id: lotteryId, activityId }, select: { id: true, status: true, title: true } })
    if (!lottery) throw new ActivityLotteryError('LOTTERY_NOT_FOUND', '抽奖不存在', 404)
    if (lottery.status === 'DRAWN') throw new ActivityLotteryError('LOTTERY_LOCKED', '抽奖已经开奖，不能修改')
    if (lottery.status === 'CANCELLED') throw new ActivityLotteryError('LOTTERY_CANCELLED', '已取消的抽奖不能修改')
    const scheduleError = validateLotterySchedule(activity.endsAt, normalized.value.drawAt)
    if (scheduleError) throw new ActivityLotteryError(activity.endsAt ? 'INVALID_DRAW_AT' : 'ACTIVITY_END_REQUIRED', scheduleError, 400)
    await validateLotteryPrizeReferences(tx, normalized.value.prizes)
    await tx.lottery.update({ where: { id: lottery.id }, data: { title: normalized.value.title, description: normalized.value.description, drawAt: normalized.value.drawAt, status: 'SCHEDULED' }, select: { id: true } })
    await tx.lotteryPrize.deleteMany({ where: { lotteryId: lottery.id } })
    await tx.lotteryPrize.createMany({ data: prizeCreateData(normalized.value.prizes).map((prize) => ({ ...prize, lotteryId: lottery.id })) })
    await createAdminActionAudit(tx, {
      operatorId: adminId,
      action: 'UPDATE_SETTING',
      operationType: adminAuditOperations.ACTIVITY_LOTTERY_UPDATE,
      targetType: 'ACTIVITY_LOTTERY',
      targetId: lottery.id,
      targetTitle: normalized.value.title,
      metadata: { activityId, drawAt: normalized.value.drawAt.toISOString(), prizeCount: normalized.value.prizes.length } as Prisma.InputJsonValue,
    })
    return { id: lottery.id }
  }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted, timeout: 15_000, maxWait: 5_000 })
}

export async function cancelActivityLottery(activityId: string, lotteryId: string, adminId: string) {
  return prisma.$transaction(async (tx) => {
    await lockActivity(tx, activityId)
    const current = await tx.lottery.findFirst({ where: { id: lotteryId, activityId }, select: { id: true, title: true, status: true } })
    if (!current) throw new ActivityLotteryError('LOTTERY_NOT_FOUND', '抽奖不存在', 404)
    if (current.status === 'DRAWN') throw new ActivityLotteryError('LOTTERY_LOCKED', '抽奖已经开奖，不能取消')
    if (current.status === 'CANCELLED') return { alreadyCancelled: true }
    await tx.lottery.update({ where: { id: current.id }, data: { status: 'CANCELLED', cancelledAt: new Date() }, select: { id: true } })
    await createAdminActionAudit(tx, {
      operatorId: adminId,
      action: 'UPDATE_SETTING',
      operationType: adminAuditOperations.ACTIVITY_LOTTERY_CANCEL,
      targetType: 'ACTIVITY_LOTTERY',
      targetId: current.id,
      targetTitle: current.title,
      metadata: { activityId } as Prisma.InputJsonValue,
    })
    return { alreadyCancelled: false }
  }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted, timeout: 15_000, maxWait: 5_000 })
}

export async function cancelUndrawnActivityLotteriesInTransaction(tx: Prisma.TransactionClient, activityId: string, now = new Date()) {
  // Activity cancellation supersedes the normal rule that a drawn lottery is
  // locked. Keep its entries, prizes, and drawnAt for history, but mark the
  // lottery unavailable so no later draw or prize redemption can proceed.
  return tx.lottery.updateMany({ where: { activityId, status: { not: 'CANCELLED' } }, data: { status: 'CANCELLED', cancelledAt: now } })
}

export type DrawOptions = { trigger: ActivityLotteryDrawTrigger; now?: Date; actorId?: string; expectedActivityId?: string }

export type ActivityLotteryDrawResult = {
  status: 'DRAWN' | 'ALREADY_DRAWN' | 'CANCELLED'
  lotteryId: string
  activityId: string | null
  eligibleCount: number
  winnerCount: number
  drawnAt: string | null
  winners: Array<{
    id: string
    userId: string
    registrationId: string | null
    prizeId: string
    tierName: string
    prizeName: string
    prizeType: ActivityLotteryPrizeType
    virtualPrizeType: ActivityLotteryVirtualPrizeType | null
    registrationFeeAmount: number | null
  }>
  fulfillment: ActivityLotteryFulfillmentSummary
}

export type ActivityLotteryCandidate = { id: string; userId: string }

export function splitActivityLotteryResultRecipients(
  registrations: readonly ActivityLotteryCandidate[],
  winnerRegistrationIds: ReadonlySet<string>,
) {
  return {
    winners: registrations.filter((registration) => winnerRegistrationIds.has(registration.id)),
    nonWinners: registrations.filter((registration) => !winnerRegistrationIds.has(registration.id)),
  }
}

function activityLotteryResultNotificationData(input: {
  lotteryId: string
  activityId: string
  activityTitle: string
  lotteryTitle: string
  userId: string
  winner: ActivityLotteryDrawResult['winners'][number] | null
}): Prisma.NotificationCreateManyInput | null {
  const winner = input.winner
  if (winner?.prizeType === 'VIRTUAL') return null
  return {
    recipientId: input.userId,
    actorId: null,
    type: 'ACTIVITY',
    title: winner ? '恭喜你中奖了！' : '活动抽奖结果已公布',
    content: winner
      ? `恭喜你在「${input.activityTitle}」的「${input.lotteryTitle}」抽奖中获得：${winner.tierName} · ${winner.prizeName}。请使用该活动现有核销码领取。`
      : `「${input.activityTitle}」的「${input.lotteryTitle}」抽奖结果已公布，很遗憾，本次未中奖，感谢参与。`,
    link: `/activities/${input.activityId}`,
    key: `activity-lottery-result:${input.lotteryId}:${input.userId}`,
  }
}

export async function drawActivityLotteryInTransaction(tx: Prisma.TransactionClient, lotteryId: string, options: DrawOptions = { trigger: 'SCHEDULED' }): Promise<ActivityLotteryDrawResult> {
  const now = options.now || new Date()
  const initial = await tx.lottery.findUnique({ where: { id: lotteryId }, select: { activityId: true } })
  if (!initial) throw new ActivityLotteryError('LOTTERY_NOT_FOUND', '抽奖不存在', 404)
  // Registration cancellation and activity cancellation both lock the Activity
  // row before inspecting lotteries. Keep the same order here so the final
  // eligible-registration snapshot cannot race a cancellation or draw.
  if (initial.activityId) await lockActivity(tx, initial.activityId)
  const locked = await tx.$queryRaw<Array<{ id: string }>>`SELECT \`id\` FROM \`Lottery\` WHERE \`id\` = ${lotteryId} FOR UPDATE`
  if (!locked.length) throw new ActivityLotteryError('LOTTERY_NOT_FOUND', '抽奖不存在', 404)
  const lottery = await tx.lottery.findUnique({
    where: { id: lotteryId },
    select: {
      id: true,
      title: true,
      activityId: true,
      drawAt: true,
      status: true,
      eligibleCount: true,
      winnerCount: true,
      drawnAt: true,
       Activity: { select: { id: true, title: true, status: true, endsAt: true } },
       LotteryPrize: { orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }], select: { id: true, tierName: true, name: true, quantity: true, prizeType: true, virtualPrizeType: true, registrationFeeAmount: true } },
    },
  })
  if (!lottery) throw new ActivityLotteryError('LOTTERY_NOT_FOUND', '抽奖不存在', 404)
  if (options.expectedActivityId && lottery.activityId !== options.expectedActivityId) throw new ActivityLotteryError('INVALID_LOTTERY', '抽奖不属于当前活动', 403)
  if (lottery.status === 'DRAWN') {
    const entries = await tx.lotteryEntry.findMany({ where: { lotteryId }, orderBy: [{ wonAt: 'asc' }, { id: 'asc' }], select: { id: true, userId: true, registrationId: true, prizeId: true, LotteryPrize: { select: { tierName: true, name: true, prizeType: true, virtualPrizeType: true, registrationFeeAmount: true } } } })
    return {
      status: 'ALREADY_DRAWN',
      lotteryId,
      activityId: lottery.activityId,
      eligibleCount: lottery.eligibleCount || 0,
      winnerCount: lottery.winnerCount || entries.length,
      drawnAt: iso(lottery.drawnAt),
      winners: entries.filter((entry): entry is typeof entry & { prizeId: string; LotteryPrize: { tierName: string | null; name: string; prizeType: ActivityLotteryPrizeType; virtualPrizeType: ActivityLotteryVirtualPrizeType | null; registrationFeeAmount: number | null } } => Boolean(entry.prizeId && entry.LotteryPrize)).map((entry) => ({ id: entry.id, userId: entry.userId, registrationId: entry.registrationId, prizeId: entry.prizeId, tierName: entry.LotteryPrize.tierName || '中奖奖项', prizeName: entry.LotteryPrize.name, prizeType: entry.LotteryPrize.prizeType, virtualPrizeType: entry.LotteryPrize.virtualPrizeType, registrationFeeAmount: entry.LotteryPrize.registrationFeeAmount })),
      fulfillment: { lotteryId, attempted: 0, fulfilled: 0, alreadyFulfilled: 0, failed: 0, blocked: 0 },
    }
  }
  if (lottery.status === 'CANCELLED') {
    if (options.trigger === 'ADMIN_MANUAL') throw new ActivityLotteryError('LOTTERY_CANCELLED', '抽奖已经取消，无法开奖。', 409)
    return { status: 'CANCELLED', lotteryId, activityId: lottery.activityId, eligibleCount: 0, winnerCount: 0, drawnAt: null, winners: [], fulfillment: { lotteryId, attempted: 0, fulfilled: 0, alreadyFulfilled: 0, failed: 0, blocked: 0 } }
  }
  if (!lottery.Activity || !lottery.activityId) throw new ActivityLotteryError('INVALID_LOTTERY', '该抽奖未绑定活动', 409)
  const activityId = lottery.activityId
  const activityTitle = lottery.Activity.title
  if (lottery.Activity.status === 'CANCELLED') {
    if (options.trigger === 'ADMIN_MANUAL') throw new ActivityLotteryError('LOTTERY_CANCELLED', '活动已经取消，无法开奖。', 409)
    await tx.lottery.update({ where: { id: lottery.id }, data: { status: 'CANCELLED', cancelledAt: now }, select: { id: true } })
    return { status: 'CANCELLED', lotteryId, activityId: lottery.activityId, eligibleCount: 0, winnerCount: 0, drawnAt: null, winners: [], fulfillment: { lotteryId, attempted: 0, fulfilled: 0, alreadyFulfilled: 0, failed: 0, blocked: 0 } }
  }
  if (options.trigger === 'ADMIN_MANUAL' && !options.actorId) throw new ActivityLotteryError('INVALID_LOTTERY', '管理员身份无效，无法立即开奖。', 403)
  const timingFailure = validateActivityLotteryDrawTiming({ trigger: options.trigger, now, drawAt: lottery.drawAt, activityEndAt: lottery.Activity.endsAt })
  if (timingFailure) throw new ActivityLotteryError(timingFailure.code, timingFailure.message, 409)

  const prizeSlots = lottery.LotteryPrize.reduce((total, prize) => total + Math.max(0, prize.quantity), 0)
  if (prizeSlots <= 0) throw new ActivityLotteryError('INVALID_PRIZES', '请先配置至少一个有效奖项。', 409)

  const registrations = await tx.activityRegistration.findMany({
    where: { activityId: lottery.activityId, status: 'ACTIVE', User: { status: 'ACTIVE', isDeleted: false } },
    orderBy: [{ registeredAt: 'asc' }, { id: 'asc' }],
    select: { id: true, userId: true },
  })
  if (!registrations.length) throw new ActivityLotteryError('LOTTERY_NO_ELIGIBLE_REGISTRATIONS', '当前没有有效报名用户，无法开奖。', 409)
  const shuffled = secureShuffle(registrations)
  const winnerRows: Array<{ registration: { id: string; userId: string }; prize: { id: string; tierName: string | null; name: string; prizeType: ActivityLotteryPrizeType; virtualPrizeType: ActivityLotteryVirtualPrizeType | null; registrationFeeAmount: number | null } }> = []
  let cursor = 0
  for (const prize of lottery.LotteryPrize) {
    const assigned = Math.min(prize.quantity, Math.max(0, shuffled.length - cursor))
    await tx.lotteryPrize.update({ where: { id: prize.id }, data: { remaining: prize.quantity - assigned }, select: { id: true } })
    for (let index = 0; index < assigned; index += 1) {
      const registration = shuffled[cursor]
      cursor += 1
      winnerRows.push({ registration, prize })
    }
  }
  const drawnAt = now
  const persistedWinners: ActivityLotteryDrawResult['winners'] = []
  for (const winner of winnerRows) {
    const entry = await tx.lotteryEntry.create({
      data: {
        lotteryId: lottery.id,
        prizeId: winner.prize.id,
        userId: winner.registration.userId,
        registrationId: winner.registration.id,
        redemptionStatus: 'PENDING',
        fulfillmentStatus: winner.prize.prizeType === 'VIRTUAL' ? 'PENDING' : 'NOT_REQUIRED',
        wonAt: drawnAt,
      },
      select: { id: true },
    })
    persistedWinners.push({ id: entry.id, userId: winner.registration.userId, registrationId: winner.registration.id, prizeId: winner.prize.id, tierName: winner.prize.tierName || '中奖奖项', prizeName: winner.prize.name, prizeType: winner.prize.prizeType, virtualPrizeType: winner.prize.virtualPrizeType, registrationFeeAmount: winner.prize.registrationFeeAmount })
  }
  const winnerByRegistrationId = new Map(persistedWinners.filter((winner) => winner.registrationId).map((winner) => [winner.registrationId!, winner]))
  const winnerRegistrationIds = new Set(winnerByRegistrationId.keys())
  const resultRecipients = splitActivityLotteryResultRecipients(registrations, winnerRegistrationIds)
  const resultNotifications = [...resultRecipients.winners, ...resultRecipients.nonWinners].map((registration) => activityLotteryResultNotificationData({
    lotteryId: lottery.id,
    activityId,
    activityTitle,
    lotteryTitle: lottery.title,
    userId: registration.userId,
    winner: winnerByRegistrationId.get(registration.id) || null,
  })).filter((notification): notification is Prisma.NotificationCreateManyInput => Boolean(notification))
  // Notifications are secondary side effects. Keep the candidate snapshot
  // from this draw, make the write idempotent, and never roll back a completed
  // lottery when notification persistence is temporarily unavailable.
  await safeNotificationWrite(
    () => createManyNotificationsWithDb(tx, { data: resultNotifications, skipDuplicates: true }, { operation: 'activity-lottery-result-notifications' }),
    { operation: 'activity-lottery-result-notifications', targetId: lottery.id, notificationType: 'ACTIVITY' },
  )
  await tx.lottery.update({ where: { id: lottery.id }, data: { status: 'DRAWN', eligibleCount: registrations.length, winnerCount: winnerRows.length, drawnAt, algorithmVersion: ACTIVITY_LOTTERY_ALGORITHM_VERSION }, select: { id: true } })
  if (options.actorId) {
    await createAdminActionAudit(tx, {
      operatorId: options.actorId,
      action: 'UPDATE_SETTING',
      operationType: options.trigger === 'ADMIN_MANUAL' ? adminAuditOperations.ACTIVITY_LOTTERY_MANUAL_DRAW : adminAuditOperations.ACTIVITY_LOTTERY_DRAW,
      targetType: 'ACTIVITY_LOTTERY',
      targetId: lottery.id,
      targetTitle: lottery.title,
      metadata: { activityId: lottery.activityId, trigger: options.trigger, eligibleCount: registrations.length, winnerCount: winnerRows.length, algorithmVersion: ACTIVITY_LOTTERY_ALGORITHM_VERSION, drawnAt: drawnAt.toISOString() } as Prisma.InputJsonValue,
    })
  }
  return {
    status: 'DRAWN',
    lotteryId: lottery.id,
    activityId: lottery.activityId,
    eligibleCount: registrations.length,
    winnerCount: winnerRows.length,
    drawnAt: drawnAt.toISOString(),
    winners: persistedWinners,
    fulfillment: { lotteryId: lottery.id, attempted: 0, fulfilled: 0, alreadyFulfilled: 0, failed: 0, blocked: 0 },
  }
}

export async function drawActivityLottery(lotteryId: string, options: DrawOptions = { trigger: 'SCHEDULED' }) {
  const result = await prisma.$transaction((tx) => drawActivityLotteryInTransaction(tx, lotteryId, options), { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted, timeout: 30_000, maxWait: 5_000 })
  if (result.status !== 'DRAWN' && result.status !== 'ALREADY_DRAWN') return result
  const fulfillment = await fulfillActivityLotteryWinners(result.lotteryId, { actorId: options.actorId })
  return { ...result, fulfillment }
}

export async function drawDueActivityLotteries(options: { activityId?: string; batchSize?: number; now?: Date } = {}) {
  const now = options.now || new Date()
  const batchSize = Math.min(Math.max(options.batchSize || 50, 1), 200)
  const due = await prisma.lottery.findMany({
    where: { ...(options.activityId ? { activityId: options.activityId } : {}), status: 'SCHEDULED', drawAt: { lte: now }, Activity: { status: { not: 'CANCELLED' }, endsAt: { gt: now } } },
    orderBy: [{ drawAt: 'asc' }, { id: 'asc' }],
    take: batchSize,
    select: { id: true },
  })
  let drawn = 0
  let alreadyDrawn = 0
  let failed = 0
  for (const lottery of due) {
    try {
      const result = await drawActivityLottery(lottery.id, { trigger: 'SCHEDULED', now })
      if (result.status === 'DRAWN') drawn += 1
      if (result.status === 'ALREADY_DRAWN') alreadyDrawn += 1
    } catch (error) {
      failed += 1
      console.error('[activity-lottery.draw]', { lotteryId: lottery.id, error: error instanceof Error ? error.message : String(error) })
    }
  }
  return { scanned: due.length, drawn, alreadyDrawn, failed }
}
