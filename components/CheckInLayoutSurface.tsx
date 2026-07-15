'use client'

import { BeijingClock } from '@/components/BeijingClock'
import { CheckInButton } from '@/components/CheckInButton'
import { CheckInMessagesPanel } from '@/components/CheckInMessagesPanel'
import { PageLayoutRenderer } from '@/components/page-layout/PageLayoutRenderer'
import type { CheckInMessageItem, CheckInMessageSort } from '@/lib/checkin-messages'
import type { PageLayoutConfig } from '@/lib/page-layout/types'

type TodayCheckInPayload = {
  checkDate: string
  points: number
  exp: number
  mood: string | null
  message: string | null
  streakDay: number
  createdAt: string
} | null

type CheckInLayoutSurfaceProps = {
  layoutConfig: PageLayoutConfig
  dailyQuote: string
  activeUsers: number
  todayCount: number
  consecutiveDays: number
  totalCheckIns: number
  moodIndex: number
  todayCheckIn: TodayCheckInPayload
  selectedMessages: CheckInMessageItem[]
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
}

export function CheckInLayoutSurface({
  layoutConfig,
  dailyQuote,
  activeUsers,
  todayCount,
  consecutiveDays,
  totalCheckIns,
  moodIndex,
  todayCheckIn,
  selectedMessages,
  selectedDateValue,
  todayValue,
  sort,
  sessionUserId,
  sessionUserRole,
  stats,
}: CheckInLayoutSurfaceProps) {
  return (
    <PageLayoutRenderer
      pageKey="checkin"
      config={layoutConfig}
      modules={{
        'checkin.header': (layoutItem) => (
          <section className="layout-card rounded-[28px] border border-sky-100 bg-white/85 shadow-sm">
            <p className="text-sm font-black uppercase tracking-[0.2em] text-brand-700">Daily Clinic</p>
            <h1 className="mt-2 text-3xl font-black text-brand-950">{layoutItem.title || '每日挂号'}</h1>
            <p className="mt-3 text-sm font-bold leading-7 text-slate-600">{layoutItem.subtitle || dailyQuote}</p>
            <div className="mt-5 rounded-2xl bg-sky-50/75 p-4">
              <p className="text-xs font-black text-slate-500">北京时间</p>
              <p className="mt-1 text-2xl font-black text-brand-950"><BeijingClock /></p>
            </div>
          </section>
        ),
        'checkin.stats': (
          <section className="layout-card rounded-[28px] border border-sky-100 bg-white/85 shadow-sm">
            <div className="grid gap-3 sm:grid-cols-2">
              {[
                ['E院病友人数', `${activeUsers} 人`],
                ['今日挂号人数', `${todayCount} 人`],
                ['连续挂号天数', `${consecutiveDays} 天`],
                ['累计挂号天数', `${totalCheckIns} 天`],
                ['今日情绪指数', moodIndex ? `${moodIndex}/100` : '待生成'],
              ].map(([label, value]) => (
                <div key={label} className="rounded-2xl bg-sky-50/75 p-4">
                  <p className="text-xs font-black text-slate-500">{label}</p>
                  <p className="mt-1 text-2xl font-black text-brand-950">{value}</p>
                </div>
              ))}
            </div>
          </section>
        ),
        'checkin.formOrMood': (layoutItem) => (
          <section className="layout-card rounded-[28px] border border-sky-100 bg-white/85 shadow-sm">
            <p className="text-sm font-black uppercase text-brand-700">{todayCheckIn ? 'Today Mood' : 'Check-in'}</p>
            <h2 className="mt-2 text-3xl font-black text-brand-950">{layoutItem.title || (todayCheckIn ? '今日心情' : '今日挂号')}</h2>
            {layoutItem.subtitle ? <p className="mt-2 text-sm font-bold leading-6 text-slate-600">{layoutItem.subtitle}</p> : null}
            <div className="mt-5">
              <CheckInButton initialCheckIn={todayCheckIn} initialStats={stats} />
            </div>
          </section>
        ),
        'checkin.messages': (
          <CheckInMessagesPanel
            initialMessages={selectedMessages}
            initialDate={selectedDateValue}
            maxDate={todayValue}
            initialSort={sort}
            sessionUserId={sessionUserId}
            sessionUserRole={sessionUserRole}
          />
        ),
      }}
    />
  )
}
