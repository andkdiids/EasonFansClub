import { NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import { getCurrentUser } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { rejectInvalidRequestOrigin, sanitizeText } from '@/lib/security'
import { consumeRegistrationFee } from '@/lib/registration-fee'
import {
  assertUserMakeupAvailable,
  CHECK_IN_MAKEUP_COST,
  CheckInMakeupError,
  createMakeupCheckIn,
} from '@/lib/checkin-makeup'

export async function POST(request: Request) {
  if (rejectInvalidRequestOrigin(request)) return NextResponse.json({ message: '请求来源校验失败' }, { status: 403 })
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ message: '请先登录后再补签' }, { status: 401 })
  const body = await request.json().catch(() => null) as { targetDate?: unknown } | null
  const targetDateKey = sanitizeText(body?.targetDate, 10)
  const now = new Date()
  try {
    const result = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT \`id\` FROM \`User\` WHERE \`id\` = ${user.id} FOR UPDATE`
      const existing = await tx.checkIn.findUnique({
        where: { userId_checkinDateKey: { userId: user.id, checkinDateKey: targetDateKey } },
        select: { id: true, type: true },
      })
      if (existing?.type === 'MAKEUP_PAID') {
        const profile = await tx.user.findUniqueOrThrow({ where: { id: user.id }, select: { points: true, consecutiveDays: true } })
        return { checkInId: existing.id, balance: profile.points, consecutiveDays: profile.consecutiveDays, created: false, longTermRewardTriggered: false }
      }
      await assertUserMakeupAvailable(tx, user.id, targetDateKey, now)
      const profile = await tx.user.findUniqueOrThrow({ where: { id: user.id }, select: { points: true } })
      if (profile.points < CHECK_IN_MAKEUP_COST) {
        throw new CheckInMakeupError(`补签需要 ${CHECK_IN_MAKEUP_COST} 挂号费，当前余额 ${profile.points}。`, 409, 'INSUFFICIENT_BALANCE')
      }
      const madeUp = await createMakeupCheckIn(tx, { userId: user.id, targetDateKey, type: 'MAKEUP_PAID', cost: CHECK_IN_MAKEUP_COST, now })
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
        longTermRewardTriggered: madeUp.streak.rewardTriggered,
      }
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })
    return NextResponse.json({ ...result, targetDate: targetDateKey, cost: result.created ? CHECK_IN_MAKEUP_COST : 0 })
  } catch (error) {
    if (error instanceof CheckInMakeupError) return NextResponse.json({ message: error.message, code: error.code }, { status: error.status })
    if (error instanceof RangeError && error.message === 'REGISTRATION_FEE_INSUFFICIENT') {
      return NextResponse.json({ message: '挂号费不足', code: 'INSUFFICIENT_BALANCE' }, { status: 409 })
    }
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      const existing = await prisma.checkIn.findUnique({ where: { userId_checkinDateKey: { userId: user.id, checkinDateKey: targetDateKey } } })
      if (existing?.type === 'MAKEUP_PAID') return NextResponse.json({ checkInId: existing.id, targetDate: targetDateKey, created: false, cost: 0 })
      return NextResponse.json({ message: '该日期已经挂号', code: 'ALREADY_CHECKED_IN' }, { status: 409 })
    }
    console.error('[checkin.makeup.paid]', error)
    return NextResponse.json({ message: '补签失败，请稍后重试' }, { status: 500 })
  }
}
