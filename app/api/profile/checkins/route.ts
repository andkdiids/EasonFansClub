import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import { safeDb } from '@/lib/db-timeout'
import { prisma } from '@/lib/prisma'

export async function GET() {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ message: '请先登录' }, { status: 401 })

  const monthStart = new Date()
  monthStart.setDate(1)
  monthStart.setHours(0, 0, 0, 0)

  const checkIns = await safeDb(
    'profile.checkins',
    prisma.checkIn.findMany({
      where: { userId: user.id, checkDate: { gte: monthStart } },
      orderBy: { checkDate: 'asc' },
      select: { id: true, checkDate: true, mood: true, points: true, exp: true, streakDay: true },
    }),
    [],
  )

  const longest = await safeDb(
    'profile.longestCheckin',
    prisma.checkIn.findFirst({
      where: { userId: user.id },
      orderBy: { streakDay: 'desc' },
      select: { streakDay: true },
    }),
    null,
  )

  return NextResponse.json({ checkIns, longestStreak: longest?.streakDay || 0 })
}
