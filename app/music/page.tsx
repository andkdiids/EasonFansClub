import Link from 'next/link'
import { MusicAlbumCard } from '@/components/music/MusicAlbumCard'
import { MusicCover } from '@/components/music/MusicCover'
import { MusicMiniPlayer } from '@/components/music/MusicMiniPlayer'
import { PageLayoutRenderer } from '@/components/page-layout/PageLayoutRenderer'
import { SiteHeader } from '@/components/SiteHeader'
import { formatTrackNumber, musicCover } from '@/lib/music'
import { getPublishedPageLayoutConfig } from '@/lib/page-layout/service'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

export default async function MusicPage() {
  const [albums, layoutConfig] = await Promise.all([
    prisma.musicAlbum.findMany({
      orderBy: [{ releaseYear: 'desc' }, { createdAt: 'desc' }],
      include: { songs: { orderBy: { trackNumber: 'asc' } } },
      take: 100,
    }),
    getPublishedPageLayoutConfig('music'),
  ])
  const songs = albums.flatMap((album) => album.songs.map((song) => ({ ...song, album })))
  const dayNumber = Math.floor(Date.now() / 86_400_000)
  const recommendation = songs.length > 0 ? songs[dayNumber % songs.length] : null
  const popularAlbums = [...albums].sort((a, b) => b.songs.length - a.songs.length || b.releaseYear - a.releaseYear).slice(0, 5)

  return (
    <>
      <SiteHeader />
      <main className="mx-auto max-w-6xl px-4 py-6 sm:px-5 sm:py-9">
        <PageLayoutRenderer pageKey="music" config={layoutConfig} modules={{
          'music.main': (
            <div className="space-y-10 sm:space-y-14">
              <section className="rounded-[34px] border border-sky-100 bg-gradient-to-br from-white via-white to-sky-50 p-6 shadow-sm sm:p-10">
                <p className="text-sm font-black tracking-[0.2em] text-brand-700">陈奕迅音乐馆</p>
                <h1 className="mt-3 text-4xl font-black tracking-tight text-brand-950 sm:text-6xl">🎵 EasMusic</h1>
                <p className="mt-4 max-w-2xl text-sm font-bold leading-7 text-slate-600 sm:text-base">从专辑与歌曲故事出发，慢慢建立属于私家E院的陈奕迅音乐资料库。</p>
              </section>

              <section>
                <p className="text-xs font-black tracking-[0.18em] text-brand-700">DAILY PICK</p>
                <h2 className="mt-2 text-3xl font-black text-brand-950">今日推荐</h2>
                {recommendation ? (
                  <Link href={`/music/song/${recommendation.id}`} className="mt-5 grid gap-5 rounded-[30px] border border-sky-100 bg-white/88 p-5 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md sm:grid-cols-[220px_minmax(0,1fr)] sm:p-7">
                    <MusicCover src={musicCover(recommendation.album.coverUrl, recommendation.coverUrl)} alt={`${recommendation.title}封面`} className="aspect-square w-full rounded-[26px] sm:w-[220px]" />
                    <div className="flex min-w-0 flex-col justify-center">
                      <p className="text-sm font-black text-brand-700">{formatTrackNumber(recommendation.trackNumber)} · {recommendation.album.name}</p>
                      <h3 className="mt-3 text-3xl font-black text-brand-950 sm:text-5xl">{recommendation.title}</h3>
                      <p className="mt-3 text-sm font-bold text-slate-500">{recommendation.artist} · {recommendation.releaseYear}</p>
                      <p className="mt-5 line-clamp-3 text-sm font-bold leading-7 text-slate-600">{recommendation.story || '歌曲故事等待补充，欢迎先从专辑资料开始认识这首作品。'}</p>
                    </div>
                  </Link>
                ) : <p className="mt-5 rounded-[26px] border border-dashed border-sky-200 bg-white/70 p-8 text-sm font-bold text-slate-500">音乐资料正在整理中，后台录入歌曲后这里会生成每日推荐。</p>}
              </section>

              <section>
                <div className="flex items-end justify-between gap-4">
                  <div><p className="text-xs font-black tracking-[0.18em] text-brand-700">COLLECTION</p><h2 className="mt-2 text-3xl font-black text-brand-950">热门专辑</h2></div>
                  <Link href="/music/albums" className="text-sm font-black text-brand-700">查看专辑墙 →</Link>
                </div>
                {popularAlbums.length > 0 ? <div className="mt-5 grid grid-cols-2 gap-x-4 gap-y-7 sm:grid-cols-3 lg:grid-cols-5">{popularAlbums.map((album) => <MusicAlbumCard key={album.id} album={{ ...album, songCount: album.songs.length }} />)}</div> : <p className="mt-5 text-sm font-bold text-slate-500">暂无专辑资料。</p>}
              </section>

              <section>
                <div className="flex items-end justify-between gap-4">
                  <div><p className="text-xs font-black tracking-[0.18em] text-brand-700">ALL ALBUMS</p><h2 className="mt-2 text-3xl font-black text-brand-950">全部专辑</h2></div>
                  <Link href="/music/albums" className="text-sm font-black text-brand-700">查看全部 →</Link>
                </div>
                {albums.length > 0 ? <div className="mt-5 grid grid-cols-2 gap-x-4 gap-y-7 sm:grid-cols-3 lg:grid-cols-4">{albums.slice(0, 8).map((album) => <MusicAlbumCard key={album.id} album={{ ...album, songCount: album.songs.length }} />)}</div> : <p className="mt-5 text-sm font-bold text-slate-500">暂无专辑资料。</p>}
              </section>

              <MusicMiniPlayer />
            </div>
          ),
        }} />
      </main>
    </>
  )
}
