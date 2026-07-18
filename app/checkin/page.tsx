import { redirect } from 'next/navigation'
import { CheckInLayoutSurface } from '@/components/CheckInLayoutSurface'
import { SiteHeader } from '@/components/SiteHeader'
import { getCurrentUser } from '@/lib/auth'
import { calculateCheckinStreaks, formatBeijingDate, getShanghaiDateKey, isSameLocalDay, parseBeijingDate, startOfLocalDay } from '@/lib/checkin'
import { anonymizeCheckInMessages, getCheckInMessages, type CheckInMessageSort } from '@/lib/checkin-messages'
import { calcMoodIndex, getDailyQuote } from '@/lib/daily'
import { safeDb, withDbTimeout } from '@/lib/db-timeout'
import { getFriendIds } from '@/lib/friends'
import { getPublishedPageLayoutConfig } from '@/lib/page-layout/service'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

function parseDate(value?: string) {
  const today = startOfLocalDay()
  if (!value) return today

  const date = parseBeijingDate(value)
  const yearAgo = new Date(today)
  yearAgo.setUTCFullYear(yearAgo.getUTCFullYear() - 1)

  if (!date || date > today || date < yearAgo) return today
  return date
}

export default async function CheckInPage({ searchParams }: { searchParams: Promise<{ date?: string; sort?: string }> }) {
  const pageStart = Date.now()
  const sessionUser = await getCurrentUser()
  if (!sessionUser) redirect('/login')
  console.info('[perf]', { metric: 'page.checkin.auth.ms', ms: Date.now() - pageStart })

  const params = await searchParams
  const selectedDate = parseDate(params.date)
  const nextDate = new Date(selectedDate.getTime() + 24 * 60 * 60 * 1000)
  const today = startOfLocalDay()
  const todayKey = getShanghaiDateKey(today)
  const sort: CheckInMessageSort = params.sort === 'hot' ? 'hot' : 'latest'

  const queryStart = Date.now()
  const friendIdsPromise = safeDb('Friendship.findMany checkin.friendIds', getFriendIds(sessionUser.id), [], 3000)
  const [user, activeUsers, todayCount, todayCheckIn, selectedMessages, friendIds, moodStats, checkInHistory] = await Promise.all([
    withDbTimeout(
      'User.findUnique checkin.user',
      prisma.user.findUnique({
        where: { id: sessionUser.id },
        select: { points: true, exp: true, level: true, consecutiveDays: true, lastCheckInDate: true },
      }),
    ),
    safeDb(
      'User.count checkin.activeUsers',
      prisma.user.count({ where: { status: 'ACTIVE', isDeleted: false, profile: { isNot: null } } }),
      0,
    ),
    safeDb('CheckIn.count checkin.todayCount', prisma.checkIn.count({ where: { checkinDateKey: todayKey } }), 0),
    safeDb(
      'CheckIn.findUnique checkin.todayCheckIn',
      prisma.checkIn.findUnique({
        where: { userId_checkinDateKey: { userId: sessionUser.id, checkinDateKey: todayKey } },
        select: { checkDate: true, points: true, exp: true, mood: true, message: true, streakDay: true, createdAt: true },
      }),
      null,
    ),
    safeDb(
      'DailyMessage.findMany checkin.messages',
      getCheckInMessages({
        selectedDate,
        nextDate,
        sort,
        viewerId: sessionUser.id,
      }),
      [],
      8000,
    ),
    friendIdsPromise,
    safeDb(
      'CheckIn.groupBy checkin.moodStats',
      prisma.checkIn.groupBy({
        by: ['mood'],
        where: { checkinDateKey: todayKey, mood: { not: null } },
        _count: { mood: true },
      }),
      [],
    ),
    safeDb('CheckIn.findMany checkin.history', prisma.checkIn.findMany({ where: { userId: sessionUser.id }, select: { checkinDateKey: true } }), []),
  ])
  const friendMessages = await safeDb(
    'DailyMessage.findMany checkin.friendMessages',
    getCheckInMessages({
      selectedDate,
      nextDate,
      sort,
      viewerId: sessionUser.id,
      userIds: friendIds,
    }),
    [],
    8000,
  )
  console.info('[perf]', { metric: 'page.checkin.parallelQueries.ms', ms: Date.now() - queryStart })
  console.info('[perf]', { metric: 'page.checkin.total.ms', ms: Date.now() - pageStart })

  if (!user) redirect('/login')

  const streaks = calculateCheckinStreaks(checkInHistory.map((item) => item.checkinDateKey))
  const resolvedTodayCheckIn = todayCheckIn || (isSameLocalDay(user.lastCheckInDate, today)
    ? { checkDate: today, points: 0, exp: 0, mood: null, message: null, streakDay: streaks.currentStreak, createdAt: user.lastCheckInDate || today }
    : null)

  const moodIndex = calcMoodIndex(moodStats.map((item) => ({ mood: item.mood || '', _count: { mood: item._count.mood } })))
  const selectedDateValue = formatBeijingDate(selectedDate)
  const todayValue = formatBeijingDate(today)
  const layoutConfig = await getPublishedPageLayoutConfig('checkin')
  const todayCheckInPayload = resolvedTodayCheckIn
    ? {
        ...resolvedTodayCheckIn,
        checkDate: resolvedTodayCheckIn.checkDate.toISOString(),
        createdAt: resolvedTodayCheckIn.createdAt.toISOString(),
      }
    : null

  return (
    <>
      <SiteHeader user={sessionUser} />
      <main className="mx-auto max-w-[1500px] px-4 py-5 sm:px-5">
        <CheckInLayoutSurface
          layoutConfig={layoutConfig}
          dailyQuote={getDailyQuote(today)}
          activeUsers={activeUsers}
          todayCount={todayCount}
          consecutiveDays={streaks.currentStreak}
          totalCheckIns={streaks.totalDays}
          moodIndex={moodIndex}
          todayCheckIn={todayCheckInPayload}
          selectedMessages={anonymizeCheckInMessages(selectedMessages)}
          friendMessages={friendMessages}
          selectedDateValue={selectedDateValue}
          todayValue={todayValue}
          sort={sort}
          sessionUserId={sessionUser.id}
          sessionUserRole={sessionUser.role}
          stats={{
            level: user.level,
            points: user.points,
            exp: user.exp,
            consecutiveDays: streaks.currentStreak,
          }}
        />
      </main>
    </>
  )
}
