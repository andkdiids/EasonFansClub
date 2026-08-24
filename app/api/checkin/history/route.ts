import { NextResponse } from 'next/server'
import { getCurrentCheckInMonth, getCheckInMonthBounds, getCheckInMonthKey, parseCheckInDateKey } from '@/lib/checkin-history'
import { getCurrentUser } from '@/lib/auth'
import { getBeijingDateKey } from '@/lib/beijing-time'
import { prisma } from '@/lib/prisma'
import { CHECK_IN_MAKEUP_COST, getEligibleMakeupDates, getMakeupOperationWeek, getShanghaiMonthKey, isMakeupOperationInWeek, USER_MAKEUP_TYPES } from '@/lib/checkin-makeup'

export const dynamic = 'force-dynamic'

function parseMonthParam(value: string | null) {
  if (value === null) return null
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed >= 1 && parsed <= 12 ? parsed : null
}

function parseYearParam(value: string | null) {
  if (value === null) return null
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed >= 1 && parsed <= 9999 ? parsed : null
}

export async function GET(request: Request) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ message: '请先登录' }, { status: 401 })

  const now = new Date()
  const current = getCurrentCheckInMonth(now)
  const { searchParams } = new URL(request.url)
  const yearParam = searchParams.get('year')
  const monthParam = searchParams.get('month')
  const year = yearParam === null ? current.year : parseYearParam(yearParam)
  const month = monthParam === null ? current.month : parseMonthParam(monthParam)
  if (year === null || month === null) {
    return NextResponse.json({ message: '年月参数不正确' }, { status: 400 })
  }

  const { startKey, endKey } = getCheckInMonthBounds(year, month)
  const monthKey = getCheckInMonthKey(year, month)
  const todayKey = getBeijingDateKey(now)
  const operationWeek = getMakeupOperationWeek(now)
  const profile = await prisma.user.findUnique({ where: { id: user.id }, select: { points: true, createdAt: true } })
  if (!profile) return NextResponse.json({ message: '用户不存在' }, { status: 404 })
  const registrationDateKey = getBeijingDateKey(profile.createdAt)
  const [firstRecord, records, recordsWithMessages, recordTypes, candidateRecords, monthlyChallenge] = await Promise.all([
    prisma.checkIn.findFirst({
      where: { userId: user.id },
      orderBy: { checkinDateKey: 'asc' },
      select: { checkinDateKey: true },
    }),
    prisma.checkIn.findMany({
      where: { userId: user.id, checkinDateKey: { gte: startKey, lt: endKey } },
      orderBy: { checkinDateKey: 'asc' },
      select: { id: true, checkinDateKey: true, mood: true, moodType: true, moodEmoji: true, moodText: true },
    }),
    prisma.checkIn.findMany({
      where: { userId: user.id, checkinDateKey: { gte: startKey, lt: endKey }, message: { not: null } },
      select: { id: true },
    }),
    prisma.checkIn.findMany({
      where: { userId: user.id, checkinDateKey: { gte: startKey, lt: endKey } },
      select: { id: true, type: true },
    }),
    prisma.checkIn.findMany({
      where: { userId: user.id, checkinDateKey: { gte: registrationDateKey, lt: todayKey } },
      select: { checkinDateKey: true, type: true, createdAt: true },
    }),
    prisma.makeupChallenge.findUnique({
      where: { userId_monthKey: { userId: user.id, monthKey: getShanghaiMonthKey() } },
      select: { status: true, targetDateKey: true },
    }),
  ])

  const recordIdsWithMessages = new Set(recordsWithMessages.map((record) => record.id))
  const typeById = new Map(recordTypes.map((record) => [record.id, record.type]))
  const firstDate = firstRecord ? parseCheckInDateKey(firstRecord.checkinDateKey) : null
  const targetIsFuture = monthKey > todayKey.slice(0, 7)
  const currentWeekMakeup = candidateRecords.some((record) => USER_MAKEUP_TYPES.includes(record.type) && isMakeupOperationInWeek(record.createdAt, operationWeek))
  const availableDates = getEligibleMakeupDates({
    startDateKey: registrationDateKey,
    scope: 'USER',
    todayKey,
    checkedInDateKeys: candidateRecords.map((record) => record.checkinDateKey),
    makeupOperationTimes: candidateRecords.filter((record) => USER_MAKEUP_TYPES.includes(record.type)).map((record) => record.createdAt),
    monthlyChallengeStatus: monthlyChallenge?.status,
    monthlyChallengeTargetDate: monthlyChallenge?.targetDateKey,
    now,
  })
  const eligibleDateKeys = availableDates.map((item) => item.dateKey)

  return NextResponse.json({
    year,
    month,
    monthKey,
    todayKey,
    currentYear: current.year,
    currentMonth: current.month,
    earliestYear: firstDate?.year || current.year,
    records: records.map((record) => ({
      id: record.id,
      dateKey: record.checkinDateKey,
      mood: record.mood,
      moodType: record.moodType,
      moodEmoji: record.moodEmoji,
      moodText: record.moodText,
      type: typeById.get(record.id) || 'NORMAL',
      hasMessage: recordIdsWithMessages.has(record.id),
    })),
    makeup: {
      eligibleDateKeys,
      availableDates: availableDates.map((item) => ({
        dateKey: item.dateKey,
        cost: CHECK_IN_MAKEUP_COST,
        freeChallengeAvailable: item.freeChallengeAvailable,
        canUseNow: item.canUseNow,
        weeklyUsed: item.weeklyUsed,
        blockedReason: item.blockedReason,
      })),
      weeklyAvailable: !currentWeekMakeup,
      weeklyUsed: Boolean(currentWeekMakeup),
      weeklyRemaining: currentWeekMakeup ? 0 : 1,
      weeklyLimit: 1,
      monthlyChallengeAvailable: !monthlyChallenge,
      monthlyChallengePending: monthlyChallenge?.status === 'PENDING',
      monthlyChallengeTargetDate: monthlyChallenge?.status === 'PENDING' ? monthlyChallenge.targetDateKey : null,
      cost: CHECK_IN_MAKEUP_COST,
      currentBalance: profile?.points ?? 0,
    },
    isFutureMonth: targetIsFuture,
  }, {
    headers: { 'Cache-Control': 'private, no-store, max-age=0', Vary: 'Cookie' },
  })
}
