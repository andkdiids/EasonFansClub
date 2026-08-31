import { randomInt } from 'node:crypto'
import { Prisma } from '@prisma/client'
import { parseActivityDateInput } from '@/lib/activity'
import { adminAuditOperations, createAdminActionAudit } from '@/lib/admin-audit'
import { createNotificationWithDb } from '@/lib/notification-write'
import { publicImageUrl } from '@/lib/images'
import { prisma } from '@/lib/prisma'
import { sanitizeText } from '@/lib/security'

export const ACTIVITY_LOTTERY_ALGORITHM_VERSION = 'SECURE_SHUFFLE_V1'
export const MAX_ACTIVITY_LOTTERY_PRIZES = 50
export const MAX_ACTIVITY_LOTTERY_PRIZE_QUANTITY = 100_000

export type ActivityLotteryErrorCode =
  | 'ACTIVITY_NOT_FOUND'
  | 'LOTTERY_NOT_FOUND'
  | 'REGISTRATION_END_REQUIRED'
  | 'INVALID_DRAW_AT'
  | 'DRAW_BEFORE_REGISTRATION_END'
  | 'LOTTERY_NOT_DUE'
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
}

export type NormalizedActivityLotteryInput = {
  title: string
  description: string | null
  drawAt: Date
  prizes: LotteryPrizeInput[]
}

export function validateLotterySchedule(registrationEndAt: Date | null | undefined, drawAt: Date | null | undefined) {
  if (!registrationEndAt) return '请先设置活动报名结束时间，再创建抽奖。'
  if (!drawAt || Number.isNaN(drawAt.getTime())) return '请设置有效的开奖时间。'
  if (drawAt.getTime() < registrationEndAt.getTime()) return '开奖时间不能早于活动报名结束时间。'
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
    const tierName = sanitizeText(item.tierName ?? item.tier ?? item.name, 160)
    const name = sanitizeText(item.name ?? item.prizeName, 300)
    const quantity = typeof item.quantity === 'number' ? Math.trunc(item.quantity) : Number.parseInt(String(item.quantity ?? ''), 10)
    if (!tierName) return { valid: false, message: `第 ${index + 1} 个奖项请填写奖项名称。` }
    if (!name) return { valid: false, message: `第 ${index + 1} 个奖项请填写奖品名称。` }
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > MAX_ACTIVITY_LOTTERY_PRIZE_QUANTITY) return { valid: false, message: `第 ${index + 1} 个奖项数量必须在 1-${MAX_ACTIVITY_LOTTERY_PRIZE_QUANTITY} 之间。` }
    prizes.push({
      tierName,
      name,
      imageUrl: parseString(item.imageUrl, 2000),
      description: parseString(item.description, 2000),
      quantity,
    })
  }
  return { valid: true, value: { title, description: parseString(input.description, 2000), drawAt, prizes } }
}

function iso(value: Date | null | undefined) {
  return value ? value.toISOString() : null
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
  LotteryPrize: {
    orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
    select: {
      id: true,
      tierName: true,
      name: true,
      imageUrl: true,
      description: true,
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
      redemptionStatus: true,
      wonAt: true,
      redeemedAt: true,
      LotteryPrize: { select: { id: true, tierName: true, name: true } },
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
    redemptionStatus: 'PENDING' | 'REDEEMED'
    wonAt: string
    redeemedAt: string | null
  }>
}

export type ActivityLotteryAdminListView = {
  activity: {
    id: string
    title: string
    status: string
    registrationEndAt: string | null
    signupLimit: number | null
    activeParticipantCount: number
  }
  lotteries: ActivityLotteryAdminView[]
}

function serializeAdminLottery(row: AdminLotteryRow): ActivityLotteryAdminView {
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
      imageUrl: publicImageUrl(prize.imageUrl),
      description: prize.description,
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
      redemptionStatus: entry.redemptionStatus,
      wonAt: entry.wonAt.toISOString(),
      redeemedAt: iso(entry.redeemedAt),
    })),
  }
}

export async function getAdminActivityLotteries(activityId: string): Promise<ActivityLotteryAdminListView | null> {
  const [activity, lotteries, activeParticipantCount] = await Promise.all([
    prisma.activity.findUnique({ where: { id: activityId }, select: { id: true, title: true, status: true, registrationEndAt: true, signupLimit: true } }),
    prisma.lottery.findMany({ where: { activityId }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], select: adminLotterySelect }),
    prisma.activityRegistration.count({ where: { activityId, status: 'ACTIVE', User: { status: 'ACTIVE', isDeleted: false } } }),
  ])
  if (!activity) return null
  return {
    activity: {
      id: activity.id,
      title: activity.title,
      status: activity.status,
      registrationEndAt: iso(activity.registrationEndAt),
      signupLimit: activity.signupLimit,
      activeParticipantCount,
    },
    lotteries: lotteries.map(serializeAdminLottery),
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
  prizes: Array<{ id: string; tierName: string | null; name: string; imageUrl: string | null; description: string | null; quantity: number }>
  winner: { tierName: string; prizeName: string; redemptionStatus: 'PENDING' | 'REDEEMED'; redeemedAt: string | null } | null
}

export async function getPublicActivityLotteries(activityId: string, viewerId?: string | null): Promise<ActivityLotteryPublicView[]> {
  const lotteries = await prisma.lottery.findMany({
    where: { activityId, status: { in: ['SCHEDULED', 'DRAWN'] } },
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
      LotteryPrize: {
        orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
        select: { id: true, tierName: true, name: true, imageUrl: true, description: true, quantity: true },
      },
    },
  })
  const winnerRows = viewerId && lotteries.length
    ? await prisma.lotteryEntry.findMany({
        where: { userId: viewerId, lotteryId: { in: lotteries.map((lottery) => lottery.id) } },
        select: { lotteryId: true, redemptionStatus: true, redeemedAt: true, LotteryPrize: { select: { tierName: true, name: true } } },
      })
    : []
  const winners = new Map(winnerRows.map((winner) => [winner.lotteryId, winner]))
  return lotteries.filter((lottery): lottery is typeof lottery & { status: 'SCHEDULED' | 'DRAWN' } => lottery.status === 'SCHEDULED' || lottery.status === 'DRAWN').map((lottery) => {
    const winner = winners.get(lottery.id)
    return {
      id: lottery.id,
      title: lottery.title,
      description: lottery.description,
      drawAt: iso(lottery.drawAt),
      status: lottery.status,
      eligibleCount: lottery.eligibleCount,
      winnerCount: lottery.winnerCount,
      drawnAt: iso(lottery.drawnAt),
      prizes: lottery.LotteryPrize.map((prize) => ({ ...prize, imageUrl: publicImageUrl(prize.imageUrl) })),
      winner: winner && winner.LotteryPrize
        ? { tierName: winner.LotteryPrize.tierName || '中奖奖项', prizeName: winner.LotteryPrize.name, redemptionStatus: winner.redemptionStatus, redeemedAt: iso(winner.redeemedAt) }
        : null,
    }
  })
}

async function lockActivity(tx: Prisma.TransactionClient, activityId: string) {
  const locked = await tx.$queryRaw<Array<{ id: string }>>`SELECT \`id\` FROM \`Activity\` WHERE \`id\` = ${activityId} FOR UPDATE`
  if (!locked.length) throw new ActivityLotteryError('ACTIVITY_NOT_FOUND', '活动不存在', 404)
  const activity = await tx.activity.findUnique({ where: { id: activityId }, select: { id: true, title: true, status: true, registrationEndAt: true, signupLimit: true } })
  if (!activity) throw new ActivityLotteryError('ACTIVITY_NOT_FOUND', '活动不存在', 404)
  return activity
}

function prizeCreateData(prizes: LotteryPrizeInput[]) {
  return prizes.map((prize, sortOrder) => ({
    name: prize.name,
    tierName: prize.tierName,
    imageUrl: prize.imageUrl,
    description: prize.description,
    type: 'PHYSICAL' as const,
    quantity: prize.quantity,
    remaining: prize.quantity,
    sortOrder,
  }))
}

export async function createActivityLottery(activityId: string, adminId: string, input: unknown) {
  const normalized = normalizeActivityLotteryInput(input)
  if (!normalized.valid) throw new ActivityLotteryError('INVALID_LOTTERY', normalized.message, 400)
  const result = await prisma.$transaction(async (tx) => {
    const activity = await lockActivity(tx, activityId)
    if (activity.status === 'CANCELLED') throw new ActivityLotteryError('LOTTERY_CANCELLED', '已取消的活动不能创建抽奖')
    const scheduleError = validateLotterySchedule(activity.registrationEndAt, normalized.value.drawAt)
    if (scheduleError) throw new ActivityLotteryError(scheduleError.includes('报名结束') ? 'REGISTRATION_END_REQUIRED' : 'DRAW_BEFORE_REGISTRATION_END', scheduleError, 400)
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
    const scheduleError = validateLotterySchedule(activity.registrationEndAt, normalized.value.drawAt)
    if (scheduleError) throw new ActivityLotteryError(scheduleError.includes('报名结束') ? 'REGISTRATION_END_REQUIRED' : 'DRAW_BEFORE_REGISTRATION_END', scheduleError, 400)
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
  return tx.lottery.updateMany({ where: { activityId, status: { in: ['DRAFT', 'SCHEDULED'] } }, data: { status: 'CANCELLED', cancelledAt: now } })
}

export type DrawOptions = { now?: Date; actorId?: string; expectedActivityId?: string }

export type ActivityLotteryDrawResult = {
  status: 'DRAWN' | 'ALREADY_DRAWN' | 'CANCELLED'
  lotteryId: string
  activityId: string | null
  eligibleCount: number
  winnerCount: number
  drawnAt: string | null
  winners: Array<{ id: string; userId: string; registrationId: string | null; prizeId: string; tierName: string; prizeName: string }>
}

export async function drawActivityLotteryInTransaction(tx: Prisma.TransactionClient, lotteryId: string, options: DrawOptions = {}): Promise<ActivityLotteryDrawResult> {
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
      Activity: { select: { id: true, title: true, status: true, registrationEndAt: true } },
      LotteryPrize: { orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }], select: { id: true, tierName: true, name: true, quantity: true } },
    },
  })
  if (!lottery) throw new ActivityLotteryError('LOTTERY_NOT_FOUND', '抽奖不存在', 404)
  if (options.expectedActivityId && lottery.activityId !== options.expectedActivityId) throw new ActivityLotteryError('INVALID_LOTTERY', '抽奖不属于当前活动', 403)
  if (lottery.status === 'DRAWN') {
    const entries = await tx.lotteryEntry.findMany({ where: { lotteryId }, orderBy: [{ wonAt: 'asc' }, { id: 'asc' }], select: { id: true, userId: true, registrationId: true, prizeId: true, LotteryPrize: { select: { tierName: true, name: true } } } })
    return {
      status: 'ALREADY_DRAWN',
      lotteryId,
      activityId: lottery.activityId,
      eligibleCount: lottery.eligibleCount || 0,
      winnerCount: lottery.winnerCount || entries.length,
      drawnAt: iso(lottery.drawnAt),
      winners: entries.filter((entry): entry is typeof entry & { prizeId: string; LotteryPrize: { tierName: string | null; name: string } } => Boolean(entry.prizeId && entry.LotteryPrize)).map((entry) => ({ id: entry.id, userId: entry.userId, registrationId: entry.registrationId, prizeId: entry.prizeId, tierName: entry.LotteryPrize.tierName || '中奖奖项', prizeName: entry.LotteryPrize.name })),
    }
  }
  if (lottery.status === 'CANCELLED') return { status: 'CANCELLED', lotteryId, activityId: lottery.activityId, eligibleCount: 0, winnerCount: 0, drawnAt: null, winners: [] }
  if (!lottery.Activity || !lottery.activityId) throw new ActivityLotteryError('INVALID_LOTTERY', '该抽奖未绑定活动', 409)
  if (lottery.Activity.status === 'CANCELLED') {
    await tx.lottery.update({ where: { id: lottery.id }, data: { status: 'CANCELLED', cancelledAt: now }, select: { id: true } })
    return { status: 'CANCELLED', lotteryId, activityId: lottery.activityId, eligibleCount: 0, winnerCount: 0, drawnAt: null, winners: [] }
  }
  if (!lottery.drawAt || now.getTime() < lottery.drawAt.getTime()) throw new ActivityLotteryError('LOTTERY_NOT_DUE', '开奖时间尚未到达', 409)
  const scheduleError = validateLotterySchedule(lottery.Activity.registrationEndAt, lottery.drawAt)
  if (scheduleError) throw new ActivityLotteryError(scheduleError.includes('报名结束') ? 'REGISTRATION_END_REQUIRED' : 'DRAW_BEFORE_REGISTRATION_END', scheduleError, 409)

  const registrations = await tx.activityRegistration.findMany({
    where: { activityId: lottery.activityId, status: 'ACTIVE', User: { status: 'ACTIVE', isDeleted: false } },
    orderBy: [{ registeredAt: 'asc' }, { id: 'asc' }],
    select: { id: true, userId: true },
  })
  const shuffled = secureShuffle(registrations)
  const winnerRows: Array<{ registration: { id: string; userId: string }; prize: { id: string; tierName: string | null; name: string } }> = []
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
        wonAt: drawnAt,
      },
      select: { id: true },
    })
    persistedWinners.push({ id: entry.id, userId: winner.registration.userId, registrationId: winner.registration.id, prizeId: winner.prize.id, tierName: winner.prize.tierName || '中奖奖项', prizeName: winner.prize.name })
    const notificationKey = `activity-lottery-winner:${lottery.id}:${winner.registration.userId}`
    await createNotificationWithDb(tx, {
      data: {
        recipientId: winner.registration.userId,
        actorId: null,
        type: 'ACTIVITY',
        title: '恭喜你中奖了！',
        content: `你在「${lottery.title}」中获得：${winner.prize.tierName || '中奖奖项'} · ${winner.prize.name}。请使用该活动现有核销码领取。`,
        link: `/activities/${lottery.activityId}`,
        key: notificationKey,
      },
    }, { operation: 'activity-lottery-winner', userId: winner.registration.userId })
  }
  await tx.lottery.update({ where: { id: lottery.id }, data: { status: 'DRAWN', eligibleCount: registrations.length, winnerCount: winnerRows.length, drawnAt, algorithmVersion: ACTIVITY_LOTTERY_ALGORITHM_VERSION }, select: { id: true } })
  if (options.actorId) {
    await createAdminActionAudit(tx, {
      operatorId: options.actorId,
      action: 'UPDATE_SETTING',
      operationType: adminAuditOperations.ACTIVITY_LOTTERY_DRAW,
      targetType: 'ACTIVITY_LOTTERY',
      targetId: lottery.id,
      targetTitle: lottery.title,
      metadata: { activityId: lottery.activityId, eligibleCount: registrations.length, winnerCount: winnerRows.length, algorithmVersion: ACTIVITY_LOTTERY_ALGORITHM_VERSION, drawnAt: drawnAt.toISOString() } as Prisma.InputJsonValue,
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
  }
}

export async function drawActivityLottery(lotteryId: string, options: DrawOptions = {}) {
  return prisma.$transaction((tx) => drawActivityLotteryInTransaction(tx, lotteryId, options), { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted, timeout: 30_000, maxWait: 5_000 })
}

export async function drawDueActivityLotteries(options: { activityId?: string; batchSize?: number; now?: Date } = {}) {
  const now = options.now || new Date()
  const batchSize = Math.min(Math.max(options.batchSize || 50, 1), 200)
  const due = await prisma.lottery.findMany({
    where: { ...(options.activityId ? { activityId: options.activityId } : {}), status: 'SCHEDULED', drawAt: { lte: now }, Activity: { status: { not: 'CANCELLED' } } },
    orderBy: [{ drawAt: 'asc' }, { id: 'asc' }],
    take: batchSize,
    select: { id: true },
  })
  let drawn = 0
  let alreadyDrawn = 0
  let failed = 0
  for (const lottery of due) {
    try {
      const result = await drawActivityLottery(lottery.id, { now })
      if (result.status === 'DRAWN') drawn += 1
      if (result.status === 'ALREADY_DRAWN') alreadyDrawn += 1
    } catch (error) {
      failed += 1
      console.error('[activity-lottery.draw]', { lotteryId: lottery.id, error: error instanceof Error ? error.message : String(error) })
    }
  }
  return { scanned: due.length, drawn, alreadyDrawn, failed }
}
