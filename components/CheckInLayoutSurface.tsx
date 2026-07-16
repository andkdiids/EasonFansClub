'use client'

import { BeijingClock } from '@/components/BeijingClock'
import { useCallback, useEffect, useState } from 'react'
import { CheckInButton, type CheckInStateChange, type CheckInStats, type TodayCheckIn } from '@/components/CheckInButton'
import { CheckInMessagesPanel } from '@/components/CheckInMessagesPanel'
import { PageLayoutRenderer } from '@/components/page-layout/PageLayoutRenderer'
import type {
  PageLayoutModuleDensity,
  PageLayoutModuleRenderer,
} from '@/components/page-layout/PageLayoutRenderer'
import type { CheckInMessageItem, CheckInMessageSort } from '@/lib/checkin-messages'
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
  selectedMessages: CheckInMessageItem[]
  friendMessages: CheckInMessageItem[]
  selectedDateValue: string
  todayValue: string
  sort: CheckInMessageSort
  sessionUserId: string
  sessionUserRole: string
  stats: {
    level: number
    points: number
    exp: number
    consecutiveDays: number
  }
  previewMode?: boolean
}

function densityCardClass(density: PageLayoutModuleDensity) {
  if (density === 'minimal') return 'checkin-layout-card rounded-[18px] border border-sky-100 bg-white/85 shadow-sm'
  if (density === 'compact') return 'checkin-layout-card rounded-[22px] border border-sky-100 bg-white/85 shadow-sm'
  return 'checkin-layout-card rounded-[24px] border border-sky-100 bg-white/85 shadow-sm'
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
    ['医院人数', activeUsers],
    ['今日挂号', todayCount],
    ['连续天数', consecutiveDays],
    ['累计天数', totalCheckIns],
  ] as const
  return (
    <div data-checkin-stats-grid="true" className={`grid gap-2 ${density === 'minimal' ? 'grid-cols-4' : 'grid-cols-2 sm:grid-cols-4'}`}>
      {items.map(([label, value]) => (
        <div key={label} className="rounded-2xl bg-sky-50/75 p-2.5 text-center">
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
  previewMode,
}: Readonly<{
  title: string
  density: PageLayoutModuleDensity
  activeUsers: number
  initialTodayCount: number
  initialTotalCheckIns: number
  initialCheckIn: TodayCheckInPayload
  initialStats: CheckInStats
  previewMode: boolean
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
          onStateChange={handleStateChange}
        />
      </div>
    </section>
  )
}

export function createCheckInLayoutModules({
  activeUsers,
  todayCount,
  totalCheckIns,
  todayCheckIn,
  selectedMessages,
  friendMessages,
  selectedDateValue,
  todayValue,
  sort,
  sessionUserId,
  sessionUserRole,
  stats,
  previewMode = false,
}: CheckInLayoutModuleProps): Record<string, PageLayoutModuleRenderer> {
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
            previewMode={previewMode}
          />
        ),
        'checkin.publicMessages': (layoutItem, { density }) => (
          <CheckInMessagesPanel
            title={layoutItem.title ?? undefined}
            density={density}
            anonymous
            initialMessages={selectedMessages}
            initialDate={selectedDateValue}
            maxDate={todayValue}
            initialSort={sort}
            sessionUserId={sessionUserId}
            sessionUserRole={sessionUserRole}
            previewMode={previewMode}
          />
        ),
        'checkin.friendMessages': (layoutItem, { density }) => (
          <CheckInMessagesPanel
            title={layoutItem.title ?? '好友挂号留言'}
            density={density}
            initialMessages={friendMessages}
            initialDate={selectedDateValue}
            maxDate={todayValue}
            initialSort={sort}
            sessionUserId={sessionUserId}
            sessionUserRole={sessionUserRole}
            previewMode={previewMode}
            emptyText="今天还没有好友留言。"
          />
        ),

  }
}

export function CheckInLayoutSurface(props: CheckInLayoutModuleProps & { layoutConfig: PageLayoutConfig }) {
  const modules = createCheckInLayoutModules(props)
  return (
    <PageLayoutRenderer
      pageKey="checkin"
      config={props.layoutConfig}
      modules={modules}
    />
  )
}
