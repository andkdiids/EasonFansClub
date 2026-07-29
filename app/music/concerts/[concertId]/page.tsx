import Image from 'next/image'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { MusicArchiveShell } from '@/components/music/MusicArchiveShell'
import { MusicSectionNavigation } from '@/components/music/MusicSectionNavigation'
import { formatLiveDate, formatLiveDateRange } from '@/lib/music-live'
import { prisma } from '@/lib/prisma'
import { getSiteAppearance } from '@/lib/site-config'

export const dynamic = 'force-dynamic'

export default async function ConcertArchiveDetailPage({ params }: Readonly<{ params: Promise<{ concertId: string }> }>) {
  const { concertId } = await params
  const [tour, config] = await Promise.all([
    prisma.musicTour.findFirst({
      where: { id: concertId, status: 'PUBLISHED' },
      include: {
        MusicConcert: {
          where: { status: 'PUBLISHED' },
          orderBy: [{ concertDate: 'asc' }, { sortOrder: 'asc' }],
          include: { _count: { select: { MusicConcertSetlistItem: true, MusicConcertHighlight: true } } },
        },
      },
    }),
    getSiteAppearance(),
  ])
  if (!tour) notFound()
  const cities = [...new Set(tour.MusicConcert.map((concert) => concert.city))]
  return <MusicArchiveShell maxWidth="max-w-6xl" backgroundVisual={config.heroVisuals.music}>
    <Link href="/music/concerts" className="text-sm font-black text-sky-300/80">← 返回 Eason in Concert</Link>
    <div className="mt-6"><MusicSectionNavigation /></div>
    <section className="mt-10 grid gap-8 lg:grid-cols-[320px_minmax(0,1fr)] lg:items-start">
      <div className="relative aspect-[3/4] overflow-hidden rounded-[28px] border border-white/10 bg-[#0b2038] shadow-[0_30px_90px_rgba(0,0,0,.35)]">{tour.posterUrl ? <Image src={tour.posterUrl} alt={`${tour.name}演唱会海报`} fill priority sizes="(max-width: 1024px) 100vw, 320px" className="object-cover" /> : <div className="grid h-full place-items-center text-5xl text-sky-200/20">LIVE</div>}</div>
      <div>
        <p className="text-xs font-black tracking-[0.24em] text-sky-300/65">CONCERT ARCHIVE · {tour.startDate ? new Date(tour.startDate).getUTCFullYear() : 'YEAR UNKNOWN'}</p>
        <h1 className="mt-3 text-4xl font-black leading-tight text-white sm:text-6xl">{tour.name}</h1>
        {tour.subtitle ? <p className="mt-4 text-xl font-black text-sky-100/70">{tour.subtitle}</p> : null}
        <div className="mt-6 grid gap-3 sm:grid-cols-3">
          <div className="rounded-[18px] border border-white/10 bg-white/[0.055] p-4"><span className="text-xs font-black text-slate-300/50">时间</span><strong className="mt-1 block text-sm text-white">{formatLiveDateRange(tour.startDate, tour.endDate)}</strong></div>
          <div className="rounded-[18px] border border-white/10 bg-white/[0.055] p-4"><span className="text-xs font-black text-slate-300/50">场次</span><strong className="mt-1 block text-sm text-white">{tour.MusicConcert.length} 场</strong></div>
          <div className="rounded-[18px] border border-white/10 bg-white/[0.055] p-4"><span className="text-xs font-black text-slate-300/50">地点</span><strong className="mt-1 block text-sm text-white">{cities.length ? cities.join(' / ') : '待整理'}</strong></div>
        </div>
        {tour.description ? <p className="mt-8 whitespace-pre-wrap text-sm font-medium leading-8 text-slate-200/75 sm:text-base">{tour.description}</p> : null}
      </div>
    </section>
    <section className="mt-14">
      <p className="text-xs font-black tracking-[0.2em] text-sky-300/60">CONCERT SESSIONS & MATERIALS</p>
      <h2 className="mt-2 text-3xl font-black text-white">场次与相关资料</h2>
      {tour.MusicConcert.length ? <div className="mt-7 grid gap-4 sm:grid-cols-2">
        {tour.MusicConcert.map((concert) => <Link key={concert.id} href={`/music/live/concerts/${concert.id}`} className="rounded-[22px] border border-white/10 bg-white/[0.055] p-5 transition hover:border-sky-300/30 hover:bg-white/[0.09]">
          <time className="text-xs font-black text-sky-300/65">{formatLiveDate(concert.concertDate)}</time>
          <h3 className="mt-2 text-xl font-black text-white">{concert.title || `${concert.city}站`}</h3>
          <p className="mt-2 text-sm font-bold text-slate-300/60">{concert.city}{concert.venue ? ` · ${concert.venue}` : ''}{concert.sessionNumber ? ` · ${concert.sessionNumber}` : ''}</p>
          <p className="mt-4 text-xs font-black text-sky-100/55">{concert._count.MusicConcertSetlistItem} 首歌单 · {concert._count.MusicConcertHighlight} 条特别资料</p>
        </Link>)}
      </div> : <p className="mt-7 rounded-[22px] border border-white/10 bg-white/[0.05] p-6 text-sm font-bold text-slate-300/60">场次资料仍在整理。</p>}
    </section>
  </MusicArchiveShell>
}
