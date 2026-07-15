'use client'

import { BeijingClock } from '@/components/BeijingClock'
import { CheckInButton } from '@/components/CheckInButton'
import { CheckInMessagesPanel } from '@/components/CheckInMessagesPanel'
import { PageLayoutRenderer } from '@/components/page-layout/PageLayoutRenderer'
import type { PageLayoutModuleDensity } from '@/components/page-layout/PageLayoutRenderer'
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
}

function densityCardClass(density: PageLayoutModuleDensity) {
  if (density === 'minimal') return 'checkin-layout-card rounded-[18px] border border-sky-100 bg-white/85 shadow-sm'
  if (density === 'compact') return 'checkin-layout-card rounded-[22px] border border-sky-100 bg-white/85 shadow-sm'
  return 'checkin-layout-card rounded-[24px] border border-sky-100 bg-white/85 shadow-sm'
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
  friendMessages,
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
        'checkin.header': (layoutItem, { density }) => (
          <section className={densityCardClass(density)}>
            {density !== 'minimal' ? <p className="text-xs font-black uppercase tracking-[0.16em] text-brand-700">Daily Clinic</p> : null}
            <h1 className={density === 'minimal' ? 'truncate text-lg font-black leading-tight text-brand-950' : 'mt-1 text-2xl font-black leading-tight text-brand-950 sm:text-[1.65rem]'}>
              {layoutItem.title || '每日挂号'}
            </h1>
            {density === 'normal' ? (
              <p className="checkin-layout-card-compact-text mt-2 line-clamp-2 text-xs font-bold leading-5 text-slate-600 sm:text-sm">{layoutItem.subtitle || dailyQuote}</p>
            ) : null}
            <div className={density === 'minimal' ? 'mt-auto flex items-center justify-between gap-2 rounded-xl bg-sky-50/75 px-2 py-1.5' : 'mt-auto rounded-2xl bg-sky-50/75 p-3'}>
              <p className="text-xs font-black text-slate-500">北京时间</p>
              <p className={density === 'minimal' ? 'text-sm font-black text-brand-950' : 'mt-0.5 text-xl font-black text-brand-950'}><BeijingClock /></p>
            </div>
          </section>
        ),
        'checkin.stats': (_layoutItem, { density }) => (
          <section className={densityCardClass(density)}>
            {(() => {
              const items = [
                ['医院人数', `${activeUsers}`],
                ['今日挂号', `${todayCount}`],
                ['连续天数', `${consecutiveDays}`],
                ['累计天数', `${totalCheckIns}`],
                ['情绪指数', moodIndex ? `${moodIndex}/100` : '待生成'],
              ]
              if (density === 'minimal') {
                return (
                  <div className="grid min-h-0 flex-1 grid-cols-4 items-center gap-1">
                    {items.slice(0, 4).map(([label, value]) => (
                      <div key={label} className="min-w-0 rounded-xl bg-sky-50/75 px-1.5 py-1 text-center">
                        <p className="truncate text-[10px] font-black leading-tight text-slate-500">{label}</p>
                        <p className="truncate text-sm font-black leading-tight text-brand-950">{value}</p>
                      </div>
                    ))}
                  </div>
                )
              }
              return (
                <div className={`grid min-h-0 flex-1 auto-rows-fr gap-2 ${density === 'compact' ? 'grid-cols-2 sm:grid-cols-3' : 'sm:grid-cols-2'}`}>
                  {items.map(([label, value]) => (
                    <div key={label} className={density === 'compact' ? 'min-h-0 rounded-2xl bg-sky-50/75 p-2' : 'min-h-0 rounded-2xl bg-sky-50/75 p-2.5'}>
                      <p className="truncate text-[11px] font-black text-slate-500">{label}</p>
                      <p className={density === 'compact' ? 'truncate text-base font-black leading-tight text-brand-950' : 'mt-0.5 truncate text-lg font-black leading-tight text-brand-950 sm:text-xl'}>{value}</p>
                    </div>
                  ))}
                </div>
              )
            })()}
          </section>
        ),
        'checkin.today': (layoutItem, { density }) => (
          <section className={densityCardClass(density)}>
            {density !== 'minimal' ? <p className="text-xs font-black uppercase text-brand-700">{todayCheckIn ? 'Today Mood' : 'Check-in'}</p> : null}
            <h2 className={density === 'minimal' ? 'truncate text-lg font-black leading-tight text-brand-950' : 'mt-1 text-2xl font-black leading-tight text-brand-950 sm:text-[1.65rem]'}>
              {layoutItem.title || '今日挂号'}
            </h2>
            {layoutItem.subtitle && density === 'normal' ? <p className="checkin-layout-card-compact-text mt-1 line-clamp-1 text-xs font-bold leading-5 text-slate-600">{layoutItem.subtitle}</p> : null}
            <div className={density === 'minimal' ? 'mt-1 min-h-0 flex-1 overflow-hidden' : 'mt-3 min-h-0 flex-1 overflow-hidden'}>
              <CheckInButton initialCheckIn={todayCheckIn} initialStats={stats} compact={density !== 'normal'} density={density} />
            </div>
          </section>
        ),
        'checkin.messages': (layoutItem, { density }) => (
          <div className="grid gap-4 xl:grid-cols-2">
            <CheckInMessagesPanel
              title={layoutItem.title || 'E友留言'}
              density={density}
              anonymous
              initialMessages={selectedMessages}
              initialDate={selectedDateValue}
              maxDate={todayValue}
              initialSort={sort}
              sessionUserId={sessionUserId}
              sessionUserRole={sessionUserRole}
            />
            <CheckInMessagesPanel
              title="好友挂号留言"
              density={density}
              initialMessages={friendMessages}
              initialDate={selectedDateValue}
              maxDate={todayValue}
              initialSort={sort}
              sessionUserId={sessionUserId}
              sessionUserRole={sessionUserRole}
              emptyText="今天还没有好友留言。"
            />
          </div>
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
            emptyText="今天还没有好友留言。"
          />
        ),
      }}
    />
  )
}
