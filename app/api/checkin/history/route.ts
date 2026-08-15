import { NextResponse } from 'next/server'
import { getCurrentCheckInMonth, getCheckInMonthBounds, getCheckInMonthKey, parseCheckInDateKey } from '@/lib/checkin-history'
import { getCurrentUser } from '@/lib/auth'
import { getBeijingDateKey } from '@/lib/beijing-time'
import { prisma } from '@/lib/prisma'

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

  const current = getCurrentCheckInMonth()
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
  const todayKey = getBeijingDateKey()
  const [firstRecord, records, recordsWithMessages] = await Promise.all([
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
  ])

  const recordIdsWithMessages = new Set(recordsWithMessages.map((record) => record.id))
  const firstDate = firstRecord ? parseCheckInDateKey(firstRecord.checkinDateKey) : null
  const targetIsFuture = monthKey > todayKey.slice(0, 7)

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
      hasMessage: recordIdsWithMessages.has(record.id),
    })),
    isFutureMonth: targetIsFuture,
  }, {
    headers: { 'Cache-Control': 'private, no-store, max-age=0', Vary: 'Cookie' },
  })
}
