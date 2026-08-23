import { NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import { getCurrentUser } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { rejectInvalidRequestOrigin, sanitizeText } from '@/lib/security'
import {
  assertUserMakeupAvailable,
  CheckInMakeupError,
  createMakeupCheckIn,
  parseChallengeOptions,
} from '@/lib/checkin-makeup'

type Context = { params: Promise<{ challengeId: string }> }

export async function POST(request: Request, { params }: Context) {
  if (rejectInvalidRequestOrigin(request)) return NextResponse.json({ message: '请求来源校验失败' }, { status: 403 })
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ message: '请先登录后再提交答案' }, { status: 401 })
  const { challengeId } = await params
  const body = await request.json().catch(() => null) as { selectedOptionId?: unknown } | null
  const selectedOptionId = sanitizeText(body?.selectedOptionId, 100)
  const now = new Date()
  try {
    const result = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT \`id\` FROM \`MakeupChallenge\` WHERE \`id\` = ${challengeId} FOR UPDATE`
      const challenge = await tx.makeupChallenge.findFirst({ where: { id: challengeId, userId: user.id } })
      if (!challenge) throw new CheckInMakeupError('挑战不存在', 404, 'CHALLENGE_NOT_FOUND')
      const options = parseChallengeOptions(challenge.options)
      const correctAnswer = options.find((option) => option.id === challenge.correctOptionId)?.label || ''
      if (challenge.status !== 'PENDING') {
        const checkIn = await tx.checkIn.findUnique({ where: { challengeId: challenge.id }, select: { id: true } })
        return { status: challenge.status, correctAnswer, targetDate: challenge.targetDateKey, madeUp: Boolean(checkIn), duplicate: true }
      }
      if (!options.some((option) => option.id === selectedOptionId)) {
        throw new CheckInMakeupError('请选择有效答案', 400, 'INVALID_OPTION')
      }
      const correct = selectedOptionId === challenge.correctOptionId
      await tx.makeupChallenge.update({
        where: { id: challenge.id },
        data: { status: correct ? 'CORRECT' : 'WRONG', selectedOptionId, answeredAt: now },
      })
      if (!correct) return { status: 'WRONG', correctAnswer, targetDate: challenge.targetDateKey, madeUp: false, duplicate: false }

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
        })
        return {
          status: 'CORRECT',
          correctAnswer,
          targetDate: challenge.targetDateKey,
          madeUp: true,
          duplicate: false,
          consecutiveDays: madeUp.streak.currentStreak,
          longTermRewardTriggered: madeUp.streak.rewardTriggered,
        }
      } catch (error) {
        if (error instanceof CheckInMakeupError) {
          return { status: 'CORRECT', correctAnswer, targetDate: challenge.targetDateKey, madeUp: false, duplicate: false, settlementError: error.message, settlementCode: error.code }
        }
        throw error
      }
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })
    return NextResponse.json(result)
  } catch (error) {
    if (error instanceof CheckInMakeupError) return NextResponse.json({ message: error.message, code: error.code }, { status: error.status })
    console.error('[checkin.makeup.challenge.answer]', error)
    return NextResponse.json({ message: '答案提交失败，请稍后重试' }, { status: 500 })
  }
}
