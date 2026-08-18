import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ConcertCover } from '@/components/music/ConcertCover'
import { MusicArchiveShell } from '@/components/music/MusicArchiveShell'
import { formatLiveDate, formatLiveDateRange } from '@/lib/music-live'
import { firstPosterUrl, resolveConcertPoster } from '@/lib/music-concert-poster'
import { buildConcertSlugPath } from '@/lib/music-slug'
import { prisma } from '@/lib/prisma'
import { getSiteAppearance } from '@/lib/site-config'
import { toPublicMediaUrl } from '@/lib/media-url'
import { ConcertContributorAttribution } from '@/components/music/ConcertContributorAttribution'

export const dynamic = 'force-dynamic'

export default async function ConcertArchiveDetailPage({ params }: Readonly<{ params: Promise<{ concertId: string }> }>) {
  const { concertId } = await params
  const [tour, config] = await Promise.all([
    prisma.musicTour.findFirst({
      where: { id: concertId, status: 'PUBLISHED' },
      include: {
        MusicConcert: {
          where: { status: 'PUBLISHED' },
          orderBy: [{ concertDate: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
          include: {
            MusicConcertSetlistItem: {
              orderBy: [{ position: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
              select: { id: true, position: true, displayName: true, MusicSong: { select: { title: true } } },
            },
            _count: { select: { MusicConcertSetlistItem: true, MusicConcertHighlight: true } },
            contributorUser: { select: { uid: true, nickname: true } },
            setlistContributorUser: { select: { uid: true, nickname: true } },
            encoreContributorUser: { select: { uid: true, nickname: true } },
          },
        },
      },
    }),
    getSiteAppearance(),
  ])
  if (!tour) notFound()
  tour.posterUrl = toPublicMediaUrl(tour.posterUrl)
  tour.MusicConcert.forEach((concert) => { concert.posterUrl = toPublicMediaUrl(concert.posterUrl) })
  const locations = [...new Set(tour.MusicConcert.map((concert) => `${concert.countryOrRegion || '中国'} · ${concert.city}`))]
  const resolvedPosterUrl = resolveConcertPoster({ posterUrl: tour.posterUrl, cityPosterUrl: firstPosterUrl(tour.MusicConcert.map((concert) => concert.posterUrl)) }).resolvedPosterUrl
  return <MusicArchiveShell maxWidth="max-w-6xl" backgroundVisual={config.heroVisuals.music}>
    <Link href="/music/concerts" className="text-sm font-black text-sky-300/80">← 返回 Eason in Concert</Link>
    <section className="mt-10 grid gap-8 md:grid-cols-[320px_minmax(0,1fr)] md:items-start">
      <div className="relative aspect-square overflow-hidden rounded-[28px] border border-white/10 bg-[#0b2038] shadow-[0_30px_90px_rgba(0,0,0,.35)]"><ConcertCover resolvedPosterUrl={resolvedPosterUrl} alt={`${tour.name}演唱会海报`} sizes="(max-width: 767px) 100vw, 320px" className="h-full w-full" /></div>
      <div>
        <h1 className="text-4xl font-black leading-tight text-white sm:text-6xl">{tour.name}</h1>
        {tour.subtitle ? <p className="mt-4 text-xl font-black text-sky-100/70">{tour.subtitle}</p> : null}
        <div className="mt-6 grid gap-3 sm:grid-cols-3">
          <div className="rounded-[18px] border border-white/10 bg-white/[0.055] p-4"><span className="text-xs font-black text-slate-300/50">时间</span><strong className="mt-1 block text-sm text-white">{formatLiveDateRange(tour.startDate, tour.endDate)}</strong></div>
          <div className="rounded-[18px] border border-white/10 bg-white/[0.055] p-4"><span className="text-xs font-black text-slate-300/50">场次</span><strong className="mt-1 block text-sm text-white">共 {tour.MusicConcert.length} 场</strong></div>
          <div className="rounded-[18px] border border-white/10 bg-white/[0.055] p-4"><span className="text-xs font-black text-slate-300/50">地点</span><strong className="mt-1 block text-sm text-white">{locations.length ? locations.join(' / ') : '待整理'}</strong></div>
        </div>
        {tour.description ? <p className="mt-8 whitespace-pre-wrap text-sm font-medium leading-8 text-slate-200/75 sm:text-base">{tour.description}</p> : null}
      </div>
    </section>
    <section className="mt-14">
      <h2 className="text-3xl font-black text-white">场次与相关资料</h2>
      {tour.MusicConcert.length ? <div className="mt-7 space-y-5">
        {tour.MusicConcert.map((concert, index) => <article key={concert.id} className="rounded-[22px] border border-white/10 bg-white/[0.055] p-5 sm:p-6">
          <div className="grid gap-4 sm:grid-cols-[72px_minmax(0,1fr)_auto] sm:items-start">
            <span className="text-4xl font-black text-sky-300/55">{String(Number(concert.sessionNumber || index + 1)).padStart(2, '0')}</span>
            <div>
              <time className="text-sm font-black text-sky-300/75">{formatLiveDate(concert.concertDate)}</time>
              <h3 className="mt-2 text-xl font-black text-white">{concert.title || `${concert.city}站`}</h3>
              <p className="mt-2 text-sm font-bold text-slate-300/65">{concert.countryOrRegion || '中国'} · {concert.city}</p>
              <p className="mt-1 text-sm font-bold text-slate-300/65">{concert.venue || '场馆待整理'}</p>
            </div>
            <Link href={buildConcertSlugPath(tour.name, concert.city, concert.concertDate, concert.stageType)} className="rounded-full border border-sky-300/20 px-4 py-2 text-center text-xs font-black text-sky-100 transition hover:border-sky-300/50">完整场次资料</Link>
          </div>
          {concert.MusicConcertSetlistItem.length ? <div className="mt-5 border-t border-white/10 pt-5">
            <h4 className="text-xs font-black tracking-[0.16em] text-sky-300/60">歌单</h4>
            <ol className="mt-3 grid gap-x-8 gap-y-2 sm:grid-cols-2">
              {concert.MusicConcertSetlistItem.map((item) => <li key={item.id} className="grid grid-cols-[28px_minmax(0,1fr)] text-sm">
                <span className="font-black text-sky-300/45">{String(item.position).padStart(2, '0')}</span>
                <span className="break-words font-bold text-slate-100/80">{item.MusicSong?.title || item.displayName || '未命名曲目'}</span>
              </li>)}
            </ol>
          </div> : <p className="mt-5 border-t border-white/10 pt-4 text-xs font-bold text-slate-400/60">歌单仍在整理。</p>}
          <ConcertContributorAttribution type="SHOW" contributor={concert.contributorUser} />
          <ConcertContributorAttribution type="SETLIST" contributor={concert.setlistContributorUser} />
          <ConcertContributorAttribution type="ENCORE" contributor={concert.encoreContributorUser} />
        </article>)}
      </div> : <p className="mt-7 rounded-[22px] border border-white/10 bg-white/[0.05] p-6 text-sm font-bold text-slate-300/60">场次资料仍在整理。</p>}
    </section>
  </MusicArchiveShell>
}
