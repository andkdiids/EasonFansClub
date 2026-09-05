import { NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import { getCurrentUser, isAuthServiceUnavailableError } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { rejectInvalidRequestOrigin, sanitizeText } from '@/lib/security'
import {
  assertUserMakeupAvailable,
  CheckInMakeupError,
  createMakeupCheckIn,
  parseChallengeOptions,
  settleMakeupLongTermRewards,
} from '@/lib/checkin-makeup'
import { createUUID } from '@/lib/utils/uuid'
import { triggerBadgeEvaluation } from '@/lib/badge-rule-engine'

const MAKEUP_TRANSACTION_OPTIONS = {
  isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
  maxWait: 10_000,
  timeout: 15_000,
} as const

type Context = { params: Promise<{ challengeId: string }> }

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

export async function POST(request: Request, { params }: Context) {
  const requestId = createUUID()
  const startedAt = Date.now()
  let userId: string | null = null
  let targetDateKey = ''
  const { challengeId } = await params
  const body = await request.json().catch(() => null) as { selectedOptionId?: unknown } | null
  const selectedOptionId = sanitizeText(body?.selectedOptionId, 100)
  const log = (event: 'start' | 'success' | 'error', details: Record<string, unknown> = {}) => {
    console.info(`checkin.makeup.${event}`, {
      userId,
      targetDate: targetDateKey || null,
      makeupType: 'MAKEUP_FREE_QUIZ',
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
      return response({ message: '请先登录后再提交答案', code: 'UNAUTHENTICATED' }, 401, requestId)
    }
    userId = user.id
    const now = new Date()
    const result = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT \`id\` FROM \`MakeupChallenge\` WHERE \`id\` = ${challengeId} FOR UPDATE`
      const challenge = await tx.makeupChallenge.findFirst({ where: { id: challengeId, userId: user.id } })
      if (!challenge) throw new CheckInMakeupError('挑战不存在', 404, 'CHALLENGE_NOT_FOUND')
      targetDateKey = challenge.targetDateKey
      const options = parseChallengeOptions(challenge.options)
      const correctAnswer = options.find((option) => option.id === challenge.correctOptionId)?.label || ''
      if (challenge.status !== 'PENDING') {
        const checkIn = await tx.checkIn.findUnique({ where: { challengeId: challenge.id }, select: { id: true, checkinDateKey: true, streakDay: true } })
        const rewardCandidates = checkIn && checkIn.streakDay >= 7 ? [{ id: checkIn.id, checkinDateKey: checkIn.checkinDateKey, nextStreakDay: checkIn.streakDay }] : []
        return { status: challenge.status, correctAnswer, targetDate: challenge.targetDateKey, madeUp: Boolean(checkIn), duplicate: true, rewardCandidates }
      }
      if (!options.some((option) => option.id === selectedOptionId)) {
        throw new CheckInMakeupError('请选择有效答案', 400, 'INVALID_OPTION')
      }
      const correct = selectedOptionId === challenge.correctOptionId
      await tx.makeupChallenge.update({
        where: { id: challenge.id },
        data: { status: correct ? 'CORRECT' : 'WRONG', selectedOptionId, answeredAt: now },
      })
      if (!correct) return { status: 'WRONG', correctAnswer, targetDate: challenge.targetDateKey, madeUp: false, duplicate: false, rewardCandidates: [] }

      try {
        await tx.$queryRaw`SELECT \`id\` FROM \`User\` WHERE \`id\` = ${user.id} FOR UPDATE`
        await assertUserMakeupAvailable(tx, user.id, challenge.targetDateKey, now)
        const madeUp = await createMakeupCheckIn(tx, {
          userId: user.id,
          targetDateKey: challenge.targetDateKey,
          type: 'MAKEUP_FREE_QUIZ',
          cost: 0,
          challengeId: challenge.id,
          now,
          settleRewards: false,
        })
        return {
          status: 'CORRECT',
          correctAnswer,
          targetDate: challenge.targetDateKey,
          madeUp: true,
          duplicate: false,
          consecutiveDays: madeUp.streak.currentStreak,
          longTermRewardTriggered: false,
          rewardCandidates: madeUp.streak.rewardCandidates,
        }
      } catch (error) {
        if (error instanceof CheckInMakeupError) {
          return { status: 'CORRECT', correctAnswer, targetDate: challenge.targetDateKey, madeUp: false, duplicate: false, settlementError: error.message, settlementCode: error.code, rewardCandidates: [] }
        }
        throw error
      }
    }, MAKEUP_TRANSACTION_OPTIONS)

    let rewardSettlementPending = false
    let longTermRewardTriggered = Boolean(result.longTermRewardTriggered)
    let longTermRewardAmount = 0
    let rewardCount = 0
    if (result.madeUp && result.rewardCandidates.length) {
      try {
        const rewards = await prisma.$transaction(
          (tx) => settleMakeupLongTermRewards(tx, user.id, result.rewardCandidates, now),
          MAKEUP_TRANSACTION_OPTIONS,
        )
        longTermRewardTriggered = rewards.rewardTriggered
        longTermRewardAmount = rewards.rewardAmount
        rewardCount = rewards.rewardCount
      } catch (error) {
        rewardSettlementPending = true
        log('error', {
          result: 'reward_pending',
          errorName: error instanceof Error ? error.name : 'UnknownError',
          errorCode: prismaErrorCode(error) || 'REWARD_SETTLEMENT_FAILED',
        })
      }
    }

    // 免费答题补签把连续签到恢复到阈值后，重新评估自动勋章（重新满足即自动
    // 重新授予，持续资格复核随事件评估一并执行）。以挑战记录作事件键保证幂等。
    if (userId && result.madeUp) triggerBadgeEvaluation(userId, 'CHECKIN_CREATED', `makeup:${challengeId}`)

    log('success', {
      result: rewardSettlementPending ? 'success_reward_pending' : 'success',
      created: result.madeUp,
      rewardCount,
    })
    const publicResult = Object.fromEntries(Object.entries(result).filter(([key]) => key !== 'rewardCandidates'))
    return response({
      ...publicResult,
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
    const timeout = isTransactionTimeout(error)
    log('error', {
      result: 'error',
      errorName: error instanceof Error ? error.name : 'UnknownError',
      errorCode: prismaErrorCode(error) || (timeout ? 'TRANSACTION_TIMEOUT' : 'MAKEUP_ANSWER_FAILED'),
    })
    return response({ message: timeout ? '补签服务暂时繁忙，请稍后重试。' : '答案提交失败，请稍后重试', code: timeout ? 'MAKEUP_TRANSACTION_TIMEOUT' : 'MAKEUP_ANSWER_FAILED' }, timeout ? 503 : 500, requestId)
  }
}
