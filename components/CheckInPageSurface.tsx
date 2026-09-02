'use client'

import { useCallback, useEffect, useState } from 'react'
import { BeijingClock } from '@/components/BeijingClock'
import { CheckInButton, type CheckInStateChange, type CheckInStats, type TodayCheckIn } from '@/components/CheckInButton'
import { CheckInHistoryDialog } from '@/components/CheckInHistoryDialog'
import { CheckInMakeupEntry } from '@/components/CheckInMakeupEntry'
import { CheckInMessagesPanel } from '@/components/CheckInMessagesPanel'
import { CheckInLikeProvider } from '@/components/checkin-like-context'
import { TodayRegistrationFeePanel } from '@/components/TodayRegistrationFeePanel'
import type { CheckInDisplayMessageItem, CheckInMessageItem, CheckInMessagePagination, CheckInMessageSort, CheckInNotificationResolutionStatus } from '@/lib/checkin-messages'

export type TodayCheckInPayload = TodayCheckIn

export type CheckInPageSurfaceProps = {
  dailyQuote: string
  activeUsers: number
  todayCount: number
  consecutiveDays: number
  totalCheckIns: number
  moodIndex: number
  todayCheckIn: TodayCheckInPayload
  selectedMessages: CheckInDisplayMessageItem[]
  selectedMessagesPagination?: CheckInMessagePagination
  friendMessages: CheckInMessageItem[]
  friendMessagesPagination?: CheckInMessagePagination
  friendFollowedUserIds?: string[]
  selectedDateValue: string
  todayValue: string
  sort: CheckInMessageSort
  sessionUserId?: string
  sessionUserRole?: string
  stats: CheckInStats
  checkinMoodEnabled?: boolean
  focusMessageId?: string
  focusCommentId?: string
  focusErrorKind?: CheckInNotificationResolutionStatus
  focusScope?: 'public' | 'friends'
}

function publicMessagesTitle(title?: string | null) {
  return !title || title === 'E友留言' || title === '公开挂号留言' ? '病友留言' : title
}

function CheckInStatsCard({ activeUsers, todayCount, consecutiveDays, totalCheckIns, moodIndex }: Readonly<{
  activeUsers: number
  todayCount: number
  consecutiveDays: number
  totalCheckIns: number
  moodIndex: number
}>) {
  const items = [
    ['E院病友人数', `${activeUsers} 人`],
    ['今日挂号人数', `${todayCount} 人`],
    ['连续挂号天数', `${consecutiveDays} 天`],
    ['累计挂号天数', `${totalCheckIns} 天`],
    ['今日情绪指数', moodIndex ? `${moodIndex}/100` : '待生成'],
  ]

  return (
    <div data-checkin-stats-grid="true" className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-1">
      {items.map(([label, value]) => (
        <div key={label} className="rounded-2xl border border-sky-100 bg-sky-50/75 p-3 text-center">
          <p className="truncate text-[11px] font-black text-slate-500">{label}</p>
          <p className="mt-1 text-lg font-black leading-tight text-brand-950">{value}</p>
        </div>
      ))}
    </div>
  )
}

export function CheckInPageSurface({
  dailyQuote,
  activeUsers,
  todayCount: initialTodayCount,
  consecutiveDays,
  totalCheckIns: initialTotalCheckIns,
  moodIndex,
  todayCheckIn: initialTodayCheckIn,
  selectedMessages,
  selectedMessagesPagination,
  friendMessages,
  friendMessagesPagination,
  friendFollowedUserIds = [],
  selectedDateValue,
  todayValue,
  sort,
  sessionUserId,
  sessionUserRole,
  stats: initialStats,
  checkinMoodEnabled = true,
  focusMessageId,
  focusCommentId,
  focusErrorKind,
  focusScope,
}: CheckInPageSurfaceProps) {
  const [todayCheckIn, setTodayCheckIn] = useState(initialTodayCheckIn)
  const [stats, setStats] = useState(initialStats)
  const [todayCount, setTodayCount] = useState(initialTodayCount)
  const [totalCheckIns, setTotalCheckIns] = useState(initialTotalCheckIns)

  useEffect(() => {
    setTodayCheckIn(initialTodayCheckIn)
    setStats(initialStats)
    setTodayCount(initialTodayCount)
    setTotalCheckIns(initialTotalCheckIns)
  }, [initialStats, initialTodayCheckIn, initialTodayCount, initialTotalCheckIns])

  const handleStateChange = useCallback((next: CheckInStateChange) => {
    setTodayCheckIn(next.todayCheckIn)
    setStats(next.stats)
    setTodayCount((current) => next.todayCount ?? (next.created ? current + 1 : current))
    setTotalCheckIns((current) => next.totalCheckIns ?? (next.created ? current + 1 : current))
  }, [])

  const canManageMessages = sessionUserRole === 'ADMIN' || sessionUserRole === 'SUPER_ADMIN'

  return (
    <CheckInLikeProvider>
      <section className="grid items-start gap-5 md:grid-cols-2 xl:grid-cols-[minmax(260px,0.85fr)_minmax(360px,1.15fr)_minmax(380px,1.35fr)]">
        <aside className="rounded-[28px] border border-sky-100 bg-white/85 p-5 shadow-sm sm:p-6">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-xs font-black uppercase tracking-[0.16em] text-brand-700">Daily Clinic</p>
              <h1 className="mt-1 text-2xl font-black leading-tight text-brand-950 sm:text-[1.65rem]">每日挂号</h1>
            </div>
            <div className="min-w-40 rounded-2xl bg-sky-50/75 px-3 py-2">
              <p className="text-xs font-black text-slate-500">北京时间</p>
              <p className="mt-0.5 text-lg font-black text-brand-950"><BeijingClock /></p>
            </div>
          </div>
          <p className="mt-5 rounded-2xl bg-sky-50/75 px-4 py-3 text-sm font-bold leading-6 text-slate-700">{dailyQuote}</p>
          <CheckInStatsCard
            activeUsers={activeUsers}
            todayCount={todayCount}
            consecutiveDays={stats.consecutiveDays || consecutiveDays}
            totalCheckIns={totalCheckIns || initialTotalCheckIns}
            moodIndex={moodIndex}
          />
        </aside>

        <section className="rounded-[28px] border border-sky-100 bg-white/85 p-5 shadow-sm sm:p-6">
          <p className="text-xs font-black uppercase tracking-[0.16em] text-brand-700">Today&apos;s Check-in</p>
          <h2 className="mt-1 text-2xl font-black leading-tight text-brand-950 sm:text-[1.65rem]">今天也来报到吧</h2>
          <div className="mt-4">
            <CheckInButton
              initialCheckIn={todayCheckIn}
              initialStats={stats}
              checkinMoodEnabled={checkinMoodEnabled}
              todayValue={todayValue}
              onStateChange={handleStateChange}
            />
          </div>
          {sessionUserId ? (
            <div className="mt-4 flex flex-wrap gap-2">
              <CheckInHistoryDialog initialDate={todayValue} />
              <CheckInMakeupEntry />
            </div>
          ) : null}
          <TodayRegistrationFeePanel />
        </section>

        <div className="md:col-span-2 xl:col-span-1">
          <CheckInMessagesPanel
            title={publicMessagesTitle('病友留言')}
            scope="public"
            initialMessages={selectedMessages}
            initialPagination={selectedMessagesPagination}
            initialDate={selectedDateValue}
            maxDate={todayValue}
            initialSort={sort}
            sessionUserId={sessionUserId}
            focusMessageId={focusScope === 'friends' ? undefined : focusMessageId}
            focusCommentId={focusScope === 'friends' ? undefined : focusCommentId}
            focusErrorKind={focusScope === 'friends' ? undefined : focusErrorKind}
            canManageMessages={canManageMessages}
          />
        </div>
      </section>

      <section className="mt-5 grid items-start gap-5 xl:grid-cols-2">
        <CheckInMessagesPanel
          title="好友挂号留言"
          scope="friends"
          initialMessages={friendMessages}
          initialPagination={friendMessagesPagination}
          initialFollowedUserIds={friendFollowedUserIds}
          initialDate={selectedDateValue}
          maxDate={todayValue}
          initialSort={sort}
          sessionUserId={sessionUserId}
          focusMessageId={focusScope === 'friends' ? focusMessageId : undefined}
          focusCommentId={focusScope === 'friends' ? focusCommentId : undefined}
          focusErrorKind={focusScope === 'friends' ? focusErrorKind : undefined}
          emptyText="暂无好友挂号留言"
          canManageMessages={canManageMessages}
        />
      </section>
    </CheckInLikeProvider>
  )
}
