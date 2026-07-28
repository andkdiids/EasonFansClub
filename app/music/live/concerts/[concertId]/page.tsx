import Image from 'next/image'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { BackButton } from '@/components/BackButton'
import { MusicArchiveShell } from '@/components/music/MusicArchiveShell'
import { MUSIC_HIGHLIGHT_TYPE_LABELS, MUSIC_SETLIST_SECTION_LABELS, formatLiveDate } from '@/lib/music-live'
import { prisma } from '@/lib/prisma'
import { getSiteAppearance } from '@/lib/site-config'

export const dynamic = 'force-dynamic'

export default async function MusicConcertPage({ params }: { params: Promise<{ concertId: string }> }) {
  const { concertId } = await params
  const [concert, config] = await Promise.all([
    prisma.musicConcert.findFirst({
      where: { id: concertId, status: 'PUBLISHED', MusicTour: { status: 'PUBLISHED' } },
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
  ])
  if (!concert) notFound()
  const grouped = Object.entries(MUSIC_SETLIST_SECTION_LABELS).map(([section, label]) => ({ section, label, items: concert.MusicConcertSetlistItem.filter((item) => item.section === section) })).filter((group) => group.items.length)
  return <MusicArchiveShell maxWidth="max-w-6xl" backgroundVisual={config.heroVisuals.music}>
    <div className="flex flex-wrap items-center gap-4"><BackButton fallbackHref={`/music/live/tours/${concert.MusicTour.id}`} label="返回上一页" /><Link href={`/music/live/tours/${concert.MusicTour.id}`} className="text-sm font-black text-sky-300/80">返回巡演：{concert.MusicTour.name}</Link></div>
    <section className="mt-8 grid min-w-0 gap-8 md:grid-cols-[260px_minmax(0,1fr)] md:items-center"><div className="relative mx-auto aspect-[3/4] w-full max-w-[260px] border border-white/15 bg-[#0b2038]">{concert.posterUrl ? <Image src={concert.posterUrl} alt={`${concert.city}演唱会海报`} fill sizes="260px" className="object-cover" /> : <div className="grid h-full place-items-center text-4xl text-sky-200/25">LIVE</div>}</div><div className="min-w-0"><p className="text-xs font-black tracking-[0.2em] text-sky-300/65">{concert.MusicTour.name}</p><h1 className="mt-4 break-words text-5xl font-black tracking-tight text-white sm:text-7xl">{concert.title || concert.city}</h1><dl className="mt-6 grid gap-4 border-t border-white/10 pt-5 sm:grid-cols-2"><div><dt className="text-xs text-slate-400">日期</dt><dd className="mt-1 font-black">{formatLiveDate(concert.concertDate)}</dd></div><div><dt className="text-xs text-slate-400">城市 / 地区</dt><dd className="mt-1 break-words font-black">{concert.city}{concert.countryOrRegion ? ` · ${concert.countryOrRegion}` : ''}</dd></div><div><dt className="text-xs text-slate-400">场馆</dt><dd className="mt-1 break-words font-black">{concert.venue || '待整理'}</dd></div><div><dt className="text-xs text-slate-400">场次编号</dt><dd className="mt-1 break-words font-black">{concert.sessionNumber || '—'}</dd></div></dl>{concert.description ? <p className="mt-6 whitespace-pre-wrap text-sm font-medium leading-8 text-slate-300/75">{concert.description}</p> : null}</div></section>
    {grouped.length ? <section className="mt-14" aria-labelledby="concert-setlist-title"><p className="text-xs font-black tracking-[0.2em] text-sky-300/65">LIVE SETLIST</p><h2 id="concert-setlist-title" className="mt-2 text-3xl font-black text-white sm:text-4xl">现场歌单</h2><div className="mt-7 space-y-8">{grouped.map((group) => <section key={group.section}><h3 className="border-b border-white/10 pb-3 text-lg font-black text-sky-100">{group.label}</h3><ol className="mt-2 divide-y divide-white/10 border-y border-white/10">{group.items.map((item) => {
      const tags = [item.isEncore && 'Encore', item.isRequest && '点歌', item.isDebut && '首唱', item.isGuest && '嘉宾', item.isMedley && '串烧', item.isSpecial && '特别演唱'].filter(Boolean)
      const name = item.MusicSong?.title || item.displayName || '未命名曲目'
      return <li key={item.id} className="grid min-w-0 grid-cols-[36px_minmax(0,1fr)] gap-3 py-4 sm:grid-cols-[48px_minmax(0,1fr)_minmax(160px,auto)] sm:items-center"><span className="text-sm font-black text-sky-300/55">{String(item.position).padStart(2,'0')}</span><div className="min-w-0">{item.MusicSong ? <Link href={`/music/song/${item.MusicSong.id}`} className="break-words font-black text-white hover:text-sky-200">{name}</Link> : <span className="break-words font-black text-white">{name}</span>}{tags.length ? <div className="mt-2 flex flex-wrap gap-1.5 sm:hidden">{tags.map((tag) => <span key={String(tag)} className="border border-sky-300/20 px-2 py-1 text-[10px] font-black text-sky-100/75">{tag}</span>)}</div> : null}{item.versionName || item.note ? <p className="mt-2 break-words text-xs font-medium text-slate-300/60 sm:hidden">{[item.versionName, item.note].filter(Boolean).join(' · ')}</p> : null}</div><div className="col-start-2 hidden min-w-0 sm:block">{tags.length ? <div className="flex flex-wrap gap-1.5">{tags.map((tag) => <span key={String(tag)} className="border border-sky-300/20 px-2 py-1 text-[10px] font-black text-sky-100/75">{tag}</span>)}</div> : null}{item.versionName || item.note ? <p className="mt-2 break-words text-xs font-medium text-slate-300/60">{[item.versionName, item.note].filter(Boolean).join(' · ')}</p> : null}</div></li>
    })}</ol></section>)}</div></section> : null}
    {concert.MusicConcertHighlight.length ? <section className="mt-14" aria-labelledby="concert-highlights-title"><p className="text-xs font-black tracking-[0.2em] text-sky-300/65">SPECIAL MOMENTS</p><h2 id="concert-highlights-title" className="mt-2 text-3xl font-black text-white sm:text-4xl">特别时刻</h2><div className="mt-7 grid min-w-0 gap-4 sm:grid-cols-2">{concert.MusicConcertHighlight.map((highlight) => <article key={highlight.id} className="min-w-0 border border-white/10 bg-white/[0.055] p-5 sm:p-6"><span className="border border-sky-300/20 px-2 py-1 text-[10px] font-black text-sky-100/75">{MUSIC_HIGHLIGHT_TYPE_LABELS[highlight.type]}</span><h3 className="mt-4 break-words text-xl font-black text-white">{highlight.title}</h3><p className="mt-3 whitespace-pre-wrap break-words text-sm font-medium leading-7 text-slate-300/70">{highlight.content}</p></article>)}</div></section> : null}
  </MusicArchiveShell>
}
