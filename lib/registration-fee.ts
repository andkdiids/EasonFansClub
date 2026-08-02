import type { PointActionType, Prisma } from '@prisma/client'
import { formatBeijingDateTimeMinute } from '@/lib/beijing-time'
import { getShanghaiDayRange } from '@/lib/checkin'
import { prisma } from '@/lib/prisma'

export const LONG_TERM_PATIENT_STREAK_DAYS = 7
export const LONG_TERM_PATIENT_DAILY_BONUS = 7
export const HUNDRED_DAY_RECORD_REWARD = 100

export const REGISTRATION_FEE_SOURCE_LABELS: Partial<Record<PointActionType, string>> = {
  POST_CREATE: '发帖奖励',
  REPLY_CREATE: '回复奖励',
  DAILY_CHECK_IN: '每日挂号',
  CONTINUOUS_CHECK_IN_BONUS: '连续挂号奖励',
  POST_LIKE_RECEIVED: '点赞奖励',
  ADMIN_ADJUST: '管理员发放',
  FEATURED_POST: '精选奖励',
  ACTIVITY_REWARD: '成就奖励',
  BADGE_EXCHANGE: '兑换奖励',
  ENTERTAINMENT_DAILY_DRAW: '每日处方',
  POST_DAILY_FIRST: '发帖奖励',
  POST_COMMENT_DAILY: '回复奖励',
}

export function getRegistrationFeeSourceLabel(action: PointActionType) {
  return REGISTRATION_FEE_SOURCE_LABELS[action] || '其他'
}

type RegistrationFeeAwardInput = {
  userId: string
  requestedAmount: number
  action: PointActionType
  reason: string
  now?: Date
  businessKey?: string
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
  if (!Number.isSafeInteger(input.requestedAmount) || input.requestedAmount <= 0) {
    throw new RangeError('REGISTRATION_FEE_AMOUNT_MUST_BE_POSITIVE_INTEGER')
  }

  const requestedAmount = input.requestedAmount
  const now = input.now || new Date()
  const { dateKey } = getShanghaiDayRange(now)

  await tx.$queryRaw`SELECT \`id\` FROM \`User\` WHERE \`id\` = ${input.userId} FOR UPDATE`
  const user = await tx.user.findUniqueOrThrow({ where: { id: input.userId }, select: { points: true } })
  if (input.businessKey) {
    const existing = await tx.pointLog.findUnique({ where: { businessKey: input.businessKey }, select: { id: true } })
    if (existing) {
      return { awardedAmount: 0, totalPoints: user.points, duplicate: true, dateKey }
    }
  }

  const updatedUser = await tx.user.update({
    where: { id: input.userId },
    data: { points: { increment: requestedAmount } },
    select: { points: true },
  })
  await tx.pointLog.create({
    data: {
      userId: input.userId,
      action: input.action,
      points: requestedAmount,
      before: user.points,
      after: updatedUser.points,
      reason: input.reason,
      businessKey: input.businessKey,
      dateKey,
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
    awardedAmount: requestedAmount,
    totalPoints: updatedUser.points,
    duplicate: false,
    dateKey,
  }
}

type RegistrationFeeBalanceAdjustmentInput = {
  userId: string
  targetPoints: number
  reason: string
  now?: Date
  businessKey?: string
}

export async function adjustRegistrationFeeBalance(
  tx: Prisma.TransactionClient,
  input: RegistrationFeeBalanceAdjustmentInput,
) {
  if (!Number.isSafeInteger(input.targetPoints) || input.targetPoints < 0) {
    throw new RangeError('REGISTRATION_FEE_BALANCE_MUST_BE_NON_NEGATIVE_INTEGER')
  }

  const now = input.now || new Date()
  const { dateKey } = getShanghaiDayRange(now)
  await tx.$queryRaw`SELECT \`id\` FROM \`User\` WHERE \`id\` = ${input.userId} FOR UPDATE`
  const user = await tx.user.findUniqueOrThrow({ where: { id: input.userId }, select: { points: true } })
  const difference = input.targetPoints - user.points

  if (!difference) return { awardedAmount: 0, totalPoints: user.points, duplicate: false, dateKey }
  if (difference > 0) {
    return awardRegistrationFee(tx, {
      userId: input.userId,
      requestedAmount: difference,
      action: 'ADMIN_ADJUST',
      reason: input.reason,
      businessKey: input.businessKey,
      now,
    })
  }

  if (input.businessKey) {
    const existing = await tx.pointLog.findUnique({ where: { businessKey: input.businessKey }, select: { id: true } })
    if (existing) return { awardedAmount: 0, totalPoints: user.points, duplicate: true, dateKey }
  }

  const updatedUser = await tx.user.update({
    where: { id: input.userId },
    data: { points: { decrement: Math.abs(difference) } },
    select: { points: true },
  })
  await tx.pointLog.create({
    data: {
      userId: input.userId,
      action: 'ADMIN_ADJUST',
      points: difference,
      before: user.points,
      after: updatedUser.points,
      reason: input.reason,
      businessKey: input.businessKey,
      dateKey,
      createdAt: now,
    },
  })

  return { awardedAmount: difference, totalPoints: updatedUser.points, duplicate: false, dateKey }
}

export function sumPositiveRegistrationFees(records: ReadonlyArray<{ points: number }>) {
  return records.reduce((total, record) => total + (record.points > 0 ? record.points : 0), 0)
}

const registrationFeeRecordSelect = {
  id: true,
  points: true,
  action: true,
  reason: true,
  createdAt: true,
  postId: true,
  replyId: true,
  checkInId: true,
  activityId: true,
  badgeId: true,
  dailyDrawId: true,
} satisfies Prisma.PointLogSelect

type RegistrationFeeRecord = Prisma.PointLogGetPayload<{ select: typeof registrationFeeRecordSelect }>

function getRegistrationFeeRelatedId(record: RegistrationFeeRecord) {
  return record.dailyDrawId || record.checkInId || record.postId || record.replyId || record.activityId || record.badgeId || null
}

export function serializeRegistrationFeeRecord(record: RegistrationFeeRecord) {
  return {
    id: record.id,
    amount: record.points,
    sourceType: record.action,
    sourceLabel: getRegistrationFeeSourceLabel(record.action),
    description: record.reason,
    relatedId: getRegistrationFeeRelatedId(record),
    createdAt: record.createdAt.toISOString(),
    displayTime: formatBeijingDateTimeMinute(record.createdAt).slice(-5),
  }
}

export async function getTodayRegistrationFeeSummary(userId: string, now = new Date()) {
  const { start, end, dateKey } = getShanghaiDayRange(now)
  const [user, records] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId }, select: { points: true } }),
    prisma.pointLog.findMany({
      where: { userId, points: { gt: 0 }, createdAt: { gte: start, lt: end } },
      orderBy: { createdAt: 'desc' },
      select: registrationFeeRecordSelect,
    }),
  ])

  if (!user) throw new Error('USER_NOT_FOUND')
  return {
    currentBalance: user.points,
    todayEarned: sumPositiveRegistrationFees(records),
    dateKey,
    records: records.map(serializeRegistrationFeeRecord),
  }
}
