import Link from 'next/link'
import { MusicArchiveShell } from '@/components/music/MusicArchiveShell'
import { MusicConcertTimeline } from '@/components/music/MusicConcertTimeline'
import { ConcertCategoryCards } from '@/components/music/ConcertCategoryCards'
import { firstPosterUrl, resolveConcertPoster } from '@/lib/music-concert-poster'
import { prisma } from '@/lib/prisma'
import { getCurrentUser } from '@/lib/auth'
import { getEnabledConcertCategories } from '@/lib/music-concert-category'
import { getSiteAppearance } from '@/lib/site-config'
import { toPublicMediaUrl } from '@/lib/media-url'

export const dynamic = 'force-dynamic'

export default async function MusicConcertsPage() {
  const sessionUser = await getCurrentUser().catch(() => null)
  const isAdmin = Boolean(sessionUser) && (sessionUser?.role === 'ADMIN' || sessionUser?.role === 'SUPER_ADMIN')
  const [tours, config, categories] = await Promise.all([
    prisma.musicTour.findMany({
      where: isAdmin ? {} : { status: 'PUBLISHED' },
      orderBy: [{ sortOrder: 'asc' }, { startDate: 'asc' }, { createdAt: 'asc' }],
      include: {
        MusicConcert: {
          where: isAdmin ? {} : { status: 'PUBLISHED' },
          orderBy: [{ concertDate: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
          select: { city: true, posterUrl: true },
        },
        _count: { select: { MusicConcert: isAdmin ? {} : { where: { status: 'PUBLISHED' } } } },
      },
    }),
    getSiteAppearance(),
    getEnabledConcertCategories().catch(() => []),
  ])
  const timeline = tours.map(({ MusicConcert, _count, ...tour }) => ({
    ...tour,
    posterUrl: toPublicMediaUrl(tour.posterUrl),
    ...resolveConcertPoster({ posterUrl: tour.posterUrl, cityPosterUrl: firstPosterUrl(MusicConcert.map((concert) => concert.posterUrl)) }),
    concertCount: _count.MusicConcert,
    cities: [...new Set(MusicConcert.map((concert) => concert.city))],
  }))
  return <MusicArchiveShell maxWidth="max-w-6xl" backgroundVisual={config.heroVisuals.music}>
    <div className="mb-3 flex justify-end"><Link href="/music/concerts/contribute" className="border border-sky-300/25 bg-sky-300/[0.08] px-4 py-2 text-sm font-black text-sky-100">提供资料</Link></div>
    <div className="flex flex-wrap items-center justify-between gap-3"><Link href="/music" className="text-sm font-black text-sky-300/80">← 返回 EasMusic</Link><Link href="/music/live/me" className="rounded-full border border-sky-200/20 bg-sky-200/[0.07] px-4 py-2 text-sm font-black text-sky-100">我的现场 →</Link></div>
    <header className="py-12 sm:py-16">
      <p className="text-xs font-black tracking-[0.24em] text-sky-300/70">EASON IN CONCERT ARCHIVE</p>
      <h1 className="mt-4 text-5xl font-black tracking-tight text-white sm:text-7xl">Eason in Concert</h1>
      <p className="mt-5 max-w-3xl text-sm font-bold leading-7 text-slate-300/70 sm:text-base">以互动海报档案收录巡演、演出场次、现场歌单与特别时刻。</p>
    </header>
    <section className="mt-10" aria-label="演唱会分类">
      <ConcertCategoryCards categories={categories} />
    </section>
    {timeline.length ? <MusicConcertTimeline tours={timeline} isAdmin={isAdmin} categories={categories} /> : <p className="rounded-[26px] border border-white/10 bg-white/[0.05] p-8 text-sm font-bold text-slate-300/65">演唱会档案正在整理中。</p>}
    <footer className="relative mt-16 overflow-hidden rounded-[28px] border border-sky-300/15 bg-[radial-gradient(circle_at_center,rgba(56,189,248,.13),transparent_70%)] px-6 py-12 text-center">
      <div className="mx-auto size-2 rounded-full bg-sky-200 shadow-[0_0_30px_rgba(125,211,252,.8)]" />
      <p className="mt-5 text-xs font-black tracking-[0.35em] text-sky-300/55">THE ARCHIVE CONTINUES</p>
      <strong className="mt-3 block text-2xl font-black text-white">未完待续...</strong>
      <span className="mt-2 block text-sm font-bold text-slate-300/55">每一场新的现场，都将成为下一页档案。</span>
    </footer>
  </MusicArchiveShell>
}
