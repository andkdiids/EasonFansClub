import Link from 'next/link'
import { MusicAlbumCarousel } from '@/components/music/MusicAlbumCarousel'
import { MusicAlbumCard } from '@/components/music/MusicAlbumCard'
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
  const carouselAlbums = albums.map((album) => ({ id: album.id, name: album.name, artist: album.artist, releaseYear: album.releaseYear, language: album.language, coverUrl: album.coverUrl! }))
  return <><SiteHeader /><main className="mx-auto max-w-7xl px-4 py-6 sm:px-5 sm:py-9"><PageLayoutRenderer pageKey="music" config={layoutConfig} modules={{ 'music.main': <div className="space-y-10 sm:space-y-14">
    <section className="text-center"><p className="text-sm font-black tracking-[0.22em] text-brand-700">陈奕迅音乐馆</p><h1 className="mt-3 text-5xl font-black tracking-tight text-brand-950 sm:text-7xl">🎵 EasMusic</h1><p className="mx-auto mt-4 max-w-2xl text-sm font-bold leading-7 text-slate-600 sm:text-base">在可旋转的专辑空间里，浏览作品、创作资料与音乐故事。</p><div className="mt-6"><MusicSearchDialog /></div></section>
    <MusicAlbumCarousel albums={carouselAlbums} />
    <section><div className="flex items-end justify-between"><div><p className="text-xs font-black tracking-[0.18em] text-brand-700">PUBLISHED ARCHIVE</p><h2 className="mt-2 text-3xl font-black text-brand-950">已发布专辑</h2></div><Link href="/music/albums" className="text-sm font-black text-brand-700">查看专辑墙 →</Link></div>{albums.length ? <div className="mt-6 grid grid-cols-2 gap-x-4 gap-y-8 sm:grid-cols-3 lg:grid-cols-5">{albums.slice(0, 10).map((album) => <MusicAlbumCard key={album.id} album={{ ...album, songCount: album._count.songs }} />)}</div> : <p className="mt-6 rounded-2xl bg-sky-50 p-6 text-sm font-bold text-slate-500">暂无已发布专辑。</p>}</section>
  </div> }} /></main></>
}
