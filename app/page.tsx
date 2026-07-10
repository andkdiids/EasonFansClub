import Link from 'next/link'
import { redirect } from 'next/navigation'
import { HomeHero } from '@/components/HomeHero'
import { PostList } from '@/components/PostList'
import { SiteHeader } from '@/components/SiteHeader'
import { getCurrentUser } from '@/lib/auth'
import { startOfLocalDay } from '@/lib/checkin'
import { getMood } from '@/lib/daily'
import { prisma } from '@/lib/prisma'
import { isAdminRole } from '@/lib/security'
import { getSiteAppearance } from '@/lib/site-config'

export const dynamic = 'force-dynamic'

async function getHomeData(userId: string) {
  const today = startOfLocalDay()
  const [hotPosts, dailyMessages, activities, tracks] = await Promise.all([
    prisma.post.findMany({
      where: { isDeleted: false, status: 'PUBLISHED', author: { status: 'ACTIVE', isDeleted: false, profile: { isNot: null } } },
      orderBy: [{ isPinned: 'desc' }, { isFeatured: 'desc' }, { likeCount: 'desc' }, { replyCount: 'desc' }],
      take: 6,
      include: {
        author: { select: { uid: true, nickname: true, avatarUrl: true, level: true, profile: true } },
        board: { select: { name: true, slug: true } },
        favorites: { where: { userId }, select: { id: true } },
      },
    }),
    prisma.dailyMessage.findMany({
      where: { date: today, isDeleted: false, user: { status: 'ACTIVE', isDeleted: false, profile: { isNot: null } } },
      orderBy: [{ isFeatured: 'desc' }, { likeCount: 'desc' }, { createdAt: 'desc' }],
      take: 4,
      include: { user: { select: { uid: true, nickname: true, level: true, profile: true } } },
    }),
    prisma.activity.findMany({
      where: { status: 'PUBLISHED' },
      orderBy: { createdAt: 'desc' },
      take: 3,
    }),
    prisma.musicTrack.findMany({
      where: { isVisible: true },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
      take: 4,
    }),
  ])
  return { hotPosts, dailyMessages, activities, tracks }
}

export default async function HomePage() {
  const user = await getCurrentUser()
  if (!user) redirect('/login')

  const [config, data] = await Promise.all([getSiteAppearance(), getHomeData(user.id)])

  return (
    <>
      <SiteHeader />
      <main
        className="space-y-20 px-5 py-8"
        style={{
          background: `linear-gradient(180deg, ${config.colors.background}, #ffffff 42%, #eff9ff)`,
          color: config.colors.text,
        }}
      >
        <div className="mx-auto max-w-7xl">
          <HomeHero slides={config.heroSlides} />
        </div>

        <section className="mx-auto grid max-w-6xl gap-6 md:grid-cols-3">
          {[
            ['今日挂号', config.text.checkinCopy, '/checkin'],
            ['E院广场', config.text.forumCopy, '/boards/announcements'],
            ['EasMusic', config.text.musicCopy, '/music'],
          ].map(([title, copy, href]) => (
            <Link key={href} href={href} className="rounded-[30px] bg-white/78 p-8 shadow-xl shadow-sky-900/5 backdrop-blur transition hover:-translate-y-1">
              <h2 className="text-3xl font-black text-brand-950">{title}</h2>
              <p className="mt-4 min-h-16 text-lg font-bold leading-8 text-slate-600">{copy}</p>
              <span className="mt-8 inline-flex rounded-full bg-sky-50 px-4 py-2 text-sm font-black text-brand-700">打开</span>
            </Link>
          ))}
        </section>

        <section className="mx-auto max-w-6xl space-y-5">
          <div className="flex items-end justify-between gap-4">
            <div>
              <p className="text-sm font-black uppercase tracking-[0.22em] text-sky-700">Forum</p>
              <h2 className="mt-2 text-4xl font-black text-brand-950">E院广场精选</h2>
            </div>
            <Link href="/posts/new" className="rounded-full bg-brand-950 px-5 py-3 text-sm font-black text-white">发布帖子</Link>
          </div>
          <PostList posts={data.hotPosts} canManage={isAdminRole(user.role)} />
        </section>

        <section className="mx-auto grid max-w-6xl gap-6 lg:grid-cols-[1fr_0.9fr]">
          <div className="rounded-[32px] bg-white/78 p-8 shadow-xl shadow-sky-900/5 backdrop-blur">
            <p className="text-sm font-black uppercase tracking-[0.22em] text-sky-700">Daily</p>
            <h2 className="mt-2 text-4xl font-black text-brand-950">E友留言精选</h2>
            <div className="mt-6 space-y-3">
              {data.dailyMessages.length ? data.dailyMessages.map((item) => {
                const mood = getMood(item.mood)
                const name = item.user.profile?.displayName || item.user.nickname
                return (
                  <article key={item.id} className="rounded-3xl bg-sky-50/80 p-5">
                    <p className="font-black text-brand-950">{mood?.icon || '🎵'} {name} · Lv.{item.user.level}</p>
                    <p className="mt-2 line-clamp-2 leading-7 text-slate-600">{item.content}</p>
                  </article>
                )
              }) : (
                <p className="rounded-3xl bg-sky-50/80 p-5 text-sm font-bold text-slate-500">{config.text.emptyText}</p>
              )}
            </div>
          </div>

          <div className="space-y-6">
            <div className="rounded-[32px] bg-white/78 p-8 shadow-xl shadow-sky-900/5 backdrop-blur">
              <p className="text-sm font-black uppercase tracking-[0.22em] text-sky-700">Music</p>
              <h2 className="mt-2 text-4xl font-black text-brand-950">EasMusic</h2>
              <div className="mt-6 grid gap-3">
                {data.tracks.map((track) => (
                  <Link key={track.id} href="/music" className="rounded-2xl bg-sky-50/80 p-4 font-black text-slate-700">
                    {track.title}
                  </Link>
                ))}
              </div>
            </div>

            <div className="rounded-[32px] bg-white/78 p-8 shadow-xl shadow-sky-900/5 backdrop-blur">
              <p className="text-sm font-black uppercase tracking-[0.22em] text-sky-700">Activities</p>
              <h2 className="mt-2 text-4xl font-black text-brand-950">活动中心</h2>
              <p className="mt-4 text-lg font-bold leading-8 text-slate-600">
                {data.activities[0]?.title || '下一场活动，正在准备。'}
              </p>
            </div>
          </div>
        </section>

        <footer className="mx-auto max-w-6xl pb-10 text-center text-sm font-bold text-slate-500">
          {config.text.footerText}
        </footer>
      </main>
    </>
  )
}
