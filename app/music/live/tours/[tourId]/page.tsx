import Image from 'next/image'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { MusicArchiveShell } from '@/components/music/MusicArchiveShell'
import { LiveConcertList } from '@/components/music/live/LiveConcertList'
import { formatLiveDateRange } from '@/lib/music-live'
import { prisma } from '@/lib/prisma'
import { getSiteAppearance } from '@/lib/site-config'

export const dynamic = 'force-dynamic'

export default async function MusicTourPage({ params }: { params: Promise<{ tourId: string }> }) {
  const { tourId } = await params
  const [tour, config] = await Promise.all([
    prisma.musicTour.findFirst({
      where: { id: tourId, status: 'PUBLISHED' },
      include: { MusicConcert: { where: { status: 'PUBLISHED' }, orderBy: [{ concertDate: 'asc' }, { sortOrder: 'asc' }, { createdAt: 'asc' }], include: { MusicConcertSetlistItem: { select: { songId: true } }, _count: { select: { MusicConcertSetlistItem: true, MusicConcertHighlight: true } } } } },
    }),
    getSiteAppearance(),
  ])
  if (!tour) notFound()
  const cities = new Set(tour.MusicConcert.map((concert) => concert.city))
  const songs = new Set(tour.MusicConcert.flatMap((concert) => concert.MusicConcertSetlistItem.map((item) => item.songId).filter(Boolean)))
  const concerts = tour.MusicConcert.map((concert) => ({ id: concert.id, title: concert.title, concertDate: concert.concertDate.toISOString(), city: concert.city, venue: concert.venue, sessionNumber: concert.sessionNumber, songCount: concert._count.MusicConcertSetlistItem, hasHighlights: concert._count.MusicConcertHighlight > 0 }))
  return <MusicArchiveShell maxWidth="max-w-6xl" backgroundVisual={config.heroVisuals.music}>
    <Link href="/music/live" className="text-sm font-black text-sky-300/80">← 返回 Eason现场</Link>
    <section className="mt-8 grid min-w-0 gap-8 md:grid-cols-[260px_minmax(0,1fr)] md:items-center"><div className="relative mx-auto aspect-[3/4] w-full max-w-[260px] border border-white/15 bg-[#0b2038]">{tour.posterUrl ? <Image src={tour.posterUrl} alt={`${tour.name}巡演海报`} fill sizes="260px" className="object-cover" /> : <div className="grid h-full place-items-center text-4xl text-sky-200/25">LIVE</div>}</div><div className="min-w-0"><p className="text-xs font-black tracking-[0.2em] text-sky-300/65">TOUR ARCHIVE</p><h1 className="mt-4 break-words text-5xl font-black tracking-tight text-white sm:text-7xl">{tour.name}</h1>{tour.subtitle ? <p className="mt-4 break-words text-xl font-black text-slate-200">{tour.subtitle}</p> : null}<p className="mt-4 text-sm font-bold text-sky-200/65">{formatLiveDateRange(tour.startDate, tour.endDate)}</p>{tour.description ? <p className="mt-6 whitespace-pre-wrap text-sm font-medium leading-8 text-slate-300/75">{tour.description}</p> : null}<dl className="mt-7 grid grid-cols-3 gap-3 border-t border-white/10 pt-5"><div><dt className="text-xs text-slate-400">场次</dt><dd className="mt-1 text-xl font-black">{concerts.length}</dd></div><div><dt className="text-xs text-slate-400">城市</dt><dd className="mt-1 text-xl font-black">{cities.size}</dd></div><div><dt className="text-xs text-slate-400">关联歌曲</dt><dd className="mt-1 text-xl font-black">{songs.size}</dd></div></dl></div></section>
    <LiveConcertList concerts={concerts} />
  </MusicArchiveShell>
}
