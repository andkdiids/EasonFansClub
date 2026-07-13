import { redirect } from 'next/navigation'
import { BeijingClock } from '@/components/BeijingClock'
import { CheckInButton } from '@/components/CheckInButton'
import { CheckInMessagesPanel } from '@/components/CheckInMessagesPanel'
import { SiteHeader } from '@/components/SiteHeader'
import { getCurrentUser } from '@/lib/auth'
import { formatBeijingDate, isSameLocalDay, parseBeijingDate, startOfLocalDay } from '@/lib/checkin'
import { getCheckInMessages, type CheckInMessageSort } from '@/lib/checkin-messages'
import { DAILY_MOODS, calcMoodIndex, getDailyQuote } from '@/lib/daily'
import { safeDb, withDbTimeout } from '@/lib/db-timeout'
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

  let user
  let activeUsers = 0
  let todayCount = 0
  let selectedMessages: Awaited<ReturnType<typeof getCheckInMessages>> = []
  let moodStats: Array<{ mood: string | null; _count: { mood: number } }> = []
  let totalCheckIns = 0
  const queryStart = Date.now()
  try {
    ;[
      user,
      activeUsers,
      todayCount,
      selectedMessages,
      moodStats,
      totalCheckIns,
    ] = await Promise.all([
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
      safeDb('CheckIn.count checkin.todayCount', prisma.checkIn.count({ where: { checkDate: today } }), 0),
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
  } catch (error) {
    console.error('[checkin] prisma query failed', {
      model: 'User',
      query: 'findUnique',
      feature: 'checkin.user',
      where: ['id=sessionUser.id'],
    }, error)
    throw error
  }
  console.info('[perf]', { metric: 'page.checkin.total.ms', ms: Date.now() - pageStart })

  if (!user) redirect('/login')

  const checkedToday = isSameLocalDay(user.lastCheckInDate)
  const moodCountMap = new Map(moodStats.map((item) => [item.mood || '', item._count.mood]))
  const moodIndex = calcMoodIndex(moodStats.map((item) => ({ mood: item.mood || '', _count: { mood: item._count.mood } })))
  const selectedDateValue = formatBeijingDate(selectedDate)
  const todayValue = formatBeijingDate(today)

  return (
    <>
      <SiteHeader user={sessionUser} />
      <main className="mx-auto max-w-6xl space-y-6 px-5 py-6">
        <section className="rounded-[28px] border border-sky-100 bg-white/85 p-7 shadow-sm">
          <p className="text-sm font-black uppercase tracking-[0.22em] text-brand-700">Daily Clinic</p>
          <div className="mt-3 grid gap-6 lg:grid-cols-[1fr_360px] lg:items-end">
            <div>
              <h1 className="text-4xl font-black text-brand-950 md:text-6xl">每日挂号</h1>
              <p className="mt-4 max-w-2xl leading-8 text-slate-600">{getDailyQuote(today)}</p>
            </div>
            <div className="rounded-2xl bg-sky-50/75 p-5">
              <p className="text-sm font-black text-slate-500">北京时间</p>
              <p className="mt-2 text-2xl font-black text-brand-950"><BeijingClock /></p>
            </div>
          </div>

          <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            {[
              ['E院病友人数', `${activeUsers} 人`],
              ['今日挂号人数', `${todayCount} 人`],
              ['连续挂号天数', `${user.consecutiveDays} 天`],
              ['累计挂号天数', `${totalCheckIns} 天`],
              ['今日情绪指数', moodIndex ? `${moodIndex}/100` : '待生成'],
            ].map(([label, value]) => (
              <div key={label} className="rounded-2xl bg-sky-50/75 p-4">
                <p className="text-xs font-black text-slate-500">{label}</p>
                <p className="mt-2 text-2xl font-black text-brand-950">{value}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="rounded-[28px] border border-sky-100 bg-white/85 p-6 shadow-sm">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-sm font-black uppercase text-brand-700">Check-in</p>
              <h2 className="mt-2 text-3xl font-black text-brand-950">今日挂号</h2>
            </div>
            <span className="rounded-full bg-sky-50 px-4 py-2 text-sm font-black text-brand-700">
              Lv.{user.level} · {user.points} 积分 · {user.exp} 经验
            </span>
          </div>
          <div className="mt-6">
            <CheckInButton checkedToday={checkedToday} />
          </div>
        </section>

        <section className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
          <CheckInMessagesPanel
            initialMessages={selectedMessages}
            initialDate={selectedDateValue}
            maxDate={todayValue}
            initialSort={sort}
            sessionUserId={sessionUser.id}
            sessionUserRole={sessionUser.role}
          />
          <aside className="rounded-[28px] border border-sky-100 bg-white/85 p-6 shadow-sm">
            <h2 className="text-2xl font-black text-brand-950">今日心情</h2>
            <div className="mt-5 space-y-3">
              {DAILY_MOODS.map((mood) => {
                const count = moodCountMap.get(mood.key) || 0
                const max = Math.max(todayCount, 1)
                return (
                  <div key={mood.key}>
                    <div className="flex items-center justify-between text-sm font-black text-slate-600">
                      <span>{mood.icon} {mood.label}</span>
                      <span>{count} 人</span>
                    </div>
                    <div className="mt-2 h-2 rounded-full bg-sky-50">
                      <div className="h-2 rounded-full bg-brand-500" style={{ width: `${Math.round((count / max) * 100)}%` }} />
                    </div>
                  </div>
                )
              })}
            </div>
          </aside>
        </section>
      </main>
    </>
  )
}
