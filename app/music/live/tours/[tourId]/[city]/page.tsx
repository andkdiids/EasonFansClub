import Image from 'next/image'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { MusicArchiveShell } from '@/components/music/MusicArchiveShell'
import { LiveConcertList } from '@/components/music/live/LiveConcertList'
import { formatLiveDateRange } from '@/lib/music-live'
import { prisma } from '@/lib/prisma'
import { getSiteAppearance } from '@/lib/site-config'

export const dynamic = 'force-dynamic'

export default async function MusicTourCityPage({ params }: { params: Promise<{ tourId: string; city: string }> }) {
  const { tourId, city } = await params
  const decodedCity = decodeURIComponent(city)
  const [meta, config] = await Promise.all([
    prisma.musicTour.findFirst({
      where: { id: tourId, status: 'PUBLISHED' },
      select: {
        id: true, name: true, subtitle: true, posterUrl: true, startDate: true, endDate: true,
        MusicConcert: {
          where: { status: 'PUBLISHED', city: decodedCity },
          orderBy: [{ concertDate: 'asc' }, { sortOrder: 'asc' }, { createdAt: 'asc' }],
          include: { MusicConcertSetlistItem: { select: { songId: true } }, _count: { select: { MusicConcertSetlistItem: true, MusicConcertHighlight: true } } },
        },
      },
    }),
    getSiteAppearance(),
  ])
  if (!meta) notFound()
  const concerts = meta.MusicConcert.map((concert) => ({
    id: concert.id, title: concert.title, concertDate: concert.concertDate.toISOString(), city: concert.city,
    venue: concert.venue, sessionNumber: concert.sessionNumber,
    songCount: concert._count.MusicConcertSetlistItem, hasHighlights: concert._count.MusicConcertHighlight > 0,
  }))

  return <MusicArchiveShell maxWidth="max-w-6xl" backgroundVisual={config.heroVisuals.music}>
    <Link href={`/music/live/tours/${meta.id}`} className="text-sm font-black text-sky-300/80">← 返回 {meta.name}</Link>
    <section className="mt-8 grid min-w-0 gap-8 md:grid-cols-[200px_minmax(0,1fr)] md:items-center">
      <div className="relative mx-auto aspect-[3/4] w-full max-w-[200px] border border-white/15 bg-[#0b2038]">{meta.posterUrl ? <Image src={meta.posterUrl} alt={`${meta.name}巡演海报`} fill sizes="200px" className="object-cover" /> : <div className="grid h-full place-items-center text-4xl text-sky-200/25">LIVE</div>}</div>
      <div className="min-w-0">
        <p className="text-xs font-black tracking-[0.2em] text-sky-300/65">CITY ARCHIVE</p>
        <h1 className="mt-4 break-words text-4xl font-black tracking-tight text-white sm:text-6xl">{decodedCity}站</h1>
        <p className="mt-4 break-words text-xl font-black text-slate-200">{meta.name}</p>
        <p className="mt-4 text-sm font-bold text-sky-200/65">{formatLiveDateRange(meta.startDate, meta.endDate)}</p>
        <dl className="mt-7 grid grid-cols-2 gap-3 border-t border-white/10 pt-5"><div><dt className="text-xs text-slate-400">本城市场次</dt><dd className="mt-1 text-xl font-black">{concerts.length}</dd></div></dl>
      </div>
    </section>
    <LiveConcertList concerts={concerts} hideFilters />
  </MusicArchiveShell>
}
