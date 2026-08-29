import Link from 'next/link'
import { MusicAlbumArchiveShowcase } from '@/components/music/MusicAlbumArchiveShowcase'
import { ConcertCategoryCards } from '@/components/music/ConcertCategoryCards'
import { MusicArchiveShell } from '@/components/music/MusicArchiveShell'
import { EasMusicCassetteHero } from '@/components/music/cassette/EasMusicCassetteHero'
import { MusicConcertTimeline } from '@/components/music/MusicConcertTimeline'
import { MusicSectionNavigation } from '@/components/music/MusicSectionNavigation'
import { PageLayoutRenderer } from '@/components/page-layout/PageLayoutRenderer'
import { getPublishedPageLayoutConfig } from '@/lib/page-layout/service'
import { getCurrentUser } from '@/lib/auth'
import { resolveMusicPlayback } from '@/lib/music-playback'
import { firstPosterUrl, resolveConcertPoster } from '@/lib/music-concert-poster'
import { getEnabledConcertCategories } from '@/lib/music-concert-category'
import { prisma } from '@/lib/prisma'
import { formatMusicReleaseDate } from '@/lib/music-display'
import { getSiteAppearance } from '@/lib/site-config'
import { publicImageVariantUrl } from '@/lib/image-variants'
import { toPublicMediaUrl } from '@/lib/media-url'

export const dynamic = 'force-dynamic'

export default async function MusicPage() {
  const currentUser = await getCurrentUser()
  const [albums, tours, cassetteSourceSongs, layoutConfig, config, categories] = await Promise.all([
    prisma.musicAlbum.findMany({ where: { status: 'PUBLISHED' }, orderBy: [{ displayOrder: 'asc' }, { releaseYear: 'desc' }, { createdAt: 'asc' }], include: { _count: { select: { MusicSong: true } } } }),
    prisma.musicTour.findMany({
      where: currentUser && (currentUser.role === 'ADMIN' || currentUser.role === 'SUPER_ADMIN') ? {} : { status: 'PUBLISHED' },
      orderBy: [{ sortOrder: 'asc' }, { startDate: 'asc' }, { createdAt: 'asc' }],
      include: {
        MusicConcert: { where: currentUser && (currentUser.role === 'ADMIN' || currentUser.role === 'SUPER_ADMIN') ? {} : { status: 'PUBLISHED' }, orderBy: [{ concertDate: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }], select: { city: true, posterUrl: true } },
        _count: { select: { MusicConcert: currentUser && (currentUser.role === 'ADMIN' || currentUser.role === 'SUPER_ADMIN') ? {} : { where: { status: 'PUBLISHED' } } } },
      },
    }),
    prisma.musicSong.findMany({
      where: {
        OR: [
          { previewUrl: { not: null } },
          { sourceAudioPath: { not: null } },
        ],
        MusicAlbum: { status: 'PUBLISHED' },
      },
      orderBy: [{ releaseYear: 'desc' }, { trackNumber: 'asc' }, { createdAt: 'asc' }],
      select: {
        id: true,
        title: true,
        artist: true,
        releaseYear: true,
        language: true,
        coverUrl: true,
        previewUrl: true,
        previewDuration: true,
        sourceAudioPath: true,
        sourceAudioDurationMs: true,
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
    getEnabledConcertCategories().catch(() => []),
  ])
  const carouselAlbums = albums.filter((album) => Boolean(album.coverUrl)).map((album) => ({ id: album.id, name: album.name, artist: album.artist, releaseYear: album.releaseYear, language: album.language, coverUrl: publicImageVariantUrl(album.coverUrl, 'thumb-md')!, songCount: album._count.MusicSong, releaseLabel: formatMusicReleaseDate(album.releaseDate, album.releaseYear) }))
  const archiveAlbums = albums.map((album) => ({ id: album.id, name: album.name, artist: album.artist, releaseYear: album.releaseYear, language: album.language, coverUrl: publicImageVariantUrl(album.coverUrl, 'thumb-md'), songCount: album._count.MusicSong }))
  const timelineTours = tours.map(({ MusicConcert, _count, ...tour }) => ({
    ...tour,
    posterUrl: toPublicMediaUrl(tour.posterUrl),
    ...resolveConcertPoster({ posterUrl: tour.posterUrl, cityPosterUrl: firstPosterUrl(MusicConcert.map((concert) => concert.posterUrl)) }),
    concertCount: _count.MusicConcert,
    cities: [...new Set(MusicConcert.map((concert) => concert.city))],
  }))
  const cassetteSongs = cassetteSourceSongs.flatMap((song) => {
    const playback = resolveMusicPlayback(song, currentUser)
    if (!playback.previewUrl) return []
    return [{
      id: song.id,
      title: song.title,
      artist: song.artist,
      albumId: song.MusicAlbum.id,
      albumTitle: song.MusicAlbum.name,
      releaseYear: song.releaseYear,
      language: song.language,
      coverUrl: publicImageVariantUrl(song.MusicAlbum.coverUrl || song.coverUrl, 'thumb-sm'),
      ...playback,
    }]
  })

  const musicMain = <div className="space-y-14 sm:space-y-20">
    <EasMusicCassetteHero songs={cassetteSongs} />
    <MusicAlbumArchiveShowcase carouselAlbums={carouselAlbums} albums={archiveAlbums} />
    <MusicSectionNavigation />
    <section aria-labelledby="eason-in-concert-title">
      <div className="flex flex-wrap items-end justify-between gap-4"><div><h2 id="eason-in-concert-title" className="text-3xl font-black tracking-tight text-white sm:text-4xl">Eason in Concert</h2></div><Link href="/music/concerts" className="text-sm font-black text-sky-300 hover:text-white">进入完整档案 →</Link></div>
      {categories.length ? <div className="mt-6"><ConcertCategoryCards categories={categories} /></div> : null}
      {timelineTours.length ? <div className="mt-8"><MusicConcertTimeline tours={timelineTours} compact isAdmin={Boolean(currentUser && (currentUser.role === 'ADMIN' || currentUser.role === 'SUPER_ADMIN'))} categories={categories} /></div> : <p className="mt-7 rounded-3xl border border-white/10 bg-white/[0.06] p-7 text-sm font-bold text-slate-300">演唱会档案正在整理中。</p>}
    </section>
  </div>

  return <MusicArchiveShell variant="home" backgroundVisual={config.heroVisuals.music}><PageLayoutRenderer pageKey="music" config={layoutConfig} modules={{ 'music.main': musicMain }} /></MusicArchiveShell>
}
