import type { PointActionType, Prisma } from '@prisma/client'
import { getShanghaiDayRange } from '@/lib/checkin'

export const DAILY_REGISTRATION_FEE_LIMIT = 30
export const LONG_TERM_PATIENT_STREAK_DAYS = 7
export const LONG_TERM_PATIENT_DAILY_BONUS = 7
export const HUNDRED_DAY_RECORD_REWARD = 100
export const REGISTRATION_FEE_LIMIT_MESSAGE = '今日挂号费获取已达到上限，明日继续努力。'

const ORDINARY_REGISTRATION_FEE_ACTIONS: PointActionType[] = [
  'POST_CREATE',
  'REPLY_CREATE',
  'DAILY_CHECK_IN',
  'POST_LIKE_RECEIVED',
  'FEATURED_POST',
  'ENTERTAINMENT_DAILY_DRAW',
  'POST_DAILY_FIRST',
  'POST_COMMENT_DAILY',
]

type RegistrationFeeAwardInput = {
  userId: string
  requestedAmount: number
  action: PointActionType
  reason: string
  now?: Date
  businessKey?: string
  countsTowardDailyLimit?: boolean
  postId?: string
  replyId?: string
  checkInId?: string
  activityId?: string
  badgeId?: string
  dailyDrawId?: string
}

export async function awardRegistrationFee(
  tx: Prisma.TransactionClient,
  input: RegistrationFeeAwardInput,
) {
  const requestedAmount = Math.max(0, Math.floor(input.requestedAmount))
  const now = input.now || new Date()
  const { start, end, dateKey } = getShanghaiDayRange(now)

  await tx.$queryRaw`SELECT \`id\` FROM \`User\` WHERE \`id\` = ${input.userId} FOR UPDATE`
  const user = await tx.user.findUniqueOrThrow({ where: { id: input.userId }, select: { points: true } })
  if (input.businessKey) {
    const existing = await tx.pointLog.findUnique({ where: { businessKey: input.businessKey }, select: { id: true } })
    if (existing) {
      return { awardedAmount: 0, totalPoints: user.points, capped: false, duplicate: true, dateKey }
    }
  }

  let remaining = requestedAmount
  const countsTowardDailyLimit = input.countsTowardDailyLimit !== false
  if (countsTowardDailyLimit) {
    const awardedToday = await tx.pointLog.aggregate({
      where: {
        userId: input.userId,
        points: { gt: 0 },
        OR: [
          { dateKey },
          {
            dateKey: null,
            createdAt: { gte: start, lt: end },
            action: { in: ORDINARY_REGISTRATION_FEE_ACTIONS },
          },
        ],
      },
      _sum: { points: true },
    })
    remaining = Math.max(0, DAILY_REGISTRATION_FEE_LIMIT - (awardedToday._sum.points || 0))
  }

  const awardedAmount = countsTowardDailyLimit ? Math.min(requestedAmount, remaining) : requestedAmount
  if (!awardedAmount) {
    return {
      awardedAmount: 0,
      totalPoints: user.points,
      capped: countsTowardDailyLimit && requestedAmount > 0,
      duplicate: false,
      dateKey,
    }
  }

  const updatedUser = await tx.user.update({
    where: { id: input.userId },
    data: { points: { increment: awardedAmount } },
    select: { points: true },
  })
  await tx.pointLog.create({
    data: {
      userId: input.userId,
      action: input.action,
      points: awardedAmount,
      before: user.points,
      after: updatedUser.points,
      reason: input.reason,
      businessKey: input.businessKey,
      dateKey: countsTowardDailyLimit ? dateKey : null,
      postId: input.postId,
      replyId: input.replyId,
      checkInId: input.checkInId,
      activityId: input.activityId,
      badgeId: input.badgeId,
      dailyDrawId: input.dailyDrawId,
      createdAt: now,
    },
  })
  return {
    awardedAmount,
    totalPoints: updatedUser.points,
    capped: countsTowardDailyLimit && awardedAmount < requestedAmount,
    duplicate: false,
    dateKey,
  }
}
