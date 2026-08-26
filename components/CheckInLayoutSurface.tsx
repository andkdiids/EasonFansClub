'use client'

import { BeijingClock } from '@/components/BeijingClock'
import { useCallback, useEffect, useState } from 'react'
import { CheckInButton, type CheckInStateChange, type CheckInStats, type TodayCheckIn } from '@/components/CheckInButton'
import { CheckInMessagesPanel } from '@/components/CheckInMessagesPanel'
import { CheckInHistoryDialog } from '@/components/CheckInHistoryDialog'
import { CheckInMakeupEntry } from '@/components/CheckInMakeupEntry'
import { CheckInLikeProvider } from '@/components/checkin-like-context'
import { TodayRegistrationFeePanel } from '@/components/TodayRegistrationFeePanel'
import { PageLayoutRenderer } from '@/components/page-layout/PageLayoutRenderer'
import type {
  PageLayoutModuleDensity,
  PageLayoutModuleRenderer,
} from '@/components/page-layout/PageLayoutRenderer'
import type { CheckInDisplayMessageItem, CheckInMessageItem, CheckInMessagePagination, CheckInMessageSort } from '@/lib/checkin-messages'
import type { PageLayoutConfig } from '@/lib/page-layout/types'

export type TodayCheckInPayload = TodayCheckIn

export type CheckInLayoutModuleProps = {
  layoutConfig: PageLayoutConfig
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
  stats: {
    level: number
    points: number
    exp: number
    consecutiveDays: number
  }
  checkinMoodEnabled?: boolean
  focusMessageId?: string
  focusCommentId?: string
  focusErrorKind?: 'load' | 'deleted' | 'not-found' | 'unavailable'
  previewMode?: boolean
}

function densityCardClass(density: PageLayoutModuleDensity) {
  if (density === 'minimal') return 'checkin-layout-card rounded-sm border border-sky-100 bg-white/85'
  if (density === 'compact') return 'checkin-layout-card rounded-sm border border-sky-100 bg-white/85'
  return 'checkin-layout-card rounded-sm border border-sky-100 bg-white/85'
}

function publicMessagesTitle(title?: string | null) {
  return !title || title === 'E友留言' || title === '公开挂号留言' ? '病友留言' : title
}

function CheckInStatsCard({
  density,
  activeUsers,
  todayCount,
  consecutiveDays,
  totalCheckIns,
}: Readonly<{
  density: PageLayoutModuleDensity
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
  ] as const
  return (
    <div data-checkin-stats-grid="true" className={`grid gap-2 ${density === 'minimal' ? 'grid-cols-4' : 'grid-cols-2 sm:grid-cols-4'}`}>
      {items.map(([label, value]) => (
        <div key={label} className="rounded-sm border border-sky-100 bg-sky-50/75 p-2.5 text-center">
          <p className="truncate text-[11px] font-black text-slate-500">{label}</p>
          <p className="mt-0.5 text-lg font-black leading-tight text-brand-950">{value}</p>
        </div>
      ))}
    </div>
  )
}

function CheckInStatusContent({
  title,
  density,
  activeUsers,
  initialTodayCount,
  initialTotalCheckIns,
  initialCheckIn,
  initialStats,
  todayValue,
  sessionUserId,
  previewMode,
  checkinMoodEnabled = true,
}: Readonly<{
  title: string
  density: PageLayoutModuleDensity
  activeUsers: number
  initialTodayCount: number
  initialTotalCheckIns: number
  initialCheckIn: TodayCheckInPayload
  initialStats: CheckInStats
  todayValue: string
  sessionUserId?: string
  previewMode: boolean
  checkinMoodEnabled: boolean
}>) {
  const [todayCheckIn, setTodayCheckIn] = useState(initialCheckIn)
  const [stats, setStats] = useState(initialStats)
  const [todayCount, setTodayCount] = useState(initialTodayCount)
  const [totalCheckIns, setTotalCheckIns] = useState(initialTotalCheckIns)

  useEffect(() => {
    setTodayCheckIn(initialCheckIn)
    setStats(initialStats)
    setTodayCount(initialTodayCount)
    setTotalCheckIns(initialTotalCheckIns)
  }, [initialCheckIn, initialStats, initialTodayCount, initialTotalCheckIns])

  const handleStateChange = useCallback((next: CheckInStateChange) => {
    setTodayCheckIn(next.todayCheckIn)
    setStats(next.stats)
    setTodayCount((current) => next.todayCount ?? (next.created ? current + 1 : current))
    setTotalCheckIns((current) => next.totalCheckIns ?? (next.created ? current + 1 : current))
  }, [])

  return (
    <section className={densityCardClass(density)}>
      <div className={density === 'minimal' ? 'flex flex-wrap items-center justify-between gap-2' : 'flex flex-wrap items-start justify-between gap-3'}>
        <div className="min-w-0">
          {density !== 'minimal' ? <p className="text-xs font-black uppercase tracking-[0.16em] text-brand-700">Daily Clinic</p> : null}
          <h1 className={density === 'minimal' ? 'text-lg font-black leading-tight text-brand-950' : 'mt-1 text-2xl font-black leading-tight text-brand-950 sm:text-[1.65rem]'}>
            {title}
          </h1>
        </div>
        <div className={density === 'minimal' ? 'flex items-center gap-2 rounded-xl bg-sky-50/75 px-2 py-1.5' : 'min-w-40 rounded-2xl bg-sky-50/75 px-3 py-2'}>
          <p className="text-xs font-black text-slate-500">北京时间</p>
          <p className={density === 'minimal' ? 'text-sm font-black text-brand-950' : 'mt-0.5 text-lg font-black text-brand-950'}><BeijingClock /></p>
        </div>
      </div>

      {todayCheckIn ? (
        <div className={density === 'minimal' ? 'mt-2' : 'mt-4'}>
          <CheckInStatsCard
            density={density}
            activeUsers={activeUsers}
            todayCount={todayCount}
            consecutiveDays={stats.consecutiveDays}
            totalCheckIns={totalCheckIns}
          />
        </div>
      ) : null}

      <div className={density === 'minimal' ? 'mt-2 min-h-0' : 'mt-4 min-h-0'}>
        <CheckInButton
          initialCheckIn={todayCheckIn}
          initialStats={stats}
          compact={density !== 'normal'}
          density={density}
          previewMode={previewMode}
          checkinMoodEnabled={checkinMoodEnabled}
          todayValue={todayValue}
          onStateChange={handleStateChange}
        />
      </div>
      {sessionUserId ? <CheckInMakeupEntry previewMode={previewMode} /> : null}
      <CheckInHistoryDialog initialDate={todayValue} previewMode={previewMode} />
      <TodayRegistrationFeePanel initialBalance={stats.points} previewMode={previewMode} />
    </section>
  )
}

export function createCheckInLayoutModules({
  activeUsers,
  todayCount,
  totalCheckIns,
  todayCheckIn,
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
  stats,
  checkinMoodEnabled = true,
  previewMode = false,
  focusMessageId,
  focusCommentId,
  focusErrorKind,
}: CheckInLayoutModuleProps): Record<string, PageLayoutModuleRenderer> {
  // 管理员（ADMIN / SUPER_ADMIN）可在挂号页删除留言；仅控制按钮展示，接口侧仍独立鉴权。
  const canManageMessages = sessionUserRole === 'ADMIN' || sessionUserRole === 'SUPER_ADMIN'
  return {
        'checkin.header': (layoutItem, { density }) => (
          <CheckInStatusContent
            title={layoutItem.title || '每日挂号'}
            density={density}
            activeUsers={activeUsers}
            initialTodayCount={todayCount}
            initialTotalCheckIns={totalCheckIns}
            initialCheckIn={todayCheckIn}
            initialStats={stats}
            todayValue={todayValue}
            sessionUserId={sessionUserId}
            previewMode={previewMode}
            checkinMoodEnabled={checkinMoodEnabled}
          />
        ),
        'checkin.publicMessages': (layoutItem, { density }) => (
          <CheckInMessagesPanel
            title={publicMessagesTitle(layoutItem.title)}
            density={density}
            scope="public"
            initialMessages={selectedMessages}
            initialPagination={selectedMessagesPagination}
            initialDate={selectedDateValue}
            maxDate={todayValue}
            initialSort={sort}
            sessionUserId={sessionUserId}
            previewMode={previewMode}
            focusMessageId={focusMessageId}
            focusCommentId={focusCommentId}
            focusErrorKind={focusErrorKind}
            canManageMessages={canManageMessages}
          />
        ),
        'checkin.friendMessages': (layoutItem, { density }) => (
          <CheckInMessagesPanel
            title={layoutItem.title ?? '好友挂号留言'}
            density={density}
            scope="friends"
            initialMessages={friendMessages}
            initialPagination={friendMessagesPagination}
            initialFollowedUserIds={friendFollowedUserIds}
            initialDate={selectedDateValue}
            maxDate={todayValue}
            initialSort={sort}
            sessionUserId={sessionUserId}
            previewMode={previewMode}
            emptyText="暂无好友挂号留言"
            canManageMessages={canManageMessages}
          />
        ),

  }
}

export function CheckInLayoutSurface(props: CheckInLayoutModuleProps & { layoutConfig: PageLayoutConfig }) {
  const modules = createCheckInLayoutModules(props)
  return (
    <CheckInLikeProvider>
      <PageLayoutRenderer
        pageKey="checkin"
        config={props.layoutConfig}
        modules={modules}
      />
    </CheckInLikeProvider>
  )
}
