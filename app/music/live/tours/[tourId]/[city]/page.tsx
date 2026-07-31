import Image from 'next/image'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { MusicArchiveShell } from '@/components/music/MusicArchiveShell'
import { SetlistBlock, type SetlistItemForBlock } from '@/components/music/live/SetlistBlock'
import { formatLiveDate, formatLiveDateRange } from '@/lib/music-live'
import { prisma } from '@/lib/prisma'
import { getSiteAppearance } from '@/lib/site-config'

export const dynamic = 'force-dynamic'

type CityConcert = {
  id: string
  title: string | null
  concertDate: string
  venue: string | null
  sessionNumber: string | null
  posterUrl: string | null
  normal: SetlistItemForBlock[]
  encore: SetlistItemForBlock[]
  full: SetlistItemForBlock[]
  signature: string
}

function normalSignature(items: SetlistItemForBlock[]): string {
  return items
    .map((item) =>
      [
        item.MusicSong?.id || item.displayName || '',
        item.section,
        item.versionName || '',
        item.note || '',
        item.isRequest ? 1 : 0,
        item.isDebut ? 1 : 0,
        item.isGuest ? 1 : 0,
        item.isMedley ? 1 : 0,
        item.isSpecial ? 1 : 0,
      ].join('|'),
    )
    .join('##')
}

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
          include: {
            MusicConcertSetlistItem: {
              orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
              select: {
                id: true, displayName: true, section: true, position: true, versionName: true, note: true,
                isEncore: true, isRequest: true, isDebut: true, isGuest: true, isMedley: true, isSpecial: true,
                MusicSong: { select: { id: true, title: true } },
              },
            },
            _count: { select: { MusicConcertSetlistItem: true, MusicConcertHighlight: true } },
          },
        },
      },
    }),
    getSiteAppearance(),
  ])
  if (!meta) notFound()

  const cityConcerts: CityConcert[] = meta.MusicConcert.map((concert) => {
    const items = concert.MusicConcertSetlistItem as unknown as SetlistItemForBlock[]
    const normal = items.filter((item) => !item.isEncore)
    const encore = items.filter((item) => item.isEncore)
    return {
      id: concert.id,
      title: concert.title,
      concertDate: concert.concertDate.toISOString(),
      venue: concert.venue,
      sessionNumber: concert.sessionNumber,
      posterUrl: concert.posterUrl,
      normal,
      encore,
      full: items,
      signature: normalSignature(normal),
    }
  })

  const allSame = cityConcerts.length > 0 && cityConcerts.every((concert) => concert.signature === cityConcerts[0].signature)
  const baseSignature = cityConcerts[0]?.signature ?? ''
  const baseNormal = cityConcerts[0]?.normal ?? []
  const cityPoster = cityConcerts[0]?.posterUrl ?? meta.posterUrl

  return <MusicArchiveShell maxWidth="max-w-6xl" backgroundVisual={config.heroVisuals.music}>
    <Link href={`/music/live/tours/${meta.id}`} className="text-sm font-black text-sky-300/80">← 返回 {meta.name}</Link>
    <section className="mt-8 grid min-w-0 gap-8 md:grid-cols-[200px_minmax(0,1fr)] md:items-center">
      <div className="relative mx-auto aspect-[3/4] w-full max-w-[200px] border border-white/15 bg-[#0b2038]">{cityPoster ? <Image src={cityPoster} alt={`${decodedCity}演唱会海报`} fill sizes="200px" className="object-cover" /> : <div className="grid h-full place-items-center text-4xl text-sky-200/25">LIVE</div>}</div>
      <div className="min-w-0">
        <p className="text-xs font-black tracking-[0.2em] text-sky-300/65">CITY ARCHIVE</p>
        <h1 className="mt-4 break-words text-4xl font-black tracking-tight text-white sm:text-6xl">{decodedCity}站</h1>
        <p className="mt-4 break-words text-xl font-black text-slate-200">{meta.name}</p>
        <p className="mt-4 text-sm font-bold text-sky-200/65">{formatLiveDateRange(meta.startDate, meta.endDate)}</p>
        <dl className="mt-7 grid grid-cols-2 gap-3 border-t border-white/10 pt-5"><div><dt className="text-xs text-slate-400">本城市场次</dt><dd className="mt-1 text-xl font-black">{cityConcerts.length}</dd></div></dl>
      </div>
    </section>

    {allSame ? (
      <SetlistBlock items={baseNormal} excludeEncore title={`${decodedCity}站统一歌单`} eyebrow="UNIFIED SETLIST" idPrefix="unified" />
    ) : (
      <SetlistBlock items={baseNormal} title={`${decodedCity}站基础歌单`} eyebrow="BASE SETLIST" idPrefix="base" />
    )}

    <section className="mt-14" aria-labelledby="city-concerts-title">
      <p className="text-xs font-black tracking-[0.2em] text-sky-300/65">CONCERTS</p>
      <h2 id="city-concerts-title" className="mt-2 text-3xl font-black text-white sm:text-4xl">演出场次</h2>
      <div className="mt-7 grid min-w-0 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {cityConcerts.map((concert) => {
          // 差异场次 = 普通歌单与基础签名不同（仅在不一致模式下才可能存在）
          const isDiff = !allSame && concert.signature !== baseSignature
          return (
            <div key={concert.id} className="min-w-0 border border-white/10 bg-white/[0.055] p-5">
              <Link href={`/music/live/concerts/${concert.id}`} className="block">
                <time className="text-xs font-black text-sky-300/70">{formatLiveDate(concert.concertDate)}</time>
                <h3 className="mt-2 break-words text-xl font-black text-white">{concert.title || decodedCity}</h3>
                <p className="mt-2 break-words text-sm font-bold text-slate-300/65">{concert.venue || '场馆待整理'}{concert.sessionNumber ? ` · ${concert.sessionNumber}` : ''}</p>
                <p className="mt-4 text-xs font-black text-sky-100/65">查看完整歌单 →</p>
              </Link>
              {/* 统一模式：每个卡片只显示 Encore 歌曲，绝不重复完整歌单 */}
              {concert.encore.length && !isDiff ? (
                <div className="mt-3 border-t border-white/10 pt-3">
                  <p className="text-[10px] font-black tracking-[0.2em] text-sky-300/55">ENCORE</p>
                  <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm font-bold text-slate-200">
                    {concert.encore.map((item) => <li key={item.id}>{item.MusicSong?.title || item.displayName || '未命名曲目'}</li>)}
                  </ul>
                </div>
              ) : null}
              {/* 仅差异场次展示该场完整歌单（含 Encore）；统一模式 / 基础一致场次不渲染 */}
              {isDiff ? <SetlistBlock items={concert.full} title={`${formatLiveDate(concert.concertDate)} 歌单`} eyebrow="SETLIST" idPrefix={`concert-${concert.id}`} /> : null}
            </div>
          )
        })}
      </div>
      {!cityConcerts.length ? <p className="mt-7 border border-white/10 bg-white/[0.05] p-6 text-sm font-bold text-slate-300">该城市暂无已发布的场次。</p> : null}
    </section>
  </MusicArchiveShell>
}
