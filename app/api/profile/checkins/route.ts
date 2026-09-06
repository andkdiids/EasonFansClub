import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import { calculateCheckinStreaks } from '@/lib/checkin'
import { safeDb } from '@/lib/db-timeout'
import { prisma } from '@/lib/prisma'
import { unauthenticatedResponse } from '@/lib/security'

export async function GET() {
  const user = await getCurrentUser()
  if (!user) return unauthenticatedResponse()

  const monthStart = new Date()
  monthStart.setDate(1)
  monthStart.setHours(0, 0, 0, 0)

  const [checkIns, history] = await Promise.all([
    safeDb(
      'profile.checkins',
      prisma.checkIn.findMany({
        where: { userId: user.id, checkDate: { gte: monthStart } },
        orderBy: { checkDate: 'asc' },
        select: { id: true, checkDate: true, checkinDateKey: true, mood: true, moodType: true, moodEmoji: true, moodText: true, points: true, exp: true, streakDay: true, type: true, isMakeUp: true, madeUpAt: true, makeupCost: true },
      }),
      [],
    ),
    safeDb(
      'profile.checkinDateKeys',
      prisma.checkIn.findMany({ where: { userId: user.id }, select: { checkinDateKey: true } }),
      [],
    ),
  ])

  // 连续与最长连续只按签到记录重算,不再使用 max(CheckIn.streakDay)
  const streaks = calculateCheckinStreaks(history.map((item) => item.checkinDateKey))

  return NextResponse.json({
    checkIns,
    currentStreak: streaks.currentStreak,
    longestStreak: streaks.longestStreak,
    totalCheckIns: streaks.totalDays,
  })
}
