import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import { parseCheckInDateKey } from '@/lib/checkin-history'
import { prisma } from '@/lib/prisma'

type RouteContext = { params: Promise<{ dateKey: string }> }

export const dynamic = 'force-dynamic'

export async function GET(_request: Request, context: RouteContext) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ message: '请先登录' }, { status: 401 })

  const { dateKey } = await context.params
  if (!parseCheckInDateKey(dateKey)) {
    return NextResponse.json({ message: '日期参数不正确' }, { status: 400 })
  }

  const record = await prisma.checkIn.findUnique({
    where: { userId_checkinDateKey: { userId: user.id, checkinDateKey: dateKey } },
    select: { id: true, checkinDateKey: true, mood: true, message: true, createdAt: true, points: true, exp: true, streakDay: true },
  })
  if (!record) return NextResponse.json({ message: '当天没有挂号记录' }, { status: 404 })

  return NextResponse.json({
    record: {
      ...record,
      dateKey: record.checkinDateKey,
      createdAt: record.createdAt.toISOString(),
    },
  }, {
    headers: { 'Cache-Control': 'private, no-store, max-age=0', Vary: 'Cookie' },
  })
}
