'use client'

import { useCallback, useEffect, useState } from 'react'
import { BeijingClock } from '@/components/BeijingClock'
import { CheckInButton, type CheckInStateChange, type CheckInStats, type TodayCheckIn } from '@/components/CheckInButton'
import { CheckInHistoryDialog } from '@/components/CheckInHistoryDialog'
import { CheckInMakeupEntry } from '@/components/CheckInMakeupEntry'
import { CheckInMessagesPanel } from '@/components/CheckInMessagesPanel'
import { CheckInLikeProvider } from '@/components/checkin-like-context'
import { CheckInGrowthGuideCard } from '@/components/CheckInGrowthGuideCard'
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

function CheckInStatsCard({ activeUsers, todayCount, consecutiveDays, totalCheckIns }: Readonly<{
  activeUsers: number
  todayCount: number
  consecutiveDays: number
  totalCheckIns: number
}>) {
  const items = [
    ['E院人数', activeUsers],
    ['今日挂号', todayCount],
    ['连续天数', consecutiveDays],
    ['累计天数', totalCheckIns],
  ]

  return (
    <div data-checkin-stats-grid="true" className="mt-5 grid grid-cols-2 gap-2.5 sm:gap-3">
      {items.map(([label, value]) => (
        <div key={label} className="min-w-0 border border-[var(--border)] bg-[var(--surface-subtle)] px-3 py-3 text-center sm:py-3.5">
          <p className="truncate text-[11px] font-black text-slate-500">{label}</p>
          <p className="mt-1 text-xl font-black leading-tight text-brand-950">{value}</p>
        </div>
      ))}
    </div>
  )
}

export function CheckInPageSurface({
  activeUsers,
  todayCount: initialTodayCount,
  consecutiveDays,
  totalCheckIns: initialTotalCheckIns,
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
      <div className="mx-auto w-full max-w-[504px] md:max-w-[1040px]">
        <section data-checkin-main-card="true" className="rounded-sm border border-[var(--border)] bg-[var(--surface)] p-4 sm:p-5">
          <div className="flex min-w-0 items-start justify-between gap-4">
            <div className="min-w-0">
              <p className="text-xs font-black uppercase tracking-[0.16em] text-brand-700">Daily Clinic</p>
              <h1 className="mt-1 text-2xl font-black leading-tight text-brand-950 sm:text-[1.65rem]">每日挂号</h1>
            </div>
            <div className="shrink-0 text-right">
              <p className="text-xs font-black text-slate-500">北京时间</p>
              <p className="mt-1 whitespace-nowrap text-base font-black text-brand-950 sm:text-lg"><BeijingClock /></p>
            </div>
          </div>

          <CheckInStatsCard
            activeUsers={activeUsers}
            todayCount={todayCount}
            consecutiveDays={stats.consecutiveDays || consecutiveDays}
            totalCheckIns={totalCheckIns || initialTotalCheckIns}
          />

          <div className="mt-5 flex items-center gap-6 whitespace-nowrap text-[11px] font-black text-brand-700 sm:gap-8 sm:text-xs" data-checkin-level-row="true">
            <span>Lv.{stats.level}</span>
            <span>{stats.points} 挂号费</span>
            <span>{stats.exp} 经验</span>
          </div>

          <div className="mt-5">
            <CheckInGrowthGuideCard />
          </div>

          <div className="mt-5">
            <CheckInButton
              initialCheckIn={todayCheckIn}
              initialStats={stats}
              checkinMoodEnabled={checkinMoodEnabled}
              todayValue={todayValue}
              onStateChange={handleStateChange}
            />
          </div>

          {sessionUserId ? (
            <div className="checkin-page-actions mt-5 grid gap-2">
              <CheckInMakeupEntry />
              <CheckInHistoryDialog initialDate={todayValue} />
            </div>
          ) : null}
          <TodayRegistrationFeePanel />
        </section>

        <section className="mt-5">
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
        </section>

        <section className="mt-5">
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
      </div>
    </CheckInLikeProvider>
  )
}
