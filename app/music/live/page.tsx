import Image from 'next/image'
import Link from 'next/link'
import { MusicArchiveShell } from '@/components/music/MusicArchiveShell'
import { formatLiveDate, formatLiveDateRange } from '@/lib/music-live'
import { generateArchiveSlug, buildConcertSlugPath } from '@/lib/music-slug'
import { prisma } from '@/lib/prisma'
import { getSiteAppearance } from '@/lib/site-config'

export const dynamic = 'force-dynamic'

export default async function MusicLivePage() {
  const [tours, latestConcerts, config] = await Promise.all([
    prisma.musicTour.findMany({
      where: { status: 'PUBLISHED' },
      orderBy: [{ sortOrder: 'asc' }, { startDate: 'desc' }, { createdAt: 'asc' }],
      take: 50,
      select: { id: true, name: true, subtitle: true, posterUrl: true, startDate: true, endDate: true, MusicConcert: { where: { status: 'PUBLISHED' }, select: { city: true } }, _count: { select: { MusicConcert: { where: { status: 'PUBLISHED' } } } } },
    }),
    prisma.musicConcert.findMany({
      where: { status: 'PUBLISHED', MusicTour: { status: 'PUBLISHED' } },
      orderBy: [{ createdAt: 'desc' }, { concertDate: 'desc' }],
      take: 8,
      select: { id: true, title: true, concertDate: true, city: true, venue: true, MusicTour: { select: { name: true } }, _count: { select: { MusicConcertSetlistItem: true } } },
    }),
    getSiteAppearance(),
  ])
  return <MusicArchiveShell backgroundVisual={config.heroVisuals.music}>
    <div className="flex flex-wrap items-center justify-between gap-3"><Link href="/music" className="text-sm font-black text-sky-300/80">← 返回 EasMusic</Link><Link href="/music/live/me" className="border border-sky-200/20 bg-sky-200/[0.07] px-4 py-2 text-sm font-black text-sky-100">我的现场 →</Link></div>
    <header className="py-12 sm:py-16"><p className="text-xs font-black tracking-[0.24em] text-sky-300/70">EASON IN CONCERT ARCHIVE</p><h1 className="mt-4 text-5xl font-black tracking-tight text-white sm:text-7xl">Eason in Concert</h1><p className="mt-5 max-w-3xl text-sm font-bold leading-7 text-slate-300/70 sm:text-base">收录陈奕迅巡演、演唱会场次、现场歌单与特别时刻</p></header>
    {!tours.length ? <section className="border border-white/10 bg-white/[0.055] p-8 sm:p-12"><h2 className="text-3xl font-black text-white">现场档案正在整理中</h2><p className="mt-3 text-sm font-bold text-slate-300/65">已发布巡演将在这里出现。</p></section> : <>
      <section aria-labelledby="live-tours-title"><p className="text-xs font-black tracking-[0.2em] text-sky-300/65">TOUR ARCHIVE</p><h2 id="live-tours-title" className="mt-2 text-3xl font-black text-white sm:text-4xl">巡演档案</h2><div className="mt-7 grid min-w-0 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">{tours.map((tour) => <Link key={tour.id} href={`/music/live/tours/${generateArchiveSlug(tour.name)}`} className="group min-w-0 overflow-hidden border border-white/10 bg-white/[0.055] transition hover:border-sky-300/30 hover:bg-white/[0.09]"><div className="relative aspect-[3/4] bg-[#0b2038]">{tour.posterUrl ? <Image src={tour.posterUrl} alt={`${tour.name}巡演海报`} fill sizes="(max-width: 640px) 100vw, 25vw" className="object-cover" /> : <div className="grid h-full place-items-center text-5xl text-sky-200/25">LIVE</div>}</div><div className="p-5"><h3 className="break-words text-xl font-black text-white">{tour.name}</h3>{tour.subtitle ? <p className="mt-2 break-words text-sm font-bold text-slate-300/65">{tour.subtitle}</p> : null}<p className="mt-4 text-xs font-black text-sky-200/60">{formatLiveDateRange(tour.startDate, tour.endDate)}</p><p className="mt-2 text-xs font-bold text-slate-300/55">{tour._count.MusicConcert} 场 · {new Set(tour.MusicConcert.map((concert) => concert.city)).size} 个城市</p></div></Link>)}</div></section>
      <section className="mt-16" aria-labelledby="latest-concerts-title"><p className="text-xs font-black tracking-[0.2em] text-sky-300/65">RECENTLY ARCHIVED</p><h2 id="latest-concerts-title" className="mt-2 text-3xl font-black text-white sm:text-4xl">最新收录场次</h2><div className="mt-7 grid min-w-0 gap-3 sm:grid-cols-2 lg:grid-cols-4">{latestConcerts.map((concert) => <Link key={concert.id} href={buildConcertSlugPath(concert.MusicTour.name, concert.city, concert.concertDate)} className="min-w-0 border border-white/10 bg-white/[0.05] p-5 hover:bg-white/[0.09]"><time className="text-xs font-black text-sky-300/70">{formatLiveDate(concert.concertDate)}</time><h3 className="mt-2 break-words text-xl font-black text-white">{concert.title || concert.city}</h3><p className="mt-2 break-words text-sm font-bold text-slate-300/60">{concert.venue || '场馆待整理'}</p><p className="mt-4 text-xs font-bold text-sky-100/55">{concert.MusicTour.name} · {concert._count.MusicConcertSetlistItem} 首</p></Link>)}</div></section>
    </>}
  </MusicArchiveShell>
}
