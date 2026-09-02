import { Prisma } from '@prisma/client'
import { grantBadgeWithTransaction } from '@/lib/badge-service'
import { awardRegistrationFee } from '@/lib/registration-fee'
import { createManyNotificationsWithDb } from '@/lib/notification-write'
import { safeNotificationWrite } from '@/lib/notification-transaction'
import { prisma } from '@/lib/prisma'

export type ActivityLotteryFulfillmentStatusValue = 'NOT_REQUIRED' | 'PENDING' | 'FULFILLED' | 'FAILED'

export type ActivityLotteryFulfillmentResult = {
  winnerId: string
  prizeType: 'PHYSICAL' | 'VIRTUAL'
  status: 'NOT_REQUIRED' | 'FULFILLED' | 'ALREADY_FULFILLED' | 'FAILED'
  fulfilledAt: string | null
  error: string | null
}

export type ActivityLotteryFulfillmentSummary = {
  lotteryId: string
  attempted: number
  fulfilled: number
  alreadyFulfilled: number
  failed: number
  blocked: number
}

export type ActivityLotteryFulfillmentOptions = {
  now?: Date
  actorId?: string | null
  expectedActivityId?: string
  expectedLotteryId?: string
}

export class ActivityLotteryFulfillmentError extends Error {
  constructor(readonly code: 'WINNER_NOT_FOUND' | 'INVALID_WINNER_SCOPE' | 'FULFILLMENT_BLOCKED', message: string, readonly status = 404) {
    super(message)
    this.name = 'ActivityLotteryFulfillmentError'
  }
}

const FULFILLMENT_SOURCE_TYPE = 'ACTIVITY_LOTTERY_PRIZE'

export function activityLotteryPrizeBusinessKey(winnerId: string) {
  return `activity-lottery-prize:${winnerId}`
}

function errorMessage(error: unknown) {
  const message = error instanceof Error ? error.message : String(error)
  return message.trim().slice(0, 500) || '虚拟奖品自动发放失败'
}

function virtualPrizeReason(activityTitle: string | null, lotteryTitle: string, prizeName: string) {
  const activity = activityTitle ? `「${activityTitle}」` : '活动'
  return `抽奖${activity} · 「${lotteryTitle}」获得${prizeName}`.slice(0, 500)
}

async function markFulfillmentFailed(winnerId: string, message: string) {
  try {
    await prisma.lotteryEntry.updateMany({
      where: { id: winnerId, fulfillmentStatus: { not: 'FULFILLED' } },
      data: { fulfillmentStatus: 'FAILED', fulfillmentError: message },
    })
  } catch (error) {
    console.error('[activity-lottery.fulfillment.mark-failed]', { winnerId, error })
  }
}

async function fulfillInTransaction(
  tx: Prisma.TransactionClient,
  winnerId: string,
  options: ActivityLotteryFulfillmentOptions,
): Promise<ActivityLotteryFulfillmentResult> {
  // Cancellation locks Activity before it updates related lotteries. Draw and
  // lottery-cancellation paths use the same order. Keep fulfillment in that
  // order too, so a cancellation cannot commit between the status check and a
  // badge/ledger write.
  const initial = await tx.lotteryEntry.findUnique({ where: { id: winnerId }, select: { lotteryId: true } })
  if (!initial) throw new ActivityLotteryFulfillmentError('WINNER_NOT_FOUND', '中奖记录不存在', 404)
  const linkedLottery = await tx.lottery.findUnique({ where: { id: initial.lotteryId }, select: { activityId: true } })
  if (!linkedLottery) throw new ActivityLotteryFulfillmentError('WINNER_NOT_FOUND', '中奖记录所属抽奖不存在', 404)
  if (linkedLottery.activityId) {
    const activityLocked = await tx.$queryRaw<Array<{ id: string }>>`SELECT \`id\` FROM \`Activity\` WHERE \`id\` = ${linkedLottery.activityId} FOR UPDATE`
    if (!activityLocked.length) throw new ActivityLotteryFulfillmentError('WINNER_NOT_FOUND', '中奖记录所属活动不存在', 404)
  }
  const lotteryLocked = await tx.$queryRaw<Array<{ id: string }>>`SELECT \`id\` FROM \`Lottery\` WHERE \`id\` = ${initial.lotteryId} FOR UPDATE`
  if (!lotteryLocked.length) throw new ActivityLotteryFulfillmentError('WINNER_NOT_FOUND', '中奖记录所属抽奖不存在', 404)
  const winnerLocked = await tx.$queryRaw<Array<{ id: string }>>`SELECT \`id\` FROM \`LotteryEntry\` WHERE \`id\` = ${winnerId} FOR UPDATE`
  if (!winnerLocked.length) throw new ActivityLotteryFulfillmentError('WINNER_NOT_FOUND', '中奖记录不存在', 404)

  const winner = await tx.lotteryEntry.findUnique({
    where: { id: winnerId },
    select: {
      id: true,
      userId: true,
      lotteryId: true,
      registrationId: true,
      fulfillmentStatus: true,
      fulfilledAt: true,
      Lottery: { select: { id: true, title: true, activityId: true, status: true, Activity: { select: { title: true, status: true } } } },
      LotteryPrize: { select: { name: true, prizeType: true, virtualPrizeType: true, badgeId: true, registrationFeeAmount: true } },
    },
  })
  if (!winner) throw new ActivityLotteryFulfillmentError('WINNER_NOT_FOUND', '中奖记录不存在', 404)
  if (options.expectedLotteryId && winner.lotteryId !== options.expectedLotteryId) throw new ActivityLotteryFulfillmentError('INVALID_WINNER_SCOPE', '中奖记录不属于当前抽奖', 403)
  if (options.expectedActivityId && winner.Lottery.activityId !== options.expectedActivityId) throw new ActivityLotteryFulfillmentError('INVALID_WINNER_SCOPE', '中奖记录不属于当前活动', 403)

  const prizeType = winner.LotteryPrize?.prizeType || 'PHYSICAL'
  if (prizeType !== 'VIRTUAL') {
    return { winnerId, prizeType: 'PHYSICAL', status: 'NOT_REQUIRED', fulfilledAt: null, error: null }
  }
  if (winner.fulfillmentStatus === 'FULFILLED') {
    return { winnerId, prizeType: 'VIRTUAL', status: 'ALREADY_FULFILLED', fulfilledAt: winner.fulfilledAt?.toISOString() || null, error: null }
  }
  if (winner.Lottery.status === 'CANCELLED' || winner.Lottery.Activity?.status === 'CANCELLED') {
    throw new ActivityLotteryFulfillmentError('FULFILLMENT_BLOCKED', '活动或抽奖已取消，未完成的虚拟奖品不能继续发放或重试。', 409)
  }

  const prize = winner.LotteryPrize
  if (!prize || !prize.virtualPrizeType) throw new Error('虚拟奖品缺少具体发放类型')
  const now = options.now || new Date()
  const reason = virtualPrizeReason(winner.Lottery.Activity?.title || null, winner.Lottery.title, prize.name)

  await tx.lotteryEntry.update({ where: { id: winner.id }, data: { fulfillmentStatus: 'PENDING', fulfillmentError: null }, select: { id: true } })

  if (prize.virtualPrizeType === 'BADGE') {
    if (!prize.badgeId) throw new Error('虚拟勋章奖品缺少勋章配置')
    await grantBadgeWithTransaction(tx, {
      userId: winner.userId,
      badgeId: prize.badgeId,
      sourceType: FULFILLMENT_SOURCE_TYPE,
      sourceId: winner.id,
      grantReason: reason,
      actorId: options.actorId || null,
      obtainedAt: now,
      availabilityMode: 'CURRENT',
    })
  } else {
    const amount = prize.registrationFeeAmount
    if (typeof amount !== 'number' || !Number.isSafeInteger(amount) || amount <= 0) throw new Error('虚拟挂号费奖品金额无效')
    await awardRegistrationFee(tx, {
      userId: winner.userId,
      requestedAmount: amount,
      action: 'ACTIVITY_LOTTERY_PRIZE',
      reason,
      businessKey: activityLotteryPrizeBusinessKey(winner.id),
      now,
      activityId: winner.Lottery.activityId || undefined,
      activityRegistrationId: winner.registrationId || undefined,
    })
  }

  await safeNotificationWrite(
    () => createManyNotificationsWithDb(tx, {
      data: [{
        recipientId: winner.userId,
        actorId: null,
        type: 'ACTIVITY',
        title: '抽奖虚拟奖品已到账',
        content: prize.virtualPrizeType === 'BADGE'
          ? `恭喜你在「${winner.Lottery.title}」抽奖中获得「${prize.name}」，勋章已自动发放至你的账号。`
          : `恭喜你在「${winner.Lottery.title}」抽奖中获得 ${prize.registrationFeeAmount} 挂号费，奖励已自动到账。`,
        link: winner.Lottery.activityId ? `/activities/${winner.Lottery.activityId}` : '/activities',
        key: `activity-lottery-prize:${winner.id}`,
      }],
      skipDuplicates: true,
    }, { operation: 'activity-lottery-virtual-prize-notification', userId: winner.userId }),
    { operation: 'activity-lottery-virtual-prize-notification', userId: winner.userId, targetId: winner.id, notificationType: 'ACTIVITY' },
  )

  const updated = await tx.lotteryEntry.update({
    where: { id: winner.id },
    data: { fulfillmentStatus: 'FULFILLED', fulfilledAt: now, fulfillmentError: null },
    select: { fulfilledAt: true },
  })
  return { winnerId, prizeType: 'VIRTUAL', status: 'FULFILLED', fulfilledAt: updated.fulfilledAt?.toISOString() || now.toISOString(), error: null }
}

/** Fulfill one persisted winner. Retries always use the same winner row. */
export async function fulfillActivityLotteryPrize(winnerId: string, options: ActivityLotteryFulfillmentOptions = {}) {
  try {
    return await prisma.$transaction((tx) => fulfillInTransaction(tx, winnerId, options), { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted, timeout: 30_000, maxWait: 5_000 })
  } catch (error) {
    if (error instanceof ActivityLotteryFulfillmentError) throw error
    const message = errorMessage(error)
    await markFulfillmentFailed(winnerId, message)
    return { winnerId, prizeType: 'VIRTUAL' as const, status: 'FAILED' as const, fulfilledAt: null, error: message }
  }
}

/** Reconcile all virtual winners for a drawn lottery without redrawing it. */
export async function fulfillActivityLotteryWinners(lotteryId: string, options: ActivityLotteryFulfillmentOptions = {}): Promise<ActivityLotteryFulfillmentSummary> {
  const winners = await prisma.lotteryEntry.findMany({
    where: { lotteryId, LotteryPrize: { is: { prizeType: 'VIRTUAL' } } },
    orderBy: [{ wonAt: 'asc' }, { id: 'asc' }],
    select: { id: true },
  })
  const summary: ActivityLotteryFulfillmentSummary = { lotteryId, attempted: winners.length, fulfilled: 0, alreadyFulfilled: 0, failed: 0, blocked: 0 }
  for (const winner of winners) {
    let result: Awaited<ReturnType<typeof fulfillActivityLotteryPrize>>
    try {
      result = await fulfillActivityLotteryPrize(winner.id, options)
    } catch (error) {
      if (error instanceof ActivityLotteryFulfillmentError && error.code === 'FULFILLMENT_BLOCKED') {
        summary.blocked += 1
        continue
      }
      throw error
    }
    if (result.status === 'FULFILLED') summary.fulfilled += 1
    if (result.status === 'ALREADY_FULFILLED') summary.alreadyFulfilled += 1
    if (result.status === 'FAILED') summary.failed += 1
  }
  return summary
}
