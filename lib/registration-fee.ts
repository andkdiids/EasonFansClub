import type { PointActionType, Prisma } from '@prisma/client'
import { formatBeijingDateTimeMinute } from '@/lib/beijing-time'
import { getShanghaiDayRange } from '@/lib/checkin'
import { prisma } from '@/lib/prisma'
import { REGISTRATION_FEE_HISTORY_PAGE_SIZE } from '@/lib/registration-fee-constants'

export { REGISTRATION_FEE_HISTORY_PAGE_SIZE }

export const LONG_TERM_PATIENT_STREAK_DAYS = 7
export const LONG_TERM_PATIENT_DAILY_BONUS = 7
export const HUNDRED_DAY_RECORD_REWARD = 100

// Legacy labels stay readable for historical PointLog rows. In particular,
// POST_LIKE_RECEIVED is no longer written by any current like route.
export const REGISTRATION_FEE_SOURCE_LABELS: Partial<Record<PointActionType, string>> = {
  POST_CREATE: '发帖奖励',
  REPLY_CREATE: '回复奖励',
  DAILY_CHECK_IN: '每日挂号',
  CONTINUOUS_CHECK_IN_BONUS: '连续挂号奖励',
  POST_LIKE_RECEIVED: '点赞奖励',
  ADMIN_ADJUST: '管理员发放',
  USER_REWARD: '获得奖励',
  FEATURED_POST: '精选奖励',
  ACTIVITY_REWARD: '成就奖励',
  GUESS_SONG_DUEL_WIN: '听听·对决获胜',
  BADGE_EXCHANGE: '兑换奖励',
  ENTERTAINMENT_DAILY_DRAW: '每日处方',
  POST_DAILY_FIRST: '发帖奖励',
  POST_COMMENT_DAILY: '回复奖励',
  CHECK_IN_MAKEUP: '补挂号',
}

const COMMUNITY_REGISTRATION_FEE_SOURCE_LABELS: Partial<Record<PointActionType, string>> = {
  POST_COMMENT_RECEIVED: '帖子收到评论',
  COMMENT_POST: '评论他人帖子',
  COMMENT_REVOKE: '评论奖励追回',
}

export function getRegistrationFeeSourceLabel(action: PointActionType) {
  return REGISTRATION_FEE_SOURCE_LABELS[action] || COMMUNITY_REGISTRATION_FEE_SOURCE_LABELS[action] || '其他'
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

type RegistrationFeeReversalInput = {
  userId: string
  amount: number
  reason: string
  businessKey: string
  now?: Date
  postId?: string
  replyId?: string
}

/** Write a negative ledger entry for a previously awarded reward. */
export async function reverseRegistrationFee(
  tx: Prisma.TransactionClient,
  input: RegistrationFeeReversalInput,
) {
  if (!Number.isSafeInteger(input.amount) || input.amount <= 0) {
    throw new RangeError('REGISTRATION_FEE_REVERSAL_AMOUNT_MUST_BE_POSITIVE_INTEGER')
  }

  const now = input.now || new Date()
  const { dateKey } = getShanghaiDayRange(now)
  await tx.$queryRaw`SELECT \`id\` FROM \`User\` WHERE \`id\` = ${input.userId} FOR UPDATE`

  const user = await tx.user.findUniqueOrThrow({ where: { id: input.userId }, select: { points: true } })
  const existing = await tx.pointLog.findUnique({ where: { businessKey: input.businessKey }, select: { id: true } })
  if (existing) {
    return { reversedAmount: 0, totalPoints: user.points, duplicate: true, dateKey }
  }

  const updatedUser = await tx.user.update({
    where: { id: input.userId },
    data: { points: { decrement: input.amount } },
    select: { points: true },
  })
  await tx.pointLog.create({
    data: {
      userId: input.userId,
      action: 'COMMENT_REVOKE',
      points: -input.amount,
      before: user.points,
      after: updatedUser.points,
      reason: input.reason,
      businessKey: input.businessKey,
      dateKey,
      postId: input.postId,
      replyId: input.replyId,
      createdAt: now,
    },
  })

  return {
    reversedAmount: input.amount,
    totalPoints: updatedUser.points,
    duplicate: false,
    dateKey,
  }
}

type RegistrationFeeConsumptionInput = {
  userId: string
  amount: number
  action: PointActionType
  reason: string
  businessKey: string
  now?: Date
  checkInId?: string
}

/** Atomically consumes registration fees without ever allowing a negative balance. */
export async function consumeRegistrationFee(
  tx: Prisma.TransactionClient,
  input: RegistrationFeeConsumptionInput,
) {
  if (!Number.isSafeInteger(input.amount) || input.amount <= 0) {
    throw new RangeError('REGISTRATION_FEE_CONSUMPTION_MUST_BE_POSITIVE_INTEGER')
  }
  const now = input.now || new Date()
  const { dateKey } = getShanghaiDayRange(now)
  await tx.$queryRaw`SELECT \`id\` FROM \`User\` WHERE \`id\` = ${input.userId} FOR UPDATE`
  const user = await tx.user.findUniqueOrThrow({ where: { id: input.userId }, select: { points: true } })
  const existing = await tx.pointLog.findUnique({ where: { businessKey: input.businessKey }, select: { id: true } })
  if (existing) return { consumedAmount: 0, totalPoints: user.points, duplicate: true, dateKey }
  if (user.points < input.amount) throw new RangeError('REGISTRATION_FEE_INSUFFICIENT')
  const changed = await tx.user.updateMany({
    where: { id: input.userId, points: { gte: input.amount } },
    data: { points: { decrement: input.amount } },
  })
  if (changed.count !== 1) throw new RangeError('REGISTRATION_FEE_INSUFFICIENT')
  const after = user.points - input.amount
  await tx.pointLog.create({
    data: {
      userId: input.userId,
      action: input.action,
      points: -input.amount,
      before: user.points,
      after,
      reason: input.reason,
      businessKey: input.businessKey,
      checkInId: input.checkInId,
      dateKey,
      createdAt: now,
    },
  })
  return { consumedAmount: input.amount, totalPoints: after, duplicate: false, dateKey }
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

export async function getRegistrationFeeHistory(userId: string, options: { page?: number; pageSize?: number } = {}) {
  const pageSize = Math.min(Math.max(Math.trunc(options.pageSize || REGISTRATION_FEE_HISTORY_PAGE_SIZE) || REGISTRATION_FEE_HISTORY_PAGE_SIZE, 1), 50)
  const requestedPage = Math.max(1, Math.trunc(options.page || 1) || 1)
  // Keep the full non-zero ledger here so reversals and manual balance
  // corrections retain their correct negative sign in the history page.
  const where = { userId, points: { not: 0 } }
  const [user, total] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId }, select: { points: true } }),
    prisma.pointLog.count({ where }),
  ])
  if (!user) throw new Error('USER_NOT_FOUND')

  const totalPages = Math.max(1, Math.ceil(total / pageSize))
  const page = Math.min(requestedPage, totalPages)
  const records = await prisma.pointLog.findMany({
    where,
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    skip: (page - 1) * pageSize,
    take: pageSize,
    select: registrationFeeRecordSelect,
  })

  return {
    currentBalance: user.points,
    records: records.map(serializeRegistrationFeeRecord),
    page,
    pageSize,
    total,
    totalPages,
  }
}
