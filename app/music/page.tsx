import Link from 'next/link'
import { MusicAlbumCard } from '@/components/music/MusicAlbumCard'
import { MusicArchiveShell } from '@/components/music/MusicArchiveShell'
import { MusicHero } from '@/components/music/MusicHero'
import { MusicSearchDialog } from '@/components/music/MusicSearchDialog'
import { PageLayoutRenderer } from '@/components/page-layout/PageLayoutRenderer'
import { getPublishedPageLayoutConfig } from '@/lib/page-layout/service'
import { prisma } from '@/lib/prisma'
import { formatMusicReleaseDate } from '@/lib/music-display'
import { getSiteAppearance } from '@/lib/site-config'

export const dynamic = 'force-dynamic'

export default async function MusicPage() {
  const [featuredAlbums, layoutConfig, config] = await Promise.all([
    prisma.musicAlbum.findMany({ where: { status: 'PUBLISHED', isFeatured: true, coverUrl: { not: null } }, orderBy: [{ featuredOrder: 'asc' }, { releaseYear: 'desc' }, { createdAt: 'asc' }], take: 16, include: { _count: { select: { MusicSong: true } } } }),
    getPublishedPageLayoutConfig('music'),
    getSiteAppearance(),
  ])
  const albums = featuredAlbums.length > 0
    ? featuredAlbums
    : await prisma.musicAlbum.findMany({ where: { status: 'PUBLISHED', coverUrl: { not: null } }, orderBy: [{ displayOrder: 'asc' }, { releaseYear: 'desc' }, { createdAt: 'asc' }], take: 16, include: { _count: { select: { MusicSong: true } } } })
  const carouselAlbums = albums.map((album) => ({ id: album.id, name: album.name, artist: album.artist, releaseYear: album.releaseYear, language: album.language, coverUrl: album.coverUrl!, songCount: album._count.MusicSong, releaseLabel: formatMusicReleaseDate(album.releaseDate, album.releaseYear) }))

  const musicMain = <div className="space-y-14 sm:space-y-20">
    <MusicHero albums={carouselAlbums} />
    <section aria-labelledby="eason-live-entry-title"><Link href="/music/live" className="group grid min-w-0 gap-6 overflow-hidden border border-sky-300/20 bg-[linear-gradient(105deg,rgba(23,72,116,.58),rgba(8,28,51,.78))] p-6 shadow-[0_24px_70px_rgba(2,12,27,.25)] transition hover:border-sky-200/35 sm:p-9 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end"><div className="min-w-0"><p className="text-xs font-black tracking-[0.2em] text-sky-300/70">EASON LIVE ARCHIVE</p><h2 id="eason-live-entry-title" className="mt-2 break-words text-3xl font-black tracking-tight text-white sm:text-4xl">Eason现场</h2><p className="mt-3 text-sm font-bold leading-7 text-slate-300/70">巡演档案 · 演唱会场次 · 现场歌单</p></div><span className="text-sm font-black text-sky-200 transition group-hover:text-white">进入现场档案 →</span></Link></section>
    <section aria-labelledby="featured-albums-title"><div className="flex items-end justify-between gap-4"><div><p className="text-xs font-black tracking-[0.2em] text-sky-300/70">FEATURED ALBUMS</p><h2 id="featured-albums-title" className="mt-2 text-3xl font-black tracking-tight text-white sm:text-4xl">精选专辑</h2><p className="mt-2 text-sm font-bold text-slate-300/65">从不同年代的旋律里，重新认识每一张作品。</p></div><Link href="/music/albums" className="shrink-0 text-sm font-black text-sky-300 transition hover:text-white">全部专辑 →</Link></div>{albums.length ? <div className="mt-6 grid grid-cols-1 gap-x-3 gap-y-5 min-[360px]:grid-cols-2 sm:mt-7 sm:grid-cols-3 sm:gap-x-4 sm:gap-y-8 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-7 2xl:grid-cols-8">{albums.map((album) => <MusicAlbumCard key={album.id} theme="dark" album={{ ...album, songCount: album._count.MusicSong }} />)}</div> : <p className="mt-7 rounded-3xl border border-white/10 bg-white/[0.06] p-7 text-sm font-bold text-slate-300">暂无已发布专辑。</p>}</section>
    <section aria-labelledby="music-explore-title" className="overflow-hidden rounded-[32px] border border-white/10 bg-white/[0.06] p-6 shadow-[0_24px_70px_rgba(2,12,27,.25)] backdrop-blur-xl sm:p-9"><div className="grid gap-8 lg:grid-cols-[1fr_auto] lg:items-end"><div><p className="text-xs font-black tracking-[0.2em] text-sky-300/70">EXPLORE EASMUSIC</p><h2 id="music-explore-title" className="mt-2 text-3xl font-black tracking-tight text-white sm:text-4xl">探索音乐档案</h2><p className="mt-3 max-w-2xl text-sm font-bold leading-7 text-slate-300/65">按专辑漫游作品年代，或从歌曲、歌词、巡演与演唱会场次中找到你想了解的资料。</p></div><div className="flex flex-wrap gap-3"><Link href="/music/albums" className="inline-flex items-center rounded-full bg-white px-6 py-3 text-sm font-black text-[#07182d] transition hover:-translate-y-0.5">浏览专辑墙</Link><MusicSearchDialog label="搜索专辑、歌曲、现场" variant="glass" /></div></div></section>
  </div>

  return <MusicArchiveShell variant="home" backgroundVisual={config.heroVisuals.music}><PageLayoutRenderer pageKey="music" config={layoutConfig} modules={{ 'music.main': musicMain }} /></MusicArchiveShell>
}
