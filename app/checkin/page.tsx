import { redirect } from 'next/navigation'
import { CheckInLayoutSurface } from '@/components/CheckInLayoutSurface'
import { getCurrentUser } from '@/lib/auth'
import { calculateCheckinStreaks, formatBeijingDate, getShanghaiDateKey, parseBeijingDate, startOfLocalDay } from '@/lib/checkin'
import { getCheckInMessages, type CheckInMessageSort } from '@/lib/checkin-messages'
import { calcMoodIndex, getDailyQuote } from '@/lib/daily'
import { safeDb, withDbTimeout } from '@/lib/db-timeout'
import { getFriendIds } from '@/lib/friends'
import { getPublishedPageLayoutConfig } from '@/lib/page-layout/service'
import { markPersonalNotificationsForTargetRead } from '@/lib/notifications'
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

export default async function CheckInPage({ searchParams }: { searchParams: Promise<{ date?: string; sort?: string; message?: string; focus?: string }> }) {
  const sessionUser = await getCurrentUser()
  if (!sessionUser) redirect('/login')

  const params = await searchParams
  let selectedDate = parseDate(params.date)
  let notificationTargetDate: Date | null = null
  const notificationMessageId = params.message?.slice(0, 80) || ''
  const notificationFocusId = params.focus?.slice(0, 80) || ''
  // 通知点赞跳转到 /checkin?message=<id> 时，目标留言可能不在「今天」：
  // 先按 id 查出其所属日期并作为选中日期加载，确保留言进入列表后能被定位高亮。
  if (params.message) {
    const targetMessage = await prisma.dailyMessage.findUnique({
      where: { id: notificationMessageId },
      select: { date: true },
    })
    if (targetMessage) {
      selectedDate = parseDate(formatBeijingDate(targetMessage.date))
      notificationTargetDate = targetMessage.date
    }
  }
  if (notificationTargetDate && notificationMessageId) {
    const dateKey = formatBeijingDate(notificationTargetDate)
    await markPersonalNotificationsForTargetRead({
      userId: sessionUser.id,
      linkPrefix: notificationFocusId
        ? `/checkin?date=${dateKey}&message=${notificationMessageId}&focus=${notificationFocusId}`
        : `/checkin?date=${dateKey}&message=${notificationMessageId}`,
      types: notificationFocusId ? ['REPLY', 'LIKE'] : ['LIKE'],
    }).catch((error) => console.warn('[checkin:notifications:mark-read-failed]', { messageId: notificationMessageId, focusId: notificationFocusId, error }))
  }
  const nextDate = new Date(selectedDate.getTime() + 24 * 60 * 60 * 1000)
  const today = startOfLocalDay()
  const todayKey = getShanghaiDateKey(today)
  const sort: CheckInMessageSort = params.sort === 'hot' ? 'hot' : 'latest'

  const friendIdsPromise = safeDb('Friendship.findMany checkin.friendIds', getFriendIds(sessionUser.id), [], 3000)
  const [user, activeUsers, todayCount, todayCheckIn, selectedMessages, friendIds, moodStats, checkInHistory] = await Promise.all([
    withDbTimeout(
      'User.findUnique checkin.user',
      prisma.user.findUnique({
        where: { id: sessionUser.id },
        select: { points: true, exp: true, level: true, consecutiveDays: true, checkinMoodEnabled: true },
      }),
    ),
    safeDb(
      'User.count checkin.activeUsers',
      prisma.user.count({ where: { status: 'ACTIVE', isDeleted: false, Profile: { isNot: null } } }),
      0,
    ),
    safeDb('CheckIn.count checkin.todayCount', prisma.checkIn.count({ where: { checkinDateKey: todayKey } }), 0),
    withDbTimeout(
      'CheckIn.findUnique checkin.todayCheckIn',
      prisma.checkIn.findUnique({
        where: { userId_checkinDateKey: { userId: sessionUser.id, checkinDateKey: todayKey } },
        select: { checkDate: true, points: true, exp: true, mood: true, message: true, streakDay: true, createdAt: true },
      }),
      8000,
    ),
    safeDb(
      'DailyMessage.findMany checkin.messages',
      getCheckInMessages({
        selectedDate,
        nextDate,
        sort,
        viewerId: sessionUser.id,
        viewerCanModerate: sessionUser.role === 'ADMIN' || sessionUser.role === 'SUPER_ADMIN',
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
      viewerCanModerate: sessionUser.role === 'ADMIN' || sessionUser.role === 'SUPER_ADMIN',
      userIds: friendIds,
    }),
    [],
    8000,
  )
  if (!user) redirect('/login')

  const streaks = calculateCheckinStreaks(checkInHistory.map((item) => item.checkinDateKey))
  const moodIndex = calcMoodIndex(moodStats.map((item) => ({ mood: item.mood || '', _count: { mood: item._count.mood } })))
  const selectedDateValue = formatBeijingDate(selectedDate)
  const todayValue = formatBeijingDate(today)
  const layoutConfig = await getPublishedPageLayoutConfig('checkin')
  const todayCheckInPayload = todayCheckIn
    ? {
        ...todayCheckIn,
        checkDate: todayCheckIn.checkDate.toISOString(),
        createdAt: todayCheckIn.createdAt.toISOString(),
      }
    : null

  return (
    <>
      <main className="site-page-main flat-page mx-auto max-w-7xl px-4 py-5 sm:px-5">
        <CheckInLayoutSurface
          layoutConfig={layoutConfig}
          dailyQuote={getDailyQuote(today)}
          activeUsers={activeUsers}
          todayCount={todayCount}
          consecutiveDays={streaks.currentStreak}
          totalCheckIns={streaks.totalDays}
          moodIndex={moodIndex}
          todayCheckIn={todayCheckInPayload}
          selectedMessages={selectedMessages}
          friendMessages={friendMessages}
          selectedDateValue={selectedDateValue}
          todayValue={todayValue}
          sort={sort}
          stats={{
            level: user.level,
            points: user.points,
            exp: user.exp,
            consecutiveDays: streaks.currentStreak,
          }}
          checkinMoodEnabled={user.checkinMoodEnabled}
          sessionUserId={sessionUser.id}
          sessionUserRole={sessionUser.role}
          focusMessageId={params.message?.slice(0, 80)}
          focusCommentId={params.focus?.slice(0, 80)}
        />
      </main>
    </>
  )
}
