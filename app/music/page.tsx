import Link from 'next/link'
import { MusicAlbumArchiveShowcase } from '@/components/music/MusicAlbumArchiveShowcase'
import { MusicArchiveShell } from '@/components/music/MusicArchiveShell'
import { EasMusicCassetteHero } from '@/components/music/cassette/EasMusicCassetteHero'
import { MusicConcertTimeline } from '@/components/music/MusicConcertTimeline'
import { MusicSectionNavigation } from '@/components/music/MusicSectionNavigation'
import { PageLayoutRenderer } from '@/components/page-layout/PageLayoutRenderer'
import { getPublishedPageLayoutConfig } from '@/lib/page-layout/service'
import { prisma } from '@/lib/prisma'
import { formatMusicReleaseDate } from '@/lib/music-display'
import { getSiteAppearance } from '@/lib/site-config'

export const dynamic = 'force-dynamic'

export default async function MusicPage() {
  const [albums, tours, cassetteSourceSongs, layoutConfig, config] = await Promise.all([
    prisma.musicAlbum.findMany({ where: { status: 'PUBLISHED' }, orderBy: [{ displayOrder: 'asc' }, { releaseYear: 'desc' }, { createdAt: 'asc' }], include: { _count: { select: { MusicSong: true } } } }),
    prisma.musicTour.findMany({
      where: { status: 'PUBLISHED' },
      orderBy: [{ sortOrder: 'asc' }, { startDate: 'asc' }, { createdAt: 'asc' }],
      include: {
        MusicConcert: { where: { status: 'PUBLISHED' }, select: { city: true } },
        _count: { select: { MusicConcert: { where: { status: 'PUBLISHED' } } } },
      },
    }),
    prisma.musicSong.findMany({
      where: {
        previewUrl: { not: null },
        MusicAlbum: { status: 'PUBLISHED' },
      },
      orderBy: [{ releaseYear: 'desc' }, { trackNumber: 'asc' }, { createdAt: 'asc' }],
      take: 60,
      select: {
        id: true,
        title: true,
        artist: true,
        releaseYear: true,
        language: true,
        coverUrl: true,
        previewUrl: true,
        previewDuration: true,
        MusicAlbum: {
          select: {
            id: true,
            name: true,
            coverUrl: true,
          },
        },
      },
    }),
    getPublishedPageLayoutConfig('music'),
    getSiteAppearance(),
  ])
  const carouselAlbums = albums.filter((album) => Boolean(album.coverUrl)).map((album) => ({ id: album.id, name: album.name, artist: album.artist, releaseYear: album.releaseYear, language: album.language, coverUrl: album.coverUrl!, songCount: album._count.MusicSong, releaseLabel: formatMusicReleaseDate(album.releaseDate, album.releaseYear) }))
  const archiveAlbums = albums.map((album) => ({ id: album.id, name: album.name, artist: album.artist, releaseYear: album.releaseYear, language: album.language, coverUrl: album.coverUrl, songCount: album._count.MusicSong }))
  const timelineTours = tours.map(({ MusicConcert, _count, ...tour }) => ({ ...tour, concertCount: _count.MusicConcert, cities: [...new Set(MusicConcert.map((concert) => concert.city))] }))
  const cassetteSongs = cassetteSourceSongs.flatMap((song) => song.previewUrl ? [{
    id: song.id,
    title: song.title,
    artist: song.artist,
    albumId: song.MusicAlbum.id,
    albumTitle: song.MusicAlbum.name,
    releaseYear: song.releaseYear,
    language: song.language,
    coverUrl: song.coverUrl || song.MusicAlbum.coverUrl,
    previewUrl: song.previewUrl,
    previewDuration: Math.min(60, song.previewDuration || 60),
  }] : [])

  const musicMain = <div className="space-y-14 sm:space-y-20">
    <EasMusicCassetteHero songs={cassetteSongs} />
    <MusicAlbumArchiveShowcase carouselAlbums={carouselAlbums} albums={archiveAlbums} />
    <MusicSectionNavigation />
    <section aria-labelledby="eason-in-concert-title">
      <div className="flex flex-wrap items-end justify-between gap-4"><div><p className="text-xs font-black tracking-[0.2em] text-sky-300/70">CONCERT TIMELINE</p><h2 id="eason-in-concert-title" className="mt-2 text-3xl font-black tracking-tight text-white sm:text-4xl">Eason in Concert</h2></div><Link href="/music/concerts" className="text-sm font-black text-sky-300 hover:text-white">进入完整档案 →</Link></div>
      {timelineTours.length ? <div className="mt-8"><MusicConcertTimeline tours={timelineTours.slice(0, 6)} compact /></div> : <p className="mt-7 rounded-3xl border border-white/10 bg-white/[0.06] p-7 text-sm font-bold text-slate-300">演唱会档案正在整理中。</p>}
    </section>
  </div>

  return <MusicArchiveShell variant="home" backgroundVisual={config.heroVisuals.music}><PageLayoutRenderer pageKey="music" config={layoutConfig} modules={{ 'music.main': musicMain }} /></MusicArchiveShell>
}
