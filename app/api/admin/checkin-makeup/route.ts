import { NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import { getShanghaiDateKey, parseBeijingDate, shiftShanghaiDateKey } from '@/lib/checkin'
import { createMakeupCheckIn, CheckInMakeupError } from '@/lib/checkin-makeup'
import { prisma } from '@/lib/prisma'
import { rejectInvalidRequestOrigin, requireAdmin, sanitizeText } from '@/lib/security'
import { getPublicUserDisplayName } from '@/lib/friend-remarks'

export async function GET(request: Request) {
  const guard = await requireAdmin('checkin_manage')
  if (!guard.user) return guard.response
  const searchParams = new URL(request.url).searchParams
  const previewUserId = sanitizeText(searchParams.get('userId'), 100)
  const previewDate = sanitizeText(searchParams.get('targetDate'), 10)
  if (previewUserId && parseBeijingDate(previewDate)) {
    const [record, nearby] = await Promise.all([
      prisma.checkIn.findUnique({ where: { userId_checkinDateKey: { userId: previewUserId, checkinDateKey: previewDate } }, select: { id: true, type: true } }),
      prisma.checkIn.findMany({
        where: { userId: previewUserId, checkinDateKey: { gte: shiftShanghaiDateKey(previewDate, -3), lte: shiftShanghaiDateKey(previewDate, 3) } },
        orderBy: { checkinDateKey: 'asc' }, select: { checkinDateKey: true, type: true, streakDay: true },
      }),
    ])
    return NextResponse.json({ status: record ? 'CHECKED_IN' : 'MISSING', record, nearby })
  }
  const query = sanitizeText(searchParams.get('q'), 60)
  if (!query) return NextResponse.json({ users: [] })
  const uid = Number(query)
  const users = await prisma.user.findMany({
    where: {
      isDeleted: false,
      OR: [
        ...(Number.isSafeInteger(uid) ? [{ uid }] : []),
        { nickname: { contains: query } },
        { username: { contains: query } },
        { Profile: { displayName: { contains: query } } },
      ],
    },
    take: 20,
    orderBy: { uid: 'asc' },
    select: { id: true, uid: true, nickname: true, points: true, Profile: { select: { displayName: true } } },
  })
  return NextResponse.json({ users: users.map((user) => ({ id: user.id, uid: user.uid, nickname: getPublicUserDisplayName(user), points: user.points })) })
}

export async function POST(request: Request) {
  if (rejectInvalidRequestOrigin(request)) return NextResponse.json({ message: '请求来源校验失败' }, { status: 403 })
  const guard = await requireAdmin('checkin_manage')
  if (!guard.user) return guard.response
  const body = await request.json().catch(() => null) as { userId?: unknown; targetDate?: unknown; reason?: unknown } | null
  const userId = sanitizeText(body?.userId, 100)
  const targetDateKey = sanitizeText(body?.targetDate, 10)
  const reason = sanitizeText(body?.reason, 500)
  if (!reason) return NextResponse.json({ message: '补签原因必填', code: 'REASON_REQUIRED' }, { status: 400 })
  const targetDate = parseBeijingDate(targetDateKey)
  if (!targetDate) return NextResponse.json({ message: '补签日期无效', code: 'INVALID_DATE' }, { status: 400 })
  if (targetDateKey >= getShanghaiDateKey()) {
    return NextResponse.json({ message: targetDateKey === getShanghaiDateKey() ? '今天请使用正常挂号' : '不能补签未来日期', code: 'FUTURE_NOT_ALLOWED' }, { status: 409 })
  }
  const now = new Date()
  try {
    const result = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT \`id\` FROM \`User\` WHERE \`id\` = ${userId} FOR UPDATE`
      const targetUser = await tx.user.findUnique({ where: { id: userId }, select: { id: true } })
      if (!targetUser) throw new CheckInMakeupError('用户不存在', 404, 'USER_NOT_FOUND')
      const existing = await tx.checkIn.findUnique({ where: { userId_checkinDateKey: { userId, checkinDateKey: targetDateKey } } })
      if (existing) throw new CheckInMakeupError('该日期已经挂号', 409, 'ALREADY_CHECKED_IN')
      const madeUp = await createMakeupCheckIn(tx, { userId, targetDateKey, type: 'MAKEUP_ADMIN', cost: 0, now })
      await tx.adminActionLog.create({
        data: {
          adminId: guard.user.id,
          targetUserId: userId,
          action: 'CHECK_IN_ADMIN_MAKEUP',
          detail: {
            targetDate: targetDateKey,
            reason,
            source: 'MAKEUP_ADMIN',
            checkInId: madeUp.checkIn.id,
            longTermRewardTriggered: madeUp.streak.rewardTriggered,
            longTermRewardAmount: madeUp.streak.rewardAmount,
          },
        },
      })
      const nearby = await tx.checkIn.findMany({
        where: { userId, checkinDateKey: { gte: shiftShanghaiDateKey(targetDateKey, -3), lte: shiftShanghaiDateKey(targetDateKey, 3) } },
        orderBy: { checkinDateKey: 'asc' },
        select: { checkinDateKey: true, type: true },
      })
      return { checkInId: madeUp.checkIn.id, targetDate: targetDateKey, nearby, longTermRewardTriggered: madeUp.streak.rewardTriggered }
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })
    return NextResponse.json(result, { status: 201 })
  } catch (error) {
    if (error instanceof CheckInMakeupError) return NextResponse.json({ message: error.message, code: error.code }, { status: error.status })
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      return NextResponse.json({ message: '该日期已经挂号', code: 'ALREADY_CHECKED_IN' }, { status: 409 })
    }
    console.error('[admin.checkin.makeup]', error)
    return NextResponse.json({ message: '管理员补签失败，请稍后重试' }, { status: 500 })
  }
}
