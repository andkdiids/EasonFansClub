import Image from 'next/image'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { MusicArchiveShell } from '@/components/music/MusicArchiveShell'
import { formatLiveDateRange } from '@/lib/music-live'
import { prisma } from '@/lib/prisma'
import { getSiteAppearance } from '@/lib/site-config'

export const dynamic = 'force-dynamic'

export default async function MusicTourPage({ params }: { params: Promise<{ tourId: string }> }) {
  const { tourId } = await params
  const [tour, config] = await Promise.all([
    prisma.musicTour.findFirst({
      where: { id: tourId, status: 'PUBLISHED' },
      select: {
        id: true, name: true, subtitle: true, description: true, posterUrl: true, startDate: true, endDate: true,
        MusicConcert: {
          where: { status: 'PUBLISHED' },
          orderBy: [{ concertDate: 'asc' }],
          select: { city: true, concertDate: true, posterUrl: true },
        },
      },
    }),
    getSiteAppearance(),
  ])
  if (!tour) notFound()
  const groups = new Map<string, { city: string; count: number; firstDate: Date; lastDate: Date; posterUrl: string | null }>()
  for (const concert of tour.MusicConcert) {
    const group = groups.get(concert.city) || { city: concert.city, count: 0, firstDate: concert.concertDate, lastDate: concert.concertDate, posterUrl: concert.posterUrl }
    group.count += 1
    if (concert.concertDate < group.firstDate) group.firstDate = concert.concertDate
    if (concert.concertDate > group.lastDate) group.lastDate = concert.concertDate
    if (!group.posterUrl && concert.posterUrl) group.posterUrl = concert.posterUrl
    groups.set(concert.city, group)
  }
  const cities = [...groups.values()]
    .map((group) => ({
      city: group.city,
      count: group.count,
      posterUrl: group.posterUrl,
      firstDate: group.firstDate.toISOString().slice(0, 10),
      lastDate: group.lastDate.toISOString().slice(0, 10),
    }))
    .sort((left, right) => left.city.localeCompare(right.city, 'zh-CN'))

  return <MusicArchiveShell maxWidth="max-w-6xl" backgroundVisual={config.heroVisuals.music}>
    <Link href="/music/concerts" className="text-sm font-black text-sky-300/80">← 返回 Eason in Concert</Link>
    <section className="mt-8 grid min-w-0 gap-8 md:grid-cols-[260px_minmax(0,1fr)] md:items-center"><div className="relative mx-auto aspect-[3/4] w-full max-w-[260px] border border-white/15 bg-[#0b2038]">{tour.posterUrl ? <Image src={tour.posterUrl} alt={`${tour.name}巡演海报`} fill sizes="260px" className="object-cover" /> : <div className="grid h-full place-items-center text-4xl text-sky-200/25">LIVE</div>}</div><div className="min-w-0"><p className="text-xs font-black tracking-[0.2em] text-sky-300/65">TOUR ARCHIVE</p><h1 className="mt-4 break-words text-5xl font-black tracking-tight text-white sm:text-7xl">{tour.name}</h1>{tour.subtitle ? <p className="mt-4 break-words text-xl font-black text-slate-200">{tour.subtitle}</p> : null}<p className="mt-4 text-sm font-bold text-sky-200/65">{formatLiveDateRange(tour.startDate, tour.endDate)}</p>{tour.description ? <p className="mt-6 whitespace-pre-wrap text-sm font-medium leading-8 text-slate-300/75">{tour.description}</p> : null}<dl className="mt-7 grid grid-cols-2 gap-3 border-t border-white/10 pt-5"><div><dt className="text-xs text-slate-400">场次</dt><dd className="mt-1 text-xl font-black">{tour.MusicConcert.length}</dd></div><div><dt className="text-xs text-slate-400">城市</dt><dd className="mt-1 text-xl font-black">{cities.length}</dd></div></dl></div></section>

    <section className="mt-14" aria-labelledby="tour-cities-title">
      <p className="text-xs font-black tracking-[0.2em] text-sky-300/65">CITY ARCHIVE</p>
      <h2 id="tour-cities-title" className="mt-2 text-3xl font-black text-white sm:text-4xl">巡演城市</h2>
      <div className="mt-7 grid min-w-0 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {cities.map((item) => <Link key={item.city} href={`/music/live/tours/${tour.id}/${encodeURIComponent(item.city)}`} className="min-w-0 border border-white/10 bg-white/[0.055] p-5 transition hover:border-sky-300/30 hover:bg-white/[0.09]">
          <div className="relative aspect-[3/4] w-full border border-white/15 bg-[#0b2038]">{item.posterUrl ? <Image src={item.posterUrl} alt={`${item.city}演唱会海报`} fill sizes="(max-width:640px) 100vw, 320px" className="object-cover" /> : <div className="grid h-full place-items-center text-3xl text-sky-200/25">LIVE</div>}</div>
          <h3 className="mt-4 break-words text-xl font-black text-white">{item.city}</h3>
          <p className="mt-2 text-sm font-bold text-slate-300/65">{item.count} 场 · {item.firstDate.slice(0, 7)} ~ {item.lastDate.slice(0, 7)}</p>
          <p className="mt-4 text-xs font-black text-sky-100/65">查看城市详情 →</p>
        </Link>)}
      </div>
      {!cities.length ? <p className="mt-7 border border-white/10 bg-white/[0.05] p-6 text-sm font-bold text-slate-300">该巡演暂无已发布的场次。</p> : null}
    </section>
  </MusicArchiveShell>
}
