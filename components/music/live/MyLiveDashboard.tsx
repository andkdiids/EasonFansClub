'use client'

import Image from 'next/image'
import Link from 'next/link'
import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { generateArchiveSlug, buildConcertSlugPath } from '@/lib/music-slug'
import { ConcertCover } from '@/components/music/ConcertCover'

type RecordItem = {
  id: string
  concertId: string
  unavailable: boolean
  seatInfo?: string | null
  mood?: string | null
  note?: string | null
  isPublic?: boolean
  createdAt: string
  concert?: {
    id: string
    title: string | null
    concertDate: string
    city: string
    venue: string | null
    sessionNumber: string | null
    posterUrl: string | null
    resolvedPosterUrl: string | null
    setlistCount: number
    stageType: 'NORMAL' | 'ENCORE' | 'FINAL'
    tour: { id: string; name: string; posterUrl: string | null; resolvedPosterUrl: string | null }
  }
}
type SongItem = {
  songId: string
  title: string
  album: { id: string; name: string; coverUrl: string | null }
  occurrenceCount: number
  concertCount: number
  first: { date: string; city: string; tourId: string }
  latest: { date: string; city: string; tourId: string }
  concerts: Array<{ tourId: string }>
}
type TourStat = {
  id: string
  name: string
  posterUrl: string | null
  resolvedPosterUrl: string | null
  concertCount: number
  firstDate: string
  latestDate: string
  unlockedSongCount: number
}
type DashboardData = {
  stats: {
    concertCount: number
    tourCount: number
    cityCount: number
    unlockedSongCount: number
    totalLiveSongCount: number
    unavailableCount: number
    cities: Array<{ name: string; count: number }>
  }
  records: RecordItem[]
  songs: SongItem[]
  tours: TourStat[]
}

const dateLabel = (value: string) => new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(value))
const tabClass = (active: boolean) => `border-b-2 px-3 py-3 text-sm font-black ${active ? 'border-sky-200 text-white' : 'border-transparent text-slate-400 hover:text-white'}`

export function MyLiveDashboard({ data }: Readonly<{ data: DashboardData }>) {
  const router = useRouter()
  const [tab, setTab] = useState<'overview' | 'concerts' | 'songs' | 'timeline'>('overview')
  const [concertFilters, setConcertFilters] = useState({ tourId: '', year: '', city: '', visibility: '', sort: 'newest' })
  const [songFilters, setSongFilters] = useState({ albumId: '', tourId: '', frequency: '', sort: 'popular' })
  const [error, setError] = useState('')
  const availableRecords = data.records.filter((record) => !record.unavailable && record.concert)
  const filteredRecords = useMemo(() => {
    const rows = availableRecords.filter((record) => {
      const concert = record.concert!
      return (!concertFilters.tourId || concert.tour.id === concertFilters.tourId)
        && (!concertFilters.year || String(new Date(concert.concertDate).getFullYear()) === concertFilters.year)
        && (!concertFilters.city || concert.city.trim().toLocaleLowerCase('zh-CN') === concertFilters.city.toLocaleLowerCase('zh-CN'))
        && (!concertFilters.visibility || (concertFilters.visibility === 'public') === Boolean(record.isPublic))
    })
    return [...rows].sort((a, b) => {
      if (concertFilters.sort === 'added') return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      const direction = concertFilters.sort === 'oldest' ? 1 : -1
      return (new Date(a.concert!.concertDate).getTime() - new Date(b.concert!.concertDate).getTime()) * direction
    })
  }, [availableRecords, concertFilters])
  const filteredSongs = useMemo(() => {
    const rows = data.songs.filter((song) => (!songFilters.albumId || song.album.id === songFilters.albumId)
      && (!songFilters.tourId || song.concerts.some((concert) => concert.tourId === songFilters.tourId))
      && (!songFilters.frequency || (songFilters.frequency === 'once' ? song.occurrenceCount === 1 : song.occurrenceCount > 1)))
    return [...rows].sort((a, b) => {
      if (songFilters.sort === 'recent') return new Date(b.latest.date).getTime() - new Date(a.latest.date).getTime()
      if (songFilters.sort === 'first') return new Date(b.first.date).getTime() - new Date(a.first.date).getTime()
      if (songFilters.sort === 'name') return a.title.localeCompare(b.title, 'zh-CN')
      return b.occurrenceCount - a.occurrenceCount || a.title.localeCompare(b.title, 'zh-CN')
    })
  }, [data.songs, songFilters])
  const timeline = useMemo(() => {
    const groups = new Map<number, RecordItem[]>()
    for (const record of [...availableRecords].sort((a, b) => new Date(b.concert!.concertDate).getTime() - new Date(a.concert!.concertDate).getTime())) {
      const year = new Date(record.concert!.concertDate).getFullYear()
      groups.set(year, [...(groups.get(year) || []), record])
    }
    return [...groups.entries()]
  }, [availableRecords])
  const tours = [...new Map(availableRecords.map((record) => [record.concert!.tour.id, record.concert!.tour])).values()]
  const albums = [...new Map(data.songs.map((song) => [song.album.id, song.album])).values()]
  const years = [...new Set(availableRecords.map((record) => String(new Date(record.concert!.concertDate).getFullYear())))].sort().reverse()
  const cities = [...new Set(availableRecords.map((record) => record.concert!.city.trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'zh-CN'))

  async function remove(record: RecordItem) {
    if (!window.confirm('取消后，该场演唱会将从你的观演记录和歌曲解锁统计中移除。是否继续？')) return
    const response = await fetch(`/api/music/live/concerts/${record.concertId}/attendance`, { method: 'DELETE' })
    const body = await response.json().catch(() => null)
    if (!response.ok) return setError(body?.message || '取消失败，请稍后重试')
    setError('')
    window.dispatchEvent(new CustomEvent('music-live:attendance-updated'))
    router.refresh()
  }

  return <div className="my-live-dashboard">
    <div className="my-live-mobile-topbar" aria-label="我的现场快捷导航"><Link href="/music/concerts" aria-label="返回 Eason in Concert">←</Link><span>我的现场</span><Link href="/profile?module=favorites#profile-modules" aria-label="打开我的收藏">☆</Link></div>
    <div className="my-live-toolbar flex flex-wrap items-center justify-between gap-4"><Link href="/music/concerts" className="text-sm font-black text-sky-300/80">← 返回 Eason in Concert</Link><Link href="/music/concerts" className="border border-white/15 px-4 py-2 text-sm font-black text-white">浏览演唱会档案</Link></div>
    <header className="my-live-heading py-10 sm:py-14"><p className="text-xs font-black tracking-[0.22em] text-sky-300/65">MY LIVE HISTORY</p><h1 className="mt-4 text-5xl font-black text-white sm:text-7xl">我的现场</h1><p className="mt-4 text-sm font-bold text-slate-300/70">记录与你在现场相遇的每一次</p></header>
    <nav aria-label="我的现场内容" className="my-live-tabs flex overflow-x-auto border-y border-white/10">{[['overview','总览'],['concerts','看过的场次'],['songs','歌曲图鉴'],['timeline','时间线']].map(([key,label]) => <button key={key} type="button" onClick={() => setTab(key as typeof tab)} className={tabClass(tab === key)}>{label}</button>)}</nav>
    {error ? <p role="alert" className="mt-5 border border-red-300/20 bg-red-300/10 p-3 text-sm font-bold text-red-200">{error}</p> : null}

    {tab === 'overview' ? <div className="mt-8 space-y-12">
      <dl className="grid grid-cols-2 border-l border-t border-white/10 lg:grid-cols-5">{[
        ['看过的场次', data.stats.concertCount],
        ['经历的巡演', data.stats.tourCount],
        ['去过的城市', data.stats.cityCount],
        ['解锁的不同歌曲', data.stats.unlockedSongCount],
        ['累计现场听歌次数', data.stats.totalLiveSongCount],
      ].map(([label,value]) => <div key={String(label)} className="min-w-0 border-b border-r border-white/10 bg-white/[0.035] p-4 sm:p-5"><dt className="break-words text-xs font-bold text-slate-400">{label}</dt><dd className="mt-2 text-3xl font-black text-white sm:text-4xl">{value}</dd></div>)}</dl>
      {!data.stats.concertCount ? <section className="border border-white/10 bg-white/[0.04] p-7 sm:p-10"><h2 className="text-2xl font-black text-white">还没有记录看过的演唱会</h2><Link href="/music/concerts" className="mt-5 inline-flex bg-sky-100 px-5 py-3 text-sm font-black text-[#06101d]">浏览演唱会档案</Link></section> : <>
        <section><div className="flex items-end justify-between gap-4"><div><p className="text-xs font-black tracking-[0.18em] text-sky-300/60">RECENT CONCERTS</p><h2 className="mt-2 text-3xl font-black text-white">最近观演记录</h2></div><button type="button" onClick={() => setTab('concerts')} className="text-sm font-black text-sky-200">查看全部场次</button></div><div className="my-live-poster-grid mt-5 grid min-w-0 gap-3 sm:grid-cols-2 lg:grid-cols-3">{availableRecords.slice(0,6).map((record) => <ConcertCard key={record.id} record={record} onRemove={remove} />)}</div></section>
        <div className="grid min-w-0 gap-8 lg:grid-cols-2">
          <section><p className="text-xs font-black tracking-[0.18em] text-sky-300/60">CITY FOOTPRINT</p><h2 className="mt-2 text-3xl font-black text-white">城市足迹</h2><div className="mt-5 border-y border-white/10">{data.stats.cities.map((city) => <button key={city.name} type="button" onClick={() => { setConcertFilters((current) => ({ ...current, city: city.name })); setTab('concerts') }} className="flex w-full items-center justify-between border-b border-white/10 px-3 py-4 text-left last:border-b-0 hover:bg-white/[0.05]"><span className="break-words font-black text-white">{city.name}</span><span className="ml-4 shrink-0 text-sm font-bold text-sky-200">{city.count}场</span></button>)}</div></section>
          <section><p className="text-xs font-black tracking-[0.18em] text-sky-300/60">TOUR HISTORY</p><h2 className="mt-2 text-3xl font-black text-white">巡演经历</h2><div className="mt-5 space-y-3">{data.tours.map((tour) => <Link key={tour.id} href={`/music/live/tours/${generateArchiveSlug(tour.name)}`} className="grid min-w-0 grid-cols-[64px_minmax(0,1fr)] gap-4 border border-white/10 bg-white/[0.035] p-3 hover:bg-white/[0.07]"><div className="relative aspect-square overflow-hidden bg-[#0b2038]"><ConcertCover resolvedPosterUrl={tour.resolvedPosterUrl} alt={`${tour.name}巡演海报`} sizes="64px" /></div><div className="min-w-0"><h3 className="break-words font-black text-white">{tour.name}</h3><p className="mt-2 text-xs text-slate-300/65">{tour.concertCount}场 · 解锁{tour.unlockedSongCount}首</p><p className="mt-1 text-xs text-slate-400">{dateLabel(tour.firstDate)} – {dateLabel(tour.latestDate)}</p></div></Link>)}</div></section>
        </div>
      </>}
      {data.stats.unavailableCount ? <p className="border border-amber-200/15 bg-amber-200/[0.06] p-4 text-sm font-bold text-amber-100">有 {data.stats.unavailableCount} 条记录对应的场次资料暂未公开，记录仍安全保留并已计入观看统计。</p> : null}
    </div> : null}

    {tab === 'concerts' ? <section className="mt-8"><h2 className="text-3xl font-black text-white">全部观演场次</h2><div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-5"><select aria-label="按巡演筛选" value={concertFilters.tourId} onChange={(event) => setConcertFilters({ ...concertFilters, tourId: event.target.value })} className="bg-[#0b2038] p-3 text-sm text-white"><option value="">全部巡演</option>{tours.map((tour) => <option key={tour.id} value={tour.id}>{tour.name}</option>)}</select><select aria-label="按年份筛选" value={concertFilters.year} onChange={(event) => setConcertFilters({ ...concertFilters, year: event.target.value })} className="bg-[#0b2038] p-3 text-sm text-white"><option value="">全部年份</option>{years.map((year) => <option key={year}>{year}</option>)}</select><select aria-label="按城市筛选" value={concertFilters.city} onChange={(event) => setConcertFilters({ ...concertFilters, city: event.target.value })} className="bg-[#0b2038] p-3 text-sm text-white"><option value="">全部城市</option>{cities.map((city) => <option key={city}>{city}</option>)}</select><select aria-label="按公开状态筛选" value={concertFilters.visibility} onChange={(event) => setConcertFilters({ ...concertFilters, visibility: event.target.value })} className="bg-[#0b2038] p-3 text-sm text-white"><option value="">全部状态</option><option value="public">公开</option><option value="private">仅自己</option></select><select aria-label="场次排序" value={concertFilters.sort} onChange={(event) => setConcertFilters({ ...concertFilters, sort: event.target.value })} className="bg-[#0b2038] p-3 text-sm text-white"><option value="newest">演出日期从新到旧</option><option value="oldest">演出日期从旧到新</option><option value="added">最近添加</option></select></div><div className="my-live-poster-grid mt-6 grid min-w-0 gap-3 sm:grid-cols-2 lg:grid-cols-3">{filteredRecords.map((record) => <ConcertCard key={record.id} record={record} onRemove={remove} />)}</div>{!filteredRecords.length ? <p className="mt-6 border border-white/10 p-6 text-sm font-bold text-slate-300">没有符合筛选条件的观演记录。</p> : null}{data.records.filter((record) => record.unavailable).map((record) => <article key={record.id} className="mt-3 border border-amber-200/15 bg-amber-200/[0.05] p-4 text-sm font-bold text-amber-100">该场次资料暂未公开，个人观演记录仍已保留。</article>)}</section> : null}

    {tab === 'songs' ? <section className="mt-8"><h2 className="text-3xl font-black text-white">现场歌曲图鉴</h2><div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4"><select aria-label="按专辑筛选" value={songFilters.albumId} onChange={(event) => setSongFilters({ ...songFilters, albumId: event.target.value })} className="bg-[#0b2038] p-3 text-sm text-white"><option value="">全部专辑</option>{albums.map((album) => <option key={album.id} value={album.id}>{album.name}</option>)}</select><select aria-label="按巡演筛选歌曲" value={songFilters.tourId} onChange={(event) => setSongFilters({ ...songFilters, tourId: event.target.value })} className="bg-[#0b2038] p-3 text-sm text-white"><option value="">全部巡演</option>{tours.map((tour) => <option key={tour.id} value={tour.id}>{tour.name}</option>)}</select><select aria-label="按听过次数筛选" value={songFilters.frequency} onChange={(event) => setSongFilters({ ...songFilters, frequency: event.target.value })} className="bg-[#0b2038] p-3 text-sm text-white"><option value="">全部次数</option><option value="once">只听过一次</option><option value="multiple">听过多次</option></select><select aria-label="歌曲排序" value={songFilters.sort} onChange={(event) => setSongFilters({ ...songFilters, sort: event.target.value })} className="bg-[#0b2038] p-3 text-sm text-white"><option value="popular">最常听</option><option value="recent">最近听到</option><option value="first">首次听到</option><option value="name">歌曲名称</option></select></div>{!filteredSongs.length ? <p className="mt-6 border border-white/10 p-6 text-sm font-bold text-slate-300">标记看过的演唱会后，现场歌曲会自动出现在这里</p> : <div className="mt-6 grid min-w-0 grid-cols-2 gap-3 lg:grid-cols-4">{filteredSongs.map((song) => <Link key={song.songId} href={`/music/song/${song.songId}`} className="min-w-0 border border-white/10 bg-white/[0.04] p-3 hover:bg-white/[0.08]"><div className="relative aspect-square bg-[#0b2038]">{song.album.coverUrl ? <Image src={song.album.coverUrl} alt={`${song.album.name}专辑封面`} fill sizes="(max-width: 768px) 50vw, 25vw" className="object-cover" /> : null}</div><h3 className="mt-3 line-clamp-2 break-words font-black text-white">{song.title}</h3><p className="mt-1 truncate text-xs text-slate-400">《{song.album.name}》</p><p className="mt-3 text-sm font-black text-sky-200">现场听过 {song.occurrenceCount} 次</p><p className="mt-1 text-xs text-slate-300/65">出现在 {song.concertCount} 场</p><p className="mt-3 text-[11px] leading-5 text-slate-400">首次：{dateLabel(song.first.date)} · {song.first.city}<br />最近：{dateLabel(song.latest.date)} · {song.latest.city}</p></Link>)}</div>}</section> : null}

    {tab === 'timeline' ? <section className="mt-8"><h2 className="text-3xl font-black text-white">观演时间线</h2>{!timeline.length ? <p className="mt-6 border border-white/10 p-6 text-sm font-bold text-slate-300">还没有记录看过的演唱会</p> : <div className="mt-8 space-y-10">{timeline.map(([year, records]) => <section key={year}><h3 className="text-4xl font-black text-sky-100">{year}</h3><div className="mt-4 border-l border-sky-300/30 pl-4 sm:pl-6">{records.map((record) => <Link key={record.id} href={buildConcertSlugPath(record.concert!.tour.name, record.concert!.city, record.concert!.concertDate, record.concert!.stageType)} className="relative block min-w-0 border-b border-white/10 py-5 before:absolute before:-left-[21px] before:top-7 before:h-2 before:w-2 before:bg-sky-200 sm:before:-left-[29px]"><time className="text-sm font-black text-sky-200">{dateLabel(record.concert!.concertDate)}</time><h4 className="mt-1 break-words text-xl font-black text-white">{record.concert!.city}{record.concert!.sessionNumber ? ` · ${record.concert!.sessionNumber}` : ''}</h4><p className="mt-1 break-words text-sm text-slate-300/65">{record.concert!.venue || '场馆待整理'} · {record.concert!.tour.name}</p><p className="mt-2 text-xs font-bold text-slate-400">{record.mood ? `心情：${record.mood} · ` : ''}{record.isPublic ? '公开' : '仅自己'}</p></Link>)}</div></section>)}</div>}</section> : null}
  </div>
}

function ConcertCard({ record, onRemove }: { record: RecordItem; onRemove: (record: RecordItem) => void }) {
  const concert = record.concert!
  const concertHref = buildConcertSlugPath(concert.tour.name, concert.city, concert.concertDate, concert.stageType)
  return <article className="my-live-concert-card min-w-0 border border-white/10 bg-white/[0.04] p-4">
    <Link href={concertHref} className="my-live-concert-poster relative block aspect-square overflow-hidden bg-[#0b2038]" aria-label={`${concert.city}现场海报`}>
      <ConcertCover resolvedPosterUrl={concert.resolvedPosterUrl} alt={`${concert.city}现场海报`} sizes="(max-width: 767px) 50vw, 0px" />
    </Link>
    <div className="my-live-concert-card-body">
      <div className="flex items-start justify-between gap-3"><div className="min-w-0"><time className="text-xs font-black text-sky-200">{dateLabel(concert.concertDate)}</time><h3 className="mt-2 break-words text-xl font-black text-white">{concert.city}</h3></div><span className="shrink-0 border border-white/10 px-2 py-1 text-[10px] font-black text-slate-300">{record.isPublic ? '公开' : '仅自己'}</span></div><p className="mt-2 break-words text-sm text-slate-300/70">{concert.venue || '场馆待整理'} · {concert.tour.name}</p><p className="mt-3 text-xs text-slate-400">{concert.setlistCount} 首{record.seatInfo ? ` · ${record.seatInfo}` : ''}</p>{record.mood ? <p className="mt-2 break-words text-sm font-bold text-sky-200/75">心情：{record.mood}</p> : null}{record.note ? <p className="mt-2 line-clamp-2 break-words text-xs leading-5 text-slate-400">{record.note}</p> : null}<div className="mt-4 flex flex-wrap gap-2"><Link href={concertHref} className="bg-sky-100 px-3 py-2 text-xs font-black text-[#06101d]">进入场次详情</Link><Link href={concertHref} className="border border-white/15 px-3 py-2 text-xs font-black text-white">编辑记录</Link><button type="button" onClick={() => onRemove(record)} className="border border-red-300/20 px-3 py-2 text-xs font-black text-red-200">取消标记</button></div>
    </div>
  </article>
}
