import Link from 'next/link'
import { permanentRedirect } from 'next/navigation'
import { ConcertCover } from '@/components/music/ConcertCover'
import { MusicArchiveShell } from '@/components/music/MusicArchiveShell'
import { ConcertNotFound } from '@/components/music/ConcertNotFound'
import { formatLiveDateRange } from '@/lib/music-live'
import { firstPosterUrl, resolveConcertPoster } from '@/lib/music-concert-poster'
import { generateArchiveSlug, cityGroupSlug, effectiveCityGroup, decodeRouteParam, type CityGroupType, CITY_GROUP_TYPE_LABEL } from '@/lib/music-slug'
import { resolveTourByArchiveSlug } from '@/lib/music-archive'
import { prisma } from '@/lib/prisma'
import { getSiteAppearance } from '@/lib/site-config'
import { getCurrentUser } from '@/lib/auth'

type CityGroupInfo = {
  groupSlug: string
  base: string
  type: CityGroupType
  count: number
  firstDate: Date
  lastDate: Date
  posterUrl: string | null
}

// 城市卡片网格（复用既有卡片样式，仅对返场/最终站追加标签）
function TourCityGrid({ tourSlug, tourPosterUrl, items }: { tourSlug: string; tourPosterUrl: string | null; items: CityGroupInfo[] }) {
  return (
    <div className="tour-city-archive-grid mt-7 grid min-w-0 gap-3 sm:grid-cols-2 md:grid-cols-3">
      {items.map((item) => {
        const href = `/music/live/tours/${tourSlug}/${item.groupSlug}`
        const resolvedPosterUrl = resolveConcertPoster({ posterUrl: item.posterUrl, tourPosterUrl }).resolvedPosterUrl
        const label = CITY_GROUP_TYPE_LABEL[item.type]
        return (
          <Link key={item.groupSlug} href={href} className="tour-city-archive-card min-w-0 overflow-hidden border border-white/10 bg-white/[0.055] p-0 transition hover:border-sky-300/30 hover:bg-white/[0.09] sm:p-5">
            <div className="tour-city-archive-card-media relative aspect-square w-full border-b border-white/15 bg-[#0b2038] sm:border-b-0"><ConcertCover resolvedPosterUrl={resolvedPosterUrl} alt={`${item.base}演唱会海报`} sizes="(max-width:767px) 50vw, 320px" className="h-full w-full" /></div>
            <div className="tour-city-archive-card-body p-4 sm:p-0">
              <h3 className="break-words text-xl font-black text-white">{item.base}</h3>
              {label ? <p className="mt-2 inline-block border border-sky-300/20 px-2 py-1 text-[10px] font-black text-sky-100/75">{label}</p> : null}
              <p className="mt-2 text-sm font-bold text-slate-300/65">{item.count} 场 · {item.firstDate.toISOString().slice(0, 7)} ~ {item.lastDate.toISOString().slice(0, 7)}</p>
              <p className="mt-4 text-xs font-black text-sky-100/65">查看城市详情 →</p>
            </div>
          </Link>
        )
      })}
    </div>
  )
}

export const dynamic = 'force-dynamic'

export default async function MusicTourPage({ params, searchParams }: { params: Promise<{ tourId: string }>; searchParams: Promise<{ preview?: string }> }) {
  const { tourId } = await params
  const previewParam = (await searchParams).preview
  const sessionUser = await getCurrentUser()
  const isPreview = Boolean(previewParam) && Boolean(sessionUser) && (sessionUser?.role === 'ADMIN' || sessionUser?.role === 'SUPER_ADMIN')
  const match = await resolveTourByArchiveSlug(tourId, isPreview)
  if (!match) return <ConcertNotFound />
  // 旧的 CUID 直链跳转到规范的 slug 公开地址；slug 直链直接渲染。
  // 注意：非 ASCII slug 的路由参数可能是 percent-encoded，比较前先解码，避免中文巡演名无限重定向。
  const canonicalSlug = generateArchiveSlug(match.name)
  if (decodeRouteParam(tourId) !== canonicalSlug) permanentRedirect(`/music/live/tours/${canonicalSlug}`)
  const [tour, config] = await Promise.all([
    prisma.musicTour.findFirst({
      where: { id: match.id, ...(isPreview ? {} : { status: 'PUBLISHED' }) },
      select: {
        id: true, name: true, subtitle: true, description: true, posterUrl: true, startDate: true, endDate: true,
        MusicConcert: {
          where: { ...(isPreview ? {} : { status: 'PUBLISHED' }) },
          orderBy: [{ concertDate: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
          select: { city: true, stageType: true, concertDate: true, posterUrl: true },
        },
      },
    }),
    getSiteAppearance(),
  ])
  if (!tour) return <ConcertNotFound />
  const groups = new Map<string, CityGroupInfo>()
  for (const concert of tour.MusicConcert) {
    const { base, type } = effectiveCityGroup(concert.city, concert.stageType)
    const key = cityGroupSlug(base, type)
    const group = groups.get(key) || { groupSlug: key, base, type, count: 0, firstDate: concert.concertDate, lastDate: concert.concertDate, posterUrl: concert.posterUrl }
    group.count += 1
    if (concert.concertDate < group.firstDate) group.firstDate = concert.concertDate
    if (concert.concertDate > group.lastDate) group.lastDate = concert.concertDate
    if (!group.posterUrl && concert.posterUrl) group.posterUrl = concert.posterUrl
    groups.set(key, group)
  }
  const resolvedTourPosterUrl = resolveConcertPoster({
    posterUrl: tour.posterUrl,
    cityPosterUrl: firstPosterUrl(tour.MusicConcert.map((concert) => concert.posterUrl)),
  }).resolvedPosterUrl
  // 城市分组排序：先按首演日期，再用规范分组 slug 作为稳定次级排序（不按城市名称排序）。
  // slug 形如 HONG-KONG / HONG-KONG-ENCORE / MACAU-FINAL，字典序天然使「普通 < 返场 < 最终站」「同城市先于带后缀」。
  const sortByDateThenSlug = (left: CityGroupInfo, right: CityGroupInfo) =>
    left.firstDate.toISOString().slice(0, 10).localeCompare(right.firstDate.toISOString().slice(0, 10)) || left.groupSlug.localeCompare(right.groupSlug)
  const normalGroups = [...groups.values()].filter((g) => g.type === 'normal').sort(sortByDateThenSlug)
  const encoreGroups = [...groups.values()].filter((g) => g.type === 'encore').sort(sortByDateThenSlug)
  const finalGroups = [...groups.values()].filter((g) => g.type === 'final').sort(sortByDateThenSlug)
  const cityGroups = [...groups.values()]

  return <MusicArchiveShell maxWidth="max-w-6xl" backgroundVisual={config.heroVisuals.music}>
    <div className="flex flex-wrap items-center justify-between gap-3"><Link href="/music/concerts" className="text-sm font-black text-sky-300/80">← 返回 Eason in Concert</Link><Link href={`/music/live/me?tourId=${encodeURIComponent(tour.id)}`} className="border border-sky-200/20 bg-sky-200/[0.07] px-4 py-2 text-sm font-black text-sky-100">批量添加场次 →</Link></div>
    <section className="mt-8 grid min-w-0 gap-8 md:grid-cols-[260px_minmax(0,1fr)] md:items-center"><div className="relative mx-auto aspect-square w-full max-w-[260px] border border-white/15 bg-[#0b2038]"><ConcertCover resolvedPosterUrl={resolvedTourPosterUrl} alt={`${tour.name}巡演海报`} sizes="260px" className="h-full w-full" /></div><div className="min-w-0"><p className="text-xs font-black tracking-[0.2em] text-sky-300/65">TOUR ARCHIVE</p><h1 className="mt-4 break-words text-5xl font-black tracking-tight text-white sm:text-7xl">{tour.name}</h1>{tour.subtitle ? <p className="mt-4 break-words text-xl font-black text-slate-200">{tour.subtitle}</p> : null}<p className="mt-4 text-sm font-bold text-sky-200/65">{formatLiveDateRange(tour.startDate, tour.endDate)}</p>{tour.description ? <p className="mt-6 whitespace-pre-wrap text-sm font-medium leading-8 text-slate-300/75">{tour.description}</p> : null}<dl className="mt-7 grid grid-cols-2 gap-3 border-t border-white/10 pt-5"><div><dt className="text-xs text-slate-400">场次</dt><dd className="mt-1 text-xl font-black">{tour.MusicConcert.length}</dd></div><div><dt className="text-xs text-slate-400">城市</dt><dd className="mt-1 text-xl font-black">{cityGroups.length}</dd></div></dl></div></section>

    {!cityGroups.length ? <p className="mt-7 border border-white/10 bg-white/[0.05] p-6 text-sm font-bold text-slate-300">该巡演暂无已发布的场次。</p> : null}

    {normalGroups.length ? (
      <section className="mt-14" aria-labelledby="tour-cities-title">
        <p className="text-xs font-black tracking-[0.2em] text-sky-300/65">CITY ARCHIVE</p>
        <h2 id="tour-cities-title" className="mt-2 text-3xl font-black text-white sm:text-4xl">巡演城市</h2>
        <TourCityGrid tourSlug={canonicalSlug} tourPosterUrl={tour.posterUrl} items={normalGroups} />
      </section>
    ) : null}

    {encoreGroups.length ? (
      <section className="mt-14" aria-labelledby="tour-cities-encore-title">
        <p className="text-xs font-black tracking-[0.2em] text-sky-300/65">ENCORE CITIES</p>
        <h2 id="tour-cities-encore-title" className="mt-2 text-3xl font-black text-white sm:text-4xl">返场城市</h2>
        <TourCityGrid tourSlug={canonicalSlug} tourPosterUrl={tour.posterUrl} items={encoreGroups} />
      </section>
    ) : null}

    {finalGroups.length ? (
      <section className="mt-14" aria-labelledby="tour-cities-final-title">
        <p className="text-xs font-black tracking-[0.2em] text-sky-300/65">FINAL STATION</p>
        <h2 id="tour-cities-final-title" className="mt-2 text-3xl font-black text-white sm:text-4xl">最终站</h2>
        <TourCityGrid tourSlug={canonicalSlug} tourPosterUrl={tour.posterUrl} items={finalGroups} />
      </section>
    ) : null}
  </MusicArchiveShell>
}
