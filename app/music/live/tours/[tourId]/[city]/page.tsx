import Link from 'next/link'
import { notFound, permanentRedirect } from 'next/navigation'
import { ConcertCover } from '@/components/music/ConcertCover'
import { MusicArchiveShell } from '@/components/music/MusicArchiveShell'
import { SetlistBlock, type SetlistItemForBlock } from '@/components/music/live/SetlistBlock'
import { formatLiveDate, formatLiveDateRange } from '@/lib/music-live'
import { formatConcertTime } from '@/lib/music-concert-admin'
import { resolveConcertPoster } from '@/lib/music-concert-poster'
import { generateArchiveSlug, generateDateSlug, cityGroupSlug, CITY_GROUP_TYPE_LABEL } from '@/lib/music-slug'
import { resolveTourByArchiveSlug, resolveCityGroupSlug, buildCityGroupWhere } from '@/lib/music-archive'
import { prisma } from '@/lib/prisma'
import { getSiteAppearance } from '@/lib/site-config'
import { getCurrentUser } from '@/lib/auth'

export const dynamic = 'force-dynamic'

type CityConcert = {
  id: string
  title: string | null
  concertDate: string
  startTime: string | null
  endTime: string | null
  venue: string | null
  sessionNumber: string | null
  createdAt: string
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

export default async function MusicTourCityPage({ params, searchParams }: { params: Promise<{ tourId: string; city: string }>; searchParams: Promise<{ preview?: string }> }) {
  const { tourId, city: cityGroup } = await params
  const previewParam = (await searchParams).preview
  const sessionUser = await getCurrentUser()
  const isPreview = Boolean(previewParam) && Boolean(sessionUser) && (sessionUser?.role === 'ADMIN' || sessionUser?.role === 'SUPER_ADMIN')
  const tourMatch = await resolveTourByArchiveSlug(tourId, isPreview)
  if (!tourMatch) notFound()
  const canonicalTourSlug = generateArchiveSlug(tourMatch.name)
  const group = await resolveCityGroupSlug(tourMatch.id, cityGroup, isPreview)
  if (!group) notFound()
  const canonicalCitySlug = cityGroupSlug(group.base, group.type)
  // 规范的公开地址：/music/live/tours/<slug>/<GROUP>；旧的 id / 原始 city / 旧版 city slug 直链 308 跳转
  if (tourId !== canonicalTourSlug || cityGroup !== canonicalCitySlug) {
    permanentRedirect(`/music/live/tours/${canonicalTourSlug}/${canonicalCitySlug}`)
  }
  const [meta, config] = await Promise.all([
    prisma.musicTour.findFirst({
      where: { id: tourMatch.id, ...(isPreview ? {} : { status: 'PUBLISHED' }) },
      select: {
        id: true, name: true, subtitle: true, posterUrl: true,
        MusicConcert: {
          where: { ...(isPreview ? {} : { status: 'PUBLISHED' }), ...buildCityGroupWhere(group) },
          orderBy: [{ concertDate: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
          include: {
            MusicConcertSetlistItem: {
              orderBy: [{ position: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
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
      startTime: concert.startTime ? concert.startTime.toISOString() : null,
      endTime: concert.endTime ? concert.endTime.toISOString() : null,
      venue: concert.venue,
      sessionNumber: concert.sessionNumber,
      createdAt: concert.createdAt.toISOString(),
      posterUrl: concert.posterUrl,
      normal,
      encore,
      full: items,
      signature: normalSignature(normal),
    }
  })

  // 场次排序：演出日期升序，其次开始时间升序，再次创建时间升序；不再依赖手动场次编号。
  cityConcerts.sort((left, right) => {
    const dateDifference = new Date(left.concertDate).getTime() - new Date(right.concertDate).getTime()
    if (dateDifference) return dateDifference
    const timeDifference = new Date(left.startTime || 0).getTime() - new Date(right.startTime || 0).getTime()
    if (timeDifference) return timeDifference
    return new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime()
  })

  // 同一天多场：按日期分桶，记录每场在当天的序号（用于「第 N 场」与显示时间）。
  const dayCountMap = new Map<string, number>()
  const dayIndexMap = new Map<string, number>()
  const byDay = new Map<string, CityConcert[]>()
  for (const concert of cityConcerts) {
    const key = concert.concertDate.slice(0, 10)
    const bucket = byDay.get(key)
    if (bucket) bucket.push(concert)
    else byDay.set(key, [concert])
  }
  for (const [key, bucket] of byDay) {
    dayCountMap.set(key, bucket.length)
    bucket.forEach((concert, index) => dayIndexMap.set(concert.id, index + 1))
  }

  const allSame = cityConcerts.length > 0 && cityConcerts.every((concert) => concert.signature === cityConcerts[0].signature)
  const firstWithSetlist = cityConcerts.find((concert) => concert.full.length > 0)
  const baseNormal = firstWithSetlist?.normal ?? []
  const setlistItems = allSame ? (cityConcerts[0]?.full ?? []) : baseNormal
  const hasSetlist = cityConcerts.some((concert) => concert.full.length > 0)
  const cityPoster = cityConcerts.map((concert) => concert.posterUrl).find((posterUrl) => posterUrl?.trim()) || null
  const resolvedCityPosterUrl = resolveConcertPoster({ cityPosterUrl: cityPoster, tourPosterUrl: meta.posterUrl }).resolvedPosterUrl
  const cityStartDate = cityConcerts[0]?.concertDate ?? null
  const cityEndDate = cityConcerts.at(-1)?.concertDate ?? cityStartDate
  // 从该城市所有场次提取第一个非空场馆作为「主要场馆」展示（仅展示用，不改数据库）
  const primaryVenue = cityConcerts.map((concert) => concert.venue).find((venue) => venue && venue.trim()) ?? null

  return <MusicArchiveShell maxWidth="max-w-6xl" backgroundVisual={config.heroVisuals.music}>
    <Link href={`/music/live/tours/${canonicalTourSlug}`} className="text-sm font-black text-sky-300/80">← 返回 {meta.name}</Link>
    <section className="mt-8 grid min-w-0 gap-8 md:grid-cols-[200px_minmax(0,1fr)] md:items-center">
      <div className="relative mx-auto aspect-square w-full max-w-[200px] border border-white/15 bg-[#0b2038]"><ConcertCover resolvedPosterUrl={resolvedCityPosterUrl} alt={`${group.base}演唱会海报`} sizes="200px" className="h-full w-full" /></div>
      <div className="min-w-0">
        <p className="text-xs font-black tracking-[0.2em] text-sky-300/65">CITY ARCHIVE · {canonicalCitySlug}</p>
        <h1 className="mt-4 break-words text-4xl font-black tracking-tight text-white sm:text-6xl">{group.base}站</h1>
        {CITY_GROUP_TYPE_LABEL[group.type] ? <p className="mt-3 inline-block border border-sky-300/20 px-2 py-1 text-[11px] font-black text-sky-100/75">{CITY_GROUP_TYPE_LABEL[group.type]}</p> : null}
        <p className="mt-4 break-words text-xl font-black text-slate-200">{meta.name}</p>
        <p className="mt-4 text-sm font-bold text-sky-200/65">{formatLiveDateRange(cityStartDate, cityEndDate)}</p>
        <dl className="mt-7 grid grid-cols-2 gap-3 border-t border-white/10 pt-5"><div><dt className="text-xs text-slate-400">本城市场次</dt><dd className="mt-1 text-xl font-black">{cityConcerts.length} 场</dd></div><div><dt className="text-xs text-slate-400">主要场馆</dt><dd className="mt-1 text-xl font-black">{primaryVenue ?? '场馆待整理'}</dd></div></dl>
      </div>
    </section>

    {hasSetlist ? (
      <SetlistBlock
        items={setlistItems}
        layout="columns"
        title={`${group.base}站歌单`}
        eyebrow="LIVE SETLIST"
        idPrefix="city-setlist"
        excludeEncore={baseNormal.length > 0}
      />
    ) : (
      <section className="mt-14 border border-white/10 bg-white/[0.05] p-6" aria-label="歌单资料">
        <p className="text-xs font-black tracking-[0.2em] text-sky-300/65">SETLIST</p>
        <p className="mt-2 text-sm font-bold text-slate-300">暂无歌单资料</p>
      </section>
    )}

    <section className="mt-14" aria-labelledby="city-concerts-title">
      <p className="text-xs font-black tracking-[0.2em] text-sky-300/65">CONCERTS</p>
      <h2 id="city-concerts-title" className="mt-2 text-3xl font-black text-white sm:text-4xl">演出场次</h2>
      <div className="mt-7 grid min-w-0 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {cityConcerts.map((concert, index) => {
          const dateKey = concert.concertDate.slice(0, 10)
          const sameDay = (dayCountMap.get(dateKey) || 0) > 1
          const dayIndex = dayIndexMap.get(concert.id) || 1
          const startTimeText = formatConcertTime(concert.startTime)
          const sessionLabel = sameDay ? String(dayIndex) : (concert.sessionNumber || String(index + 1))
          const concertHref = `/music/live/tours/${canonicalTourSlug}/${canonicalCitySlug}/${generateDateSlug(concert.concertDate, concert.startTime)}`
          return (
            <div key={concert.id} className="min-w-0 border border-white/10 bg-white/[0.055] p-5 transition hover:border-sky-300/30 hover:bg-white/[0.09]">
              <Link href={concertHref} className="block">
                <div className="flex items-center justify-between gap-3">
                  <time className="text-xs font-black text-sky-300/70">{sameDay ? (dayIndex === 1 ? formatLiveDate(concert.concertDate) : '') : formatLiveDate(concert.concertDate)}{startTimeText ? ` ${startTimeText}` : ''}</time>
                  <span className="shrink-0 border border-sky-300/20 px-2 py-1 text-[10px] font-black text-sky-100/75">第 {sessionLabel} 场</span>
                </div>
                {concert.title ? <h3 className="mt-2 break-words text-xl font-black text-white">{concert.title}</h3> : null}
              </Link>
              <div className="mt-3 border-t border-white/10 pt-3">
                <p className="text-[10px] font-black tracking-[0.2em] text-sky-300/55">ENCORE</p>
                {concert.encore.length ? (
                  <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm font-bold text-slate-200">
                    {concert.encore.slice(0, 5).map((item) => <li key={item.id}>{item.MusicSong?.title || item.displayName || '未命名曲目'}</li>)}
                    {concert.encore.length > 5 ? <li className="text-sky-200/80">+{concert.encore.length - 5} 首</li> : null}
                  </ul>
                ) : (
                  <p className="mt-2 text-sm font-bold text-slate-400">暂无 Encore</p>
                )}
              </div>
              <Link href={concertHref} className="mt-3 inline-block text-xs font-black text-sky-100/65">查看完整歌单 →</Link>
            </div>
          )
        })}
      </div>
      {!cityConcerts.length ? <p className="mt-7 border border-white/10 bg-white/[0.05] p-6 text-sm font-bold text-slate-300">该城市暂无已发布的场次。</p> : null}
    </section>
  </MusicArchiveShell>
}
