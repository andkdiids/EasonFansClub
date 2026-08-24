import { NextResponse } from 'next/server'
import { getCurrentCheckInMonth, getCheckInMonthBounds, getCheckInMonthKey, parseCheckInDateKey } from '@/lib/checkin-history'
import { getCurrentUser } from '@/lib/auth'
import { getBeijingDateKey } from '@/lib/beijing-time'
import { prisma } from '@/lib/prisma'
import { buildUserMakeupAvailableDates, CHECK_IN_MAKEUP_COST, getMakeupWeek, getShanghaiMonthKey, getShanghaiWeekStart, USER_MAKEUP_TYPES } from '@/lib/checkin-makeup'
import { shiftShanghaiDateKey } from '@/lib/checkin'

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
  const currentWeek = getMakeupWeek(todayKey)
  const candidateStart = shiftShanghaiDateKey(getShanghaiWeekStart(todayKey), new Date(`${todayKey}T12:00:00+08:00`).getUTCDay() === 1 ? -1 : 0)
  const [firstRecord, records, recordsWithMessages, recordTypes, candidateRecords, currentWeekMakeup, makeupsInWindow, monthlyChallenge, profile] = await Promise.all([
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
      where: { userId: user.id, checkinDateKey: { gte: candidateStart, lt: todayKey } },
      select: { checkinDateKey: true },
    }),
    prisma.checkIn.findFirst({
      where: { userId: user.id, type: { in: USER_MAKEUP_TYPES }, checkinDateKey: { gte: currentWeek.startKey, lt: currentWeek.endKey } },
      select: { id: true },
    }),
    prisma.checkIn.findMany({
      where: { userId: user.id, type: { in: USER_MAKEUP_TYPES }, checkinDateKey: { gte: getShanghaiWeekStart(candidateStart), lt: todayKey } },
      select: { checkinDateKey: true },
    }),
    prisma.makeupChallenge.findUnique({
      where: { userId_monthKey: { userId: user.id, monthKey: getShanghaiMonthKey() } },
      select: { status: true, targetDateKey: true },
    }),
    prisma.user.findUnique({ where: { id: user.id }, select: { points: true } }),
  ])

  const recordIdsWithMessages = new Set(recordsWithMessages.map((record) => record.id))
  const typeById = new Map(recordTypes.map((record) => [record.id, record.type]))
  const firstDate = firstRecord ? parseCheckInDateKey(firstRecord.checkinDateKey) : null
  const targetIsFuture = monthKey > todayKey.slice(0, 7)
  const availableDates = buildUserMakeupAvailableDates({
    candidateStartKey: candidateStart,
    todayKey,
    checkedInDateKeys: candidateRecords.map((record) => record.checkinDateKey),
    makeupDateKeys: makeupsInWindow.map((record) => record.checkinDateKey),
    monthlyChallengeStatus: monthlyChallenge?.status,
    monthlyChallengeTargetDate: monthlyChallenge?.targetDateKey,
    now,
  })
  const eligibleDateKeys = availableDates
    .filter((item) => item.dateKey >= startKey && item.dateKey < endKey)
    .map((item) => item.dateKey)

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
      })),
      weeklyAvailable: !currentWeekMakeup,
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
