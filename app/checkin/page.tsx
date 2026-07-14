import { redirect } from 'next/navigation'
import { BeijingClock } from '@/components/BeijingClock'
import { CheckInButton } from '@/components/CheckInButton'
import { CheckInMessagesPanel } from '@/components/CheckInMessagesPanel'
import { PageLayoutFrame } from '@/components/page-layout/PageLayoutFrame'
import { SiteHeader } from '@/components/SiteHeader'
import { getCurrentUser } from '@/lib/auth'
import { formatBeijingDate, parseBeijingDate, startOfLocalDay } from '@/lib/checkin'
import { getCheckInMessages, type CheckInMessageSort } from '@/lib/checkin-messages'
import { calcMoodIndex, getDailyQuote } from '@/lib/daily'
import { safeDb, withDbTimeout } from '@/lib/db-timeout'
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
  const sort: CheckInMessageSort = params.sort === 'hot' ? 'hot' : 'latest'

  const queryStart = Date.now()
  const [user, activeUsers, todayCount, todayCheckIn, selectedMessages, moodStats, totalCheckIns] = await Promise.all([
    withDbTimeout(
      'User.findUnique checkin.user',
      prisma.user.findUnique({
        where: { id: sessionUser.id },
        select: { points: true, exp: true, level: true, consecutiveDays: true },
      }),
    ),
    safeDb(
      'User.count checkin.activeUsers',
      prisma.user.count({ where: { status: 'ACTIVE', isDeleted: false, profile: { isNot: null } } }),
      0,
    ),
    safeDb('CheckIn.count checkin.todayCount', prisma.checkIn.count({ where: { checkDate: today } }), 0),
    safeDb(
      'CheckIn.findUnique checkin.todayCheckIn',
      prisma.checkIn.findUnique({
        where: { userId_checkDate: { userId: sessionUser.id, checkDate: today } },
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
    ),
    safeDb(
      'CheckIn.groupBy checkin.moodStats',
      prisma.checkIn.groupBy({
        by: ['mood'],
        where: { checkDate: today, mood: { not: null } },
        _count: { mood: true },
      }),
      [],
    ),
    safeDb('CheckIn.count checkin.totalCheckIns', prisma.checkIn.count({ where: { userId: sessionUser.id } }), 0),
  ])
  console.info('[perf]', { metric: 'page.checkin.parallelQueries.ms', ms: Date.now() - queryStart })
  console.info('[perf]', { metric: 'page.checkin.total.ms', ms: Date.now() - pageStart })

  if (!user) redirect('/login')

  const moodIndex = calcMoodIndex(moodStats.map((item) => ({ mood: item.mood || '', _count: { mood: item._count.mood } })))
  const selectedDateValue = formatBeijingDate(selectedDate)
  const todayValue = formatBeijingDate(today)
  const layoutConfig = await getPublishedPageLayoutConfig('checkin')
  const layoutModules = [...layoutConfig.desktop].filter((item) => item.visible).sort((a, b) => a.order - b.order)
  const todayCheckInPayload = todayCheckIn
    ? {
        ...todayCheckIn,
        checkDate: todayCheckIn.checkDate.toISOString(),
        createdAt: todayCheckIn.createdAt.toISOString(),
      }
    : null

  return (
    <>
      <SiteHeader user={sessionUser} />
      <main className="mx-auto flex max-w-[1500px] flex-wrap gap-x-5 px-4 py-5 sm:px-5">
        {layoutModules.map((layoutItem) => {
          if (layoutItem.key === 'checkin.header') {
            return (
              <PageLayoutFrame key={layoutItem.key} config={layoutItem}>
                <section className="layout-card rounded-[28px] border border-sky-100 bg-white/85 shadow-sm">
                  <p className="text-sm font-black uppercase tracking-[0.2em] text-brand-700">Daily Clinic</p>
                  <h1 className="mt-2 text-3xl font-black text-brand-950">{layoutItem.title || '每日挂号'}</h1>
                  <p className="mt-3 text-sm font-bold leading-7 text-slate-600">{layoutItem.subtitle || getDailyQuote(today)}</p>
                  <div className="mt-5 rounded-2xl bg-sky-50/75 p-4">
                    <p className="text-xs font-black text-slate-500">北京时间</p>
                    <p className="mt-1 text-2xl font-black text-brand-950"><BeijingClock /></p>
                  </div>
                </section>
              </PageLayoutFrame>
            )
          }

          if (layoutItem.key === 'checkin.stats') {
            return (
              <PageLayoutFrame key={layoutItem.key} config={layoutItem}>
                <section className="layout-card rounded-[28px] border border-sky-100 bg-white/85 shadow-sm">
                  <div className="grid gap-3 sm:grid-cols-2">
                    {[
                      ['E院病友人数', `${activeUsers} 人`],
                      ['今日挂号人数', `${todayCount} 人`],
                      ['连续挂号天数', `${user.consecutiveDays} 天`],
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
              </PageLayoutFrame>
            )
          }

          if (layoutItem.key === 'checkin.formOrMood') {
            return (
              <PageLayoutFrame key={layoutItem.key} config={layoutItem}>
                <section className="layout-card rounded-[28px] border border-sky-100 bg-white/85 shadow-sm">
                  <p className="text-sm font-black uppercase text-brand-700">{todayCheckIn ? 'Today Mood' : 'Check-in'}</p>
                  <h2 className="mt-2 text-3xl font-black text-brand-950">{layoutItem.title || (todayCheckIn ? '今日心情' : '今日挂号')}</h2>
                  {layoutItem.subtitle ? <p className="mt-2 text-sm font-bold leading-6 text-slate-600">{layoutItem.subtitle}</p> : null}
                  <div className="mt-5">
                    <CheckInButton
                      initialCheckIn={todayCheckInPayload}
                      initialStats={{
                        level: user.level,
                        points: user.points,
                        exp: user.exp,
                        consecutiveDays: user.consecutiveDays,
                      }}
                    />
                  </div>
                </section>
              </PageLayoutFrame>
            )
          }

          if (layoutItem.key === 'checkin.messages') {
            return (
              <PageLayoutFrame key={layoutItem.key} config={layoutItem}>
                <CheckInMessagesPanel
                  initialMessages={selectedMessages}
                  initialDate={selectedDateValue}
                  maxDate={todayValue}
                  initialSort={sort}
                  sessionUserId={sessionUser.id}
                  sessionUserRole={sessionUser.role}
                />
              </PageLayoutFrame>
            )
          }

          return null
        })}
      </main>
    </>
  )
}
