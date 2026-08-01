import Image from 'next/image'
import Link from 'next/link'
import { notFound, permanentRedirect } from 'next/navigation'
import { BackButton } from '@/components/BackButton'
import { MusicArchiveShell } from '@/components/music/MusicArchiveShell'
import { AttendancePanel } from '@/components/music/live/AttendancePanel'
import { getCurrentUser } from '@/lib/auth'
import { MUSIC_HIGHLIGHT_TYPE_LABELS, formatLiveDate } from '@/lib/music-live'
import { SetlistBlock } from '@/components/music/live/SetlistBlock'
import { prisma } from '@/lib/prisma'
import { getSiteAppearance } from '@/lib/site-config'
import { resolveConcertBySlug } from '@/lib/music-archive'

export const dynamic = 'force-dynamic'

export default async function MusicConcertBySlugPage({
  params,
}: {
  params: Promise<{ tourId: string; city: string; date: string }>
}) {
  const { tourId, city, date } = await params

  // 依据 巡演slug + 城市slug + 日期slug 解析单场（兼容旧 CUID / 中文 city 输入）
  const resolved = await resolveConcertBySlug(tourId, city, date)
  if (!resolved) notFound()

  // 规范的公开地址：/music/live/tours/<tourSlug>/<CITY>/<YYYYMMDD>
  // 旧的 CUID / 原始 city / 小写 slug 直链 308 跳转
  if (
    tourId !== resolved.tourSlug ||
    city !== resolved.citySlug ||
    date !== resolved.dateSlug
  ) {
    permanentRedirect(`/music/live/tours/${resolved.tourSlug}/${resolved.citySlug}/${resolved.dateSlug}`)
  }

  const currentUser = await getCurrentUser()
  const [concert, config, attendance] = await Promise.all([
    prisma.musicConcert.findFirst({
      where: { id: resolved.id, status: 'PUBLISHED', MusicTour: { status: 'PUBLISHED' } },
      select: {
        id: true, title: true, concertDate: true, city: true, countryOrRegion: true, venue: true, sessionNumber: true, posterUrl: true, description: true,
        MusicTour: { select: { id: true, name: true } },
        MusicConcertSetlistItem: {
          orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
          select: { id: true, displayName: true, section: true, position: true, versionName: true, note: true, isEncore: true, isRequest: true, isDebut: true, isGuest: true, isMedley: true, isSpecial: true, MusicSong: { select: { id: true, title: true } } },
        },
        MusicConcertHighlight: { orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }], select: { id: true, title: true, content: true, type: true } },
      },
    }),
    getSiteAppearance(),
    currentUser ? prisma.userMusicConcert.findUnique({
      where: { userId_concertId: { userId: currentUser.id, concertId: resolved.id } },
      select: { id: true, seatInfo: true, mood: true, note: true, isPublic: true, updatedAt: true },
    }) : Promise.resolve(null),
  ])
  if (!concert) notFound()

  const cityPageHref = `/music/live/tours/${resolved.tourSlug}/${resolved.citySlug}`

  return <MusicArchiveShell maxWidth="max-w-6xl" backgroundVisual={config.heroVisuals.music}>
    <div className="my-live-concert-detail-page">
    <div className="flex flex-wrap items-center gap-4"><BackButton fallbackHref={cityPageHref} label="返回上一页" /><Link href={cityPageHref} className="text-sm font-black text-sky-300/80">返回城市：{concert.city}站</Link></div>
    <section className="my-live-concert-detail-hero mt-8 grid min-w-0 gap-8 md:grid-cols-[260px_minmax(0,1fr)] md:items-center"><div className="my-live-concert-detail-poster relative mx-auto aspect-[3/4] w-full max-w-[260px] border border-white/15 bg-[#0b2038]">{concert.posterUrl ? <Image src={concert.posterUrl} alt={`${concert.city}演唱会海报`} fill sizes="(max-width: 767px) 100vw, 260px" className="object-cover" /> : <div className="grid h-full place-items-center text-4xl text-sky-200/25">LIVE</div>}</div><div className="my-live-concert-detail-info min-w-0"><p className="text-xs font-black tracking-[0.2em] text-sky-300/65">{concert.MusicTour.name}</p><h1 className="mt-4 break-words text-5xl font-black tracking-tight text-white sm:text-7xl">{concert.title || concert.city}</h1><dl className="my-live-concert-detail-meta mt-6 grid gap-4 border-t border-white/10 pt-5 sm:grid-cols-2"><div><dt className="text-xs text-slate-400">日期</dt><dd className="mt-1 font-black">{formatLiveDate(concert.concertDate)}</dd></div><div><dt className="text-xs text-slate-400">城市 / 地区</dt><dd className="mt-1 break-words font-black">{concert.city}{concert.countryOrRegion ? ` · ${concert.countryOrRegion}` : ''}</dd></div><div><dt className="text-xs text-slate-400">场馆</dt><dd className="mt-1 break-words font-black">{concert.venue || '待整理'}</dd></div><div><dt className="text-xs text-slate-400">场次编号</dt><dd className="mt-1 break-words font-black">{concert.sessionNumber || '—'}</dd></div><div><dt className="text-xs text-slate-400">分类</dt><dd className="mt-1 break-words font-black">{concert.MusicTour.name}</dd></div><div><dt className="text-xs text-slate-400">座位</dt><dd className="mt-1 break-words font-black">{attendance?.seatInfo || '未记录'}</dd></div></dl>{concert.description ? <p className="mt-6 whitespace-pre-wrap text-sm font-medium leading-8 text-slate-300/75">{concert.description}</p> : null}<AttendancePanel concertId={concert.id} loggedIn={Boolean(currentUser)} initialAttendance={attendance} /></div></section>
    {concert.MusicConcertSetlistItem.length ? (concert.MusicConcertSetlistItem.length > 12 ? (
      <details className="concert-setlist-collapsible">
        <summary><span className="concert-setlist-expand-label">展开完整歌单</span><span className="concert-setlist-collapse-label">收起歌单</span></summary>
        <SetlistBlock items={concert.MusicConcertSetlistItem} title="现场歌单" idPrefix="mobile-concert-setlist" layout="columns" />
      </details>
    ) : <SetlistBlock items={concert.MusicConcertSetlistItem} title="现场歌单" idPrefix="mobile-concert-setlist" layout="columns" />) : null}
    {concert.MusicConcertHighlight.length ? <section className="mt-14" aria-labelledby="concert-highlights-title"><p className="text-xs font-black tracking-[0.2em] text-sky-300/65">SPECIAL MOMENTS</p><h2 id="concert-highlights-title" className="mt-2 text-3xl font-black text-white sm:text-4xl">特别时刻</h2><div className="mt-7 grid min-w-0 gap-4 sm:grid-cols-2">{concert.MusicConcertHighlight.map((highlight) => <article key={highlight.id} className="min-w-0 border border-white/10 bg-white/[0.055] p-5 sm:p-6"><span className="border border-sky-300/20 px-2 py-1 text-[10px] font-black text-sky-100/75">{MUSIC_HIGHLIGHT_TYPE_LABELS[highlight.type]}</span><h3 className="mt-4 break-words text-xl font-black text-white">{highlight.title}</h3><p className="mt-3 whitespace-pre-wrap break-words text-sm font-medium leading-7 text-slate-300/70">{highlight.content}</p></article>)}</div></section> : null}
    </div>
  </MusicArchiveShell>
}
