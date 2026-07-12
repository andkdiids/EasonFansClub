import { redirect } from 'next/navigation'
import { BeijingClock } from '@/components/BeijingClock'
import { CheckInButton } from '@/components/CheckInButton'
import { DailyMessageActions } from '@/components/DailyMessageActions'
import { DeleteCommentButton } from '@/components/DeleteCommentButton'
import { SiteHeader } from '@/components/SiteHeader'
import { getCurrentUser } from '@/lib/auth'
import { isSameLocalDay, startOfLocalDay } from '@/lib/checkin'
import { DAILY_MOODS, calcMoodIndex, getDailyQuote, getMood } from '@/lib/daily'
import { safeDb, withDbTimeout } from '@/lib/db-timeout'
import { publicImageUrl } from '@/lib/images'
import { prisma } from '@/lib/prisma'
import { isAdminRole } from '@/lib/security'
import { formatUid } from '@/lib/uid'

export const dynamic = 'force-dynamic'

function beijingDateTime(date: Date) {
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(date)
}

function parseDate(value?: string) {
  if (!value) return startOfLocalDay()
  const date = new Date(`${value}T00:00:00+08:00`)
  const today = startOfLocalDay()
  const yearAgo = new Date(today.getFullYear() - 1, today.getMonth(), today.getDate())
  if (Number.isNaN(date.getTime()) || date > today || date < yearAgo) return today
  return startOfLocalDay(date)
}

export default async function CheckInPage({ searchParams }: { searchParams: Promise<{ date?: string; sort?: string }> }) {
  const sessionUser = await getCurrentUser()
  if (!sessionUser) redirect('/login')

  const params = await searchParams
  const selectedDate = parseDate(params.date)
  const nextDate = new Date(selectedDate.getFullYear(), selectedDate.getMonth(), selectedDate.getDate() + 1)
  const today = startOfLocalDay()
  const sort = params.sort === 'hot' ? 'hot' : 'latest'

  const user = await withDbTimeout(
    'checkin.user',
    prisma.user.findUnique({
      where: { id: sessionUser.id },
      select: { points: true, exp: true, level: true, consecutiveDays: true, lastCheckInDate: true },
    }),
  )
  const activeUsers = await safeDb(
    'checkin.activeUsers',
    prisma.user.count({ where: { status: 'ACTIVE', isDeleted: false, profile: { isNot: null } } }),
    0,
  )
  const todayCount = await safeDb('checkin.todayCount', prisma.checkIn.count({ where: { checkDate: today } }), 0)
  const selectedMessages = await safeDb(
    'checkin.messages',
    prisma.dailyMessage.findMany({
      where: {
        date: { gte: selectedDate, lt: nextDate },
        isDeleted: false,
        user: { status: 'ACTIVE', isDeleted: false, profile: { isNot: null } },
      },
      orderBy: sort === 'hot'
        ? [{ isPinned: 'desc' }, { isFeatured: 'desc' }, { likeCount: 'desc' }, { commentCount: 'desc' }, { createdAt: 'desc' }]
        : [{ isPinned: 'desc' }, { isFeatured: 'desc' }, { createdAt: 'desc' }],
      take: 30,
      include: {
        user: { select: { uid: true, nickname: true, avatarUrl: true, level: true, profile: true } },
        likes: { where: { userId: sessionUser.id }, select: { id: true } },
        favorites: { where: { userId: sessionUser.id }, select: { id: true } },
        comments: {
          where: { isDeleted: false, parentId: null },
          orderBy: { createdAt: 'desc' },
          take: 3,
          include: { author: { select: { id: true, uid: true, nickname: true, level: true, profile: true } } },
        },
      },
    }),
    [],
  )
  const moodStats = await safeDb(
    'checkin.moodStats',
    prisma.checkIn.groupBy({
      by: ['mood'],
      where: { checkDate: today, mood: { not: null } },
      _count: { mood: true },
    }),
    [],
  )
  const totalCheckIns = await safeDb('checkin.totalCheckIns', prisma.checkIn.count({ where: { userId: sessionUser.id } }), 0)

  if (!user) redirect('/login')

  const checkedToday = isSameLocalDay(user.lastCheckInDate)
  const moodCountMap = new Map(moodStats.map((item) => [item.mood || '', item._count.mood]))
  const moodIndex = calcMoodIndex(moodStats.map((item) => ({ mood: item.mood || '', _count: { mood: item._count.mood } })))
  const selectedDateValue = selectedDate.toISOString().slice(0, 10)

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
          <div className="rounded-[28px] border border-sky-100 bg-white/85 p-6 shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-sm font-black uppercase text-brand-700">E Friends Messages</p>
                <h2 className="mt-2 text-3xl font-black text-brand-950">E友留言</h2>
              </div>
              <form className="flex flex-wrap gap-2" action="/checkin">
                <input name="date" type="date" defaultValue={selectedDateValue} max={today.toISOString().slice(0, 10)} className="rounded-full border border-sky-100 px-4 py-2 text-sm font-bold outline-none" />
                <select name="sort" defaultValue={sort} className="rounded-full border border-sky-100 px-4 py-2 text-sm font-bold outline-none">
                  <option value="latest">最新</option>
                  <option value="hot">热度</option>
                </select>
                <button className="rounded-full bg-brand-700 px-4 py-2 text-sm font-black text-white">查看</button>
              </form>
            </div>

            <div className="mt-6 space-y-5">
              {selectedMessages.length ? selectedMessages.map((item) => {
                const mood = getMood(item.mood)
                const name = item.user.profile?.displayName || item.user.nickname
                const avatar = publicImageUrl(item.user.profile?.avatarUrl || item.user.avatarUrl)
                return (
                  <article key={item.id} className="rounded-3xl border border-sky-100 bg-white p-5 shadow-sm">
                    <div className="flex gap-4">
                      <a href={`/user/${formatUid(item.user.uid)}`} className="grid h-12 w-12 shrink-0 place-items-center overflow-hidden rounded-2xl bg-sky-50 text-2xl">
                        {avatar ? <img src={avatar} alt={name} className="h-full w-full object-cover" /> : mood?.icon || '🎵'}
                      </a>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <a href={`/user/${formatUid(item.user.uid)}`} className="font-black text-brand-950">{name}</a>
                          <span className="rounded-full bg-sky-50 px-2 py-1 text-xs font-black text-brand-700">UID {formatUid(item.user.uid)}</span>
                          <span className="rounded-full bg-sky-50 px-2 py-1 text-xs font-black text-brand-700">{mood?.icon} {mood?.label}</span>
                          <span className="text-xs font-bold text-slate-400">留言日 {selectedDateValue}</span>
                          <span className="text-xs font-bold text-slate-400">发布 {beijingDateTime(item.createdAt)}</span>
                        </div>
                        <p className="mt-3 whitespace-pre-wrap leading-8 text-slate-700">{item.content}</p>
                        {item.comments.length ? (
                          <div className="mt-4 space-y-2 rounded-2xl bg-sky-50/70 p-3">
                            {item.comments.map((comment) => (
                              <div key={comment.id} className="text-sm leading-6 text-slate-600">
                                <strong className="text-brand-950">{comment.author.profile?.displayName || comment.author.nickname}：</strong>
                                {comment.content}
                                {sessionUser.id === comment.author.id || isAdminRole(sessionUser.role) ? (
                                  <span className="ml-2">
                                    <DeleteCommentButton endpoint={`/api/daily-message-comments/${comment.id}`} />
                                  </span>
                                ) : null}
                              </div>
                            ))}
                          </div>
                        ) : null}
                        <DailyMessageActions
                          messageId={item.id}
                          likeCount={item.likeCount}
                          favoriteCount={item.favoriteCount}
                          commentCount={item.commentCount}
                          initialLiked={item.likes.length > 0}
                          initialFavorited={item.favorites.length > 0}
                        />
                      </div>
                    </div>
                  </article>
                )
              }) : (
                <div className="rounded-2xl bg-sky-50/80 p-8 text-center font-bold text-slate-500">这一天还没有 E友留言。</div>
              )}
            </div>
          </div>

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
