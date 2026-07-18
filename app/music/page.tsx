import Link from 'next/link'
import { MusicAlbumCard } from '@/components/music/MusicAlbumCard'
import { MusicHero } from '@/components/music/MusicHero'
import { MusicSearchDialog } from '@/components/music/MusicSearchDialog'
import { PageLayoutRenderer } from '@/components/page-layout/PageLayoutRenderer'
import { SiteHeader } from '@/components/SiteHeader'
import { getPublishedPageLayoutConfig } from '@/lib/page-layout/service'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

export default async function MusicPage() {
  const [albums, layoutConfig] = await Promise.all([
    prisma.musicAlbum.findMany({ where: { status: 'PUBLISHED', coverUrl: { not: null } }, orderBy: [{ displayOrder: 'asc' }, { releaseYear: 'desc' }, { createdAt: 'asc' }], include: { _count: { select: { songs: true } } } }),
    getPublishedPageLayoutConfig('music'),
  ])
  const carouselAlbums = albums.map((album) => ({ id: album.id, name: album.name, artist: album.artist, releaseYear: album.releaseYear, language: album.language, coverUrl: album.coverUrl!, songCount: album._count.songs }))

  const musicMain = <div className="space-y-14 sm:space-y-20">
    <MusicHero albums={carouselAlbums} />
    <section aria-labelledby="featured-albums-title"><div className="flex items-end justify-between gap-4"><div><p className="text-xs font-black tracking-[0.2em] text-brand-700">FEATURED ALBUMS</p><h2 id="featured-albums-title" className="mt-2 text-3xl font-black tracking-tight text-brand-950 sm:text-4xl">精选专辑</h2><p className="mt-2 text-sm font-bold text-slate-500">从不同年代的旋律里，重新认识每一张作品。</p></div><Link href="/music/albums" className="shrink-0 text-sm font-black text-brand-700 transition hover:text-brand-950">全部专辑 →</Link></div>{albums.length ? <div className="mt-7 grid grid-cols-2 gap-x-4 gap-y-9 sm:grid-cols-3 lg:grid-cols-5">{albums.slice(0, 10).map((album) => <MusicAlbumCard key={album.id} album={{ ...album, songCount: album._count.songs }} />)}</div> : <p className="mt-7 rounded-3xl bg-sky-50 p-7 text-sm font-bold text-slate-500">暂无已发布专辑。</p>}</section>
    <section aria-labelledby="music-explore-title" className="overflow-hidden rounded-[32px] border border-sky-100 bg-gradient-to-br from-white via-sky-50 to-brand-100/70 p-6 sm:p-9"><div className="grid gap-8 lg:grid-cols-[1fr_auto] lg:items-end"><div><p className="text-xs font-black tracking-[0.2em] text-brand-700">EXPLORE EASMUSIC</p><h2 id="music-explore-title" className="mt-2 text-3xl font-black tracking-tight text-brand-950 sm:text-4xl">探索音乐档案</h2><p className="mt-3 max-w-2xl text-sm font-bold leading-7 text-slate-600">按专辑漫游作品年代，或从歌曲、年份、作词与作曲信息中找到你想了解的那一首歌。</p></div><div className="flex flex-wrap gap-3"><Link href="/music/albums" className="inline-flex items-center rounded-full bg-brand-950 px-6 py-3 text-sm font-black text-white transition hover:-translate-y-0.5">浏览专辑墙</Link><MusicSearchDialog label="搜索音乐档案" /></div></div></section>
  </div>

  return <><SiteHeader /><main className="mx-auto max-w-7xl px-4 py-6 sm:px-5 sm:py-9"><PageLayoutRenderer pageKey="music" config={layoutConfig} modules={{ 'music.main': musicMain }} /></main></>
}
