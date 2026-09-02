import { redirect } from 'next/navigation'
import { CheckInPageSurface } from '@/components/CheckInPageSurface'
import { getCurrentUser } from '@/lib/auth'
import { calculateCheckinStreaks, formatBeijingDate, getShanghaiDateKey, parseBeijingDate, startOfLocalDay } from '@/lib/checkin'
import { getCheckInMessage, getCheckInMessagesPage, getCheckInReplyStatus, resolveCheckInNotificationTarget, type CheckInMessagePagination, type CheckInMessageSort, type CheckInNotificationResolutionStatus, type CheckInNotificationTarget } from '@/lib/checkin-messages'
import { CHECK_IN_MESSAGE_PAGE_SIZE } from '@/lib/checkin-pagination'
import { getCheckInPublicStats } from '@/lib/checkin-stats'
import { calcMoodIndex, getDailyQuote } from '@/lib/daily'
import { safeDb, withDbTimeout } from '@/lib/db-timeout'
import { getFriendFollowedIds, getFriendIds } from '@/lib/friends'
import { markPersonalNotificationsForTargetRead } from '@/lib/notifications'
import { prisma } from '@/lib/prisma'
import { emitRealtime } from '@/lib/realtime'

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

export default async function CheckInPage({ searchParams }: { searchParams: Promise<{ date?: string; sort?: string; page?: string; message?: string; messageId?: string; dailyMessageId?: string; focus?: string; replyId?: string; commentId?: string; reply?: string }> }) {
  const sessionUser = await getCurrentUser()
  if (!sessionUser) redirect('/login')

  const params = await searchParams
  let selectedDate = parseDate(params.date)
  let notificationTargetDate: Date | null = null
  const rawNotificationMessageId = (params.message || params.messageId || params.dailyMessageId)?.slice(0, 80) || ''
  const rawNotificationFocusId = (params.focus || params.replyId || params.commentId || params.reply)?.slice(0, 80) || ''
  let notificationTarget: CheckInNotificationTarget = {
    messageId: null,
    commentId: null,
    date: null,
    status: 'NOT_FOUND',
  }
  let notificationTargetResolutionFailed = false
  if (rawNotificationMessageId || rawNotificationFocusId) {
    try {
      notificationTarget = await resolveCheckInNotificationTarget({
        messageId: rawNotificationMessageId,
        commentId: rawNotificationFocusId,
        viewerId: sessionUser.id,
        viewerCanModerate: sessionUser.role === 'ADMIN' || sessionUser.role === 'SUPER_ADMIN',
      })
    } catch {
      // Keep the page usable when the durable-target lookup itself times out;
      // the focus UI reports a load failure instead of misclassifying it as
      // missing or unauthorized content.
      notificationTargetResolutionFailed = true
    }
  }
  // Prefer the reply's own parent message/date. This handles links opened on a
  // different day, legacy replyId-only links, and replies outside page one.
  const notificationMessageId = notificationTarget.messageId || rawNotificationMessageId
  const notificationFocusId = rawNotificationFocusId
  // 通知点赞跳转到 /checkin?message=<id> 时，目标留言可能不在「今天」：
  // 先按 id 查出其所属日期并作为选中日期加载，确保留言进入列表后能被定位高亮。
  if (notificationTarget.date) {
    selectedDate = parseDate(formatBeijingDate(notificationTarget.date))
    notificationTargetDate = notificationTarget.date
  }
  if (notificationTargetDate && notificationMessageId) {
    const dateKey = formatBeijingDate(notificationTargetDate)
    const markedNotifications = await markPersonalNotificationsForTargetRead({
      userId: sessionUser.id,
      linkPrefix: notificationFocusId
        ? `/checkin?date=${dateKey}&message=${notificationMessageId}&focus=${notificationFocusId}`
        : `/checkin?date=${dateKey}&message=${notificationMessageId}`,
      types: notificationFocusId ? ['REPLY', 'LIKE'] : ['LIKE'],
    }).catch((error) => {
      console.warn('[checkin:notifications:mark-read-failed]', { messageId: notificationMessageId, focusId: notificationFocusId, error })
      return 0
    })
    if (markedNotifications > 0) emitRealtime(sessionUser.id, 'notification')
  }
  const nextDate = new Date(selectedDate.getTime() + 24 * 60 * 60 * 1000)
  const today = startOfLocalDay()
  const todayKey = getShanghaiDateKey(today)
  const sort: CheckInMessageSort = params.sort === 'hot' ? 'hot' : 'latest'
  const requestedMessagePage = Math.max(1, Number.parseInt(params.page || '1', 10) || 1)
  const emptyMessagePagination: CheckInMessagePagination = { page: 1, pageSize: CHECK_IN_MESSAGE_PAGE_SIZE, total: 0, totalPages: 1, hasMore: false }

  const friendIdsPromise = safeDb('Friendship.findMany checkin.friendIds', getFriendIds(sessionUser.id), [], 3000)
  const [user, activeUsers, publicStats, todayCheckIn, selectedMessagePage, friendIds, checkInHistory] = await Promise.all([
    withDbTimeout(
      'User.findUnique checkin.user',
      prisma.user.findUnique({
        where: { id: sessionUser.id },
        select: { points: true, exp: true, level: true, checkinMoodEnabled: true },
      }),
    ),
    safeDb(
      'User.count checkin.activeUsers',
      prisma.user.count({ where: { status: 'ACTIVE', isDeleted: false, Profile: { isNot: null } } }),
      0,
    ),
    getCheckInPublicStats(todayKey),
    withDbTimeout(
      'CheckIn.findUnique checkin.todayCheckIn',
      prisma.checkIn.findUnique({
        where: { userId_checkinDateKey: { userId: sessionUser.id, checkinDateKey: todayKey } },
        select: { checkDate: true, points: true, exp: true, mood: true, moodType: true, moodEmoji: true, moodText: true, message: true, streakDay: true, createdAt: true, type: true, isMakeUp: true, DailyMessage: { select: { id: true } } },
      }),
      8000,
    ),
    safeDb(
      'DailyMessage.page checkin.messages',
      getCheckInMessagesPage({
        selectedDate,
        nextDate,
        sort,
        viewerId: sessionUser.id,
        viewerCanModerate: sessionUser.role === 'ADMIN' || sessionUser.role === 'SUPER_ADMIN',
        friendContext: false,
        page: requestedMessagePage,
        pageSize: CHECK_IN_MESSAGE_PAGE_SIZE,
      }),
      { messages: [], pagination: emptyMessagePagination },
      8000,
    ),
    friendIdsPromise,
    safeDb('CheckIn.findMany checkin.history', prisma.checkIn.findMany({ where: { userId: sessionUser.id }, select: { checkinDateKey: true } }), []),
  ])
  const { todayCount, moodStats } = publicStats
  const followedFriendIds = await safeDb(
    'FriendFollow.findMany checkin.followedFriendIds',
    getFriendFollowedIds(sessionUser.id, friendIds),
    [],
    3000,
  )
  const friendMessages = await safeDb(
    'DailyMessage.page checkin.friendMessages',
    getCheckInMessagesPage({
      selectedDate,
      nextDate,
      sort,
      viewerId: sessionUser.id,
      viewerCanModerate: sessionUser.role === 'ADMIN' || sessionUser.role === 'SUPER_ADMIN',
      userIds: friendIds,
      stickyUserId: sessionUser.id,
      followedUserIds: followedFriendIds,
      page: 1,
      pageSize: CHECK_IN_MESSAGE_PAGE_SIZE,
      friendContext: true,
    }),
    { messages: [], pagination: emptyMessagePagination },
    8000,
  )
  const selectedMessages = selectedMessagePage.messages
  let messagesForDisplay = selectedMessages
  let friendMessagesForDisplay = friendMessages.messages
  let focusScope: 'public' | 'friends' = friendMessages.messages.some((item) => item.id === notificationMessageId) ? 'friends' : 'public'
  let focusErrorKind: CheckInNotificationResolutionStatus | undefined
  if (notificationTargetResolutionFailed) focusErrorKind = 'LOAD_FAILED'
  if (notificationMessageId && focusErrorKind !== 'LOAD_FAILED') {
    try {
      const initialFocusedMessage = await getCheckInMessage({
        messageId: notificationMessageId,
        focusCommentId: notificationFocusId || undefined,
        selectedDate,
        nextDate,
        viewerId: sessionUser.id,
        viewerCanModerate: sessionUser.role === 'ADMIN' || sessionUser.role === 'SUPER_ADMIN',
        friendContext: false,
      })
      if (initialFocusedMessage) {
        let focusedMessage = initialFocusedMessage
        const isFriendTarget = focusedMessage.userId === sessionUser.id
          || friendIds.includes(focusedMessage.userId)
          || friendMessages.messages.some((item) => item.id === focusedMessage.id)
        focusScope = isFriendTarget ? 'friends' : 'public'
        if (isFriendTarget) {
          focusedMessage = await getCheckInMessage({
            messageId: notificationMessageId,
            focusCommentId: notificationFocusId || undefined,
            selectedDate,
            nextDate,
            viewerId: sessionUser.id,
            viewerCanModerate: sessionUser.role === 'ADMIN' || sessionUser.role === 'SUPER_ADMIN',
            friendContext: true,
          }) || focusedMessage
        }
        if (isFriendTarget) {
          friendMessagesForDisplay = friendMessages.messages.some((item) => item.id === focusedMessage.id)
            ? friendMessages.messages.map((item) => item.id === focusedMessage.id ? focusedMessage : item)
            : [focusedMessage, ...friendMessages.messages]
        } else {
          messagesForDisplay = selectedMessages.some((item) => item.id === focusedMessage.id)
            ? selectedMessages.map((item) => item.id === focusedMessage.id ? focusedMessage : item)
            : [focusedMessage, ...selectedMessages]
        }
      }
      if (notificationFocusId) {
        const replyStatus = await getCheckInReplyStatus({
          messageId: notificationMessageId,
          commentId: notificationFocusId,
          viewerId: sessionUser.id,
          viewerCanModerate: sessionUser.role === 'ADMIN' || sessionUser.role === 'SUPER_ADMIN',
        })
        if (replyStatus === 'deleted') focusErrorKind = 'DELETED'
        if (replyStatus === 'not-found') focusErrorKind = 'NOT_FOUND'
        if (replyStatus === 'unavailable') focusErrorKind = 'FORBIDDEN'
        if (replyStatus === 'visible' && !initialFocusedMessage) focusErrorKind = 'LOAD_FAILED'
      }
      if (notificationTarget.status === 'DELETED') focusErrorKind = 'DELETED'
      if (notificationTarget.status === 'NOT_FOUND') focusErrorKind = 'NOT_FOUND'
      if (notificationTarget.status === 'FORBIDDEN') focusErrorKind = 'FORBIDDEN'
    } catch (error) {
      console.error('[checkin:notification-target-load-failed]', { messageId: notificationMessageId, focusId: notificationFocusId, error })
      focusErrorKind = 'LOAD_FAILED'
    }
  }
  if (!user) redirect('/login')

  const streaks = calculateCheckinStreaks(checkInHistory.map((item) => item.checkinDateKey))
  const moodIndex = calcMoodIndex(moodStats.map((item) => ({ mood: item.mood || '', _count: { mood: item._count.mood } })))
  const selectedDateValue = formatBeijingDate(selectedDate)
  const todayValue = formatBeijingDate(today)
  const todayCheckInPayload = todayCheckIn
    ? (() => {
        const { DailyMessage, ...checkIn } = todayCheckIn
        return {
          ...checkIn,
          dailyMessageId: DailyMessage?.id ?? null,
          checkDate: todayCheckIn.checkDate.toISOString(),
          createdAt: todayCheckIn.createdAt.toISOString(),
        }
      })()
    : null

  return (
    <>
      <main className="site-page-main flat-page mx-auto max-w-[1500px] px-4 py-6 sm:px-5">
        <CheckInPageSurface
          dailyQuote={getDailyQuote(today)}
          activeUsers={activeUsers}
          todayCount={todayCount}
          consecutiveDays={streaks.currentStreak}
          totalCheckIns={streaks.totalDays}
          moodIndex={moodIndex}
          todayCheckIn={todayCheckInPayload}
          selectedMessages={messagesForDisplay}
          selectedMessagesPagination={selectedMessagePage.pagination}
          friendMessages={friendMessagesForDisplay}
          friendMessagesPagination={friendMessages.pagination}
          friendFollowedUserIds={followedFriendIds}
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
          focusMessageId={notificationMessageId || undefined}
          focusCommentId={notificationFocusId || undefined}
          focusErrorKind={focusErrorKind}
          focusScope={focusScope}
        />
      </main>
    </>
  )
}
