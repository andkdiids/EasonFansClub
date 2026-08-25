import { NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import { getCurrentUser, isAuthServiceUnavailableError } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { rejectInvalidRequestOrigin, sanitizeText } from '@/lib/security'
import { consumeRegistrationFee } from '@/lib/registration-fee'
import {
  assertUserMakeupAvailable,
  CHECK_IN_MAKEUP_COST,
  CheckInMakeupError,
  createMakeupCheckIn,
  settleMakeupLongTermRewards,
} from '@/lib/checkin-makeup'
import { createUUID } from '@/lib/utils/uuid'

const MAKEUP_TRANSACTION_OPTIONS = {
  isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
  maxWait: 10_000,
  timeout: 15_000,
} as const

function response(body: Record<string, unknown>, status: number, requestId: string) {
  return NextResponse.json({ ...body, requestId }, {
    status,
    headers: { 'Cache-Control': 'no-store', 'X-Request-Id': requestId },
  })
}

function prismaErrorCode(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError ? error.code : undefined
}

function isTransactionTimeout(error: unknown) {
  const code = prismaErrorCode(error)
  return code === 'P2028' || code === 'P2024' || code === 'P1001' || code === 'P1002'
    || (error instanceof Error && /transaction|timed out|timeout|database server/i.test(error.message))
}

export async function POST(request: Request) {
  const requestId = createUUID()
  const startedAt = Date.now()
  let userId: string | null = null
  const body = await request.json().catch(() => null) as { targetDate?: unknown } | null
  const targetDateKey = sanitizeText(body?.targetDate, 10)
  const log = (event: 'start' | 'success' | 'error', details: Record<string, unknown> = {}) => {
    console.info(`checkin.makeup.${event}`, {
      userId,
      targetDate: targetDateKey,
      makeupType: 'MAKEUP_PAID',
      requestId,
      durationMs: Date.now() - startedAt,
      ...details,
    })
  }

  log('start')
  if (rejectInvalidRequestOrigin(request)) {
    log('error', { result: 'error', errorName: 'InvalidRequestOrigin', errorCode: 'INVALID_REQUEST_ORIGIN' })
    return response({ message: '请求来源校验失败', code: 'INVALID_REQUEST_ORIGIN' }, 403, requestId)
  }

  try {
    const user = await getCurrentUser()
    if (!user) {
      log('error', { result: 'error', errorName: 'Unauthenticated', errorCode: 'UNAUTHENTICATED' })
      return response({ message: '请先登录后再补签', code: 'UNAUTHENTICATED' }, 401, requestId)
    }
    userId = user.id

    const now = new Date()
    const result = await prisma.$transaction(async (tx) => {
      // Serializing on the user row makes the unique date key an idempotency
      // backstop for double clicks and browser/network retries.
      await tx.$queryRaw`SELECT \`id\` FROM \`User\` WHERE \`id\` = ${user.id} FOR UPDATE`
      const existing = await tx.checkIn.findUnique({
        where: { userId_checkinDateKey: { userId: user.id, checkinDateKey: targetDateKey } },
        select: { id: true, type: true, checkinDateKey: true, streakDay: true },
      })
      if (existing?.type === 'MAKEUP_PAID') {
        const profile = await tx.user.findUniqueOrThrow({ where: { id: user.id }, select: { points: true, consecutiveDays: true } })
        const rewardCandidates = existing.streakDay >= 7 ? [{ id: existing.id, checkinDateKey: existing.checkinDateKey, nextStreakDay: existing.streakDay }] : []
        return { checkInId: existing.id, balance: profile.points, consecutiveDays: profile.consecutiveDays, created: false, longTermRewardTriggered: false, rewardCandidates }
      }

      await assertUserMakeupAvailable(tx, user.id, targetDateKey, now)
      const profile = await tx.user.findUniqueOrThrow({ where: { id: user.id }, select: { points: true } })
      if (profile.points < CHECK_IN_MAKEUP_COST) {
        throw new CheckInMakeupError(`补签需要 ${CHECK_IN_MAKEUP_COST} 挂号费，当前余额 ${profile.points}。`, 409, 'INSUFFICIENT_BALANCE')
      }

      // The core transaction only creates the record, consumes the fee, and
      // recalculates the canonical streak. Long-term reward ledger writes are
      // settled after this short transaction commits.
      const madeUp = await createMakeupCheckIn(tx, {
        userId: user.id,
        targetDateKey,
        type: 'MAKEUP_PAID',
        cost: CHECK_IN_MAKEUP_COST,
        now,
        settleRewards: false,
      })
      const fee = await consumeRegistrationFee(tx, {
        userId: user.id,
        amount: CHECK_IN_MAKEUP_COST,
        action: 'CHECK_IN_MAKEUP',
        reason: `补挂号 · ${targetDateKey.slice(5).replace('-', '月')}日`,
        businessKey: `check-in-makeup:${user.id}:${targetDateKey}`,
        checkInId: madeUp.checkIn.id,
        now,
      })
      return {
        checkInId: madeUp.checkIn.id,
        balance: fee.totalPoints,
        consecutiveDays: madeUp.streak.currentStreak,
        created: true,
        longTermRewardTriggered: false,
        rewardCandidates: madeUp.streak.rewardCandidates,
      }
    }, MAKEUP_TRANSACTION_OPTIONS)

    let balance = result.balance
    let longTermRewardTriggered = result.longTermRewardTriggered
    let longTermRewardAmount = 0
    let rewardCount = 0
    let rewardSettlementPending = false
    if (result.rewardCandidates.length) {
      try {
        const rewards = await prisma.$transaction(
          (tx) => settleMakeupLongTermRewards(tx, user.id, result.rewardCandidates, now),
          MAKEUP_TRANSACTION_OPTIONS,
        )
        longTermRewardTriggered = rewards.rewardTriggered
        longTermRewardAmount = rewards.rewardAmount
        rewardCount = rewards.rewardCount
        const profile = await prisma.user.findUnique({ where: { id: user.id }, select: { points: true } })
        if (profile) balance = profile.points
      } catch (error) {
        rewardSettlementPending = true
        log('error', {
          result: 'reward_pending',
          errorName: error instanceof Error ? error.name : 'UnknownError',
          errorCode: prismaErrorCode(error) || 'REWARD_SETTLEMENT_FAILED',
        })
      }
    }

    log('success', {
      result: rewardSettlementPending ? 'success_reward_pending' : 'success',
      created: result.created,
      rewardCount,
    })
    return response({
      checkInId: result.checkInId,
      targetDate: targetDateKey,
      balance,
      consecutiveDays: result.consecutiveDays,
      created: result.created,
      cost: result.created ? CHECK_IN_MAKEUP_COST : 0,
      longTermRewardTriggered,
      longTermRewardAmount,
      rewardCount,
      rewardSettlementPending,
    }, 200, requestId)
  } catch (error) {
    if (isAuthServiceUnavailableError(error)) {
      log('error', { result: 'error', errorName: error.name, errorCode: 'AUTH_SERVICE_UNAVAILABLE' })
      return response({ message: '补签服务暂时不可用，请稍后重试。', code: 'AUTH_SERVICE_UNAVAILABLE' }, 503, requestId)
    }
    if (error instanceof CheckInMakeupError) {
      log('error', { result: 'error', errorName: error.name, errorCode: error.code })
      return response({ message: error.message, code: error.code }, error.status, requestId)
    }
    if (error instanceof RangeError && error.message === 'REGISTRATION_FEE_INSUFFICIENT') {
      log('error', { result: 'error', errorName: error.name, errorCode: error.message })
      return response({ message: '挂号费不足', code: 'INSUFFICIENT_BALANCE' }, 409, requestId)
    }
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002' && userId) {
      const existing = await prisma.checkIn.findUnique({
        where: { userId_checkinDateKey: { userId, checkinDateKey: targetDateKey } },
        select: { id: true, type: true },
      })
      if (existing?.type === 'MAKEUP_PAID') {
        const profile = await prisma.user.findUnique({ where: { id: userId }, select: { points: true, consecutiveDays: true } })
        log('success', { result: 'idempotent_duplicate', created: false })
        return response({
          checkInId: existing.id,
          targetDate: targetDateKey,
          balance: profile?.points ?? 0,
          consecutiveDays: profile?.consecutiveDays ?? 0,
          created: false,
          cost: 0,
          longTermRewardTriggered: false,
          rewardCount: 0,
        }, 200, requestId)
      }
      log('error', { result: 'error', errorName: error.name, errorCode: 'ALREADY_CHECKED_IN' })
      return response({ message: '该日期已经挂号', code: 'ALREADY_CHECKED_IN' }, 409, requestId)
    }

    const timeout = isTransactionTimeout(error)
    log('error', {
      result: 'error',
      errorName: error instanceof Error ? error.name : 'UnknownError',
      errorCode: prismaErrorCode(error) || (timeout ? 'TRANSACTION_TIMEOUT' : 'MAKEUP_FAILED'),
    })
    return response({ message: timeout ? '补签服务暂时繁忙，请稍后重试。' : '补签暂时失败，请稍后重试。', code: timeout ? 'MAKEUP_TRANSACTION_TIMEOUT' : 'MAKEUP_FAILED' }, timeout ? 503 : 500, requestId)
  }
}
