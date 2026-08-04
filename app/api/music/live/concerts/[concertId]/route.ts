import { NextResponse } from 'next/server'
import { resolveConcertPoster } from '@/lib/music-concert-poster'
import { prisma } from '@/lib/prisma'

type Context = { params: Promise<{ concertId: string }> }

export async function GET(_request: Request, { params }: Context) {
  const { concertId } = await params
  const concert = await prisma.musicConcert.findFirst({
    where: { id: concertId, status: 'PUBLISHED', MusicTour: { status: 'PUBLISHED' } },
    select: {
      id: true, title: true, concertDate: true, city: true, countryOrRegion: true, venue: true, sessionNumber: true, posterUrl: true, description: true,
      MusicTour: { select: { id: true, name: true, posterUrl: true } },
      MusicConcertSetlistItem: {
        orderBy: [{ position: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
        select: {
          id: true, displayName: true, section: true, position: true, versionName: true, note: true,
          isEncore: true, isRequest: true, isDebut: true, isGuest: true, isMedley: true, isSpecial: true,
          MusicSong: { select: { id: true, title: true, releaseYear: true, MusicAlbum: { select: { name: true } } } },
        },
      },
      MusicConcertHighlight: { orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }], select: { id: true, title: true, content: true, type: true, sortOrder: true } },
    },
  })
  if (!concert) return NextResponse.json({ message: '演唱会场次不存在' }, { status: 404 })
  const cityPoster = await prisma.musicConcert.findFirst({
    where: { tourId: concert.MusicTour.id, city: concert.city, status: 'PUBLISHED', posterUrl: { not: null } },
    orderBy: [{ concertDate: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
    select: { posterUrl: true },
  })
  const { MusicTour, MusicConcertSetlistItem, MusicConcertHighlight, ...data } = concert
  const posterResolution = resolveConcertPoster({ posterUrl: concert.posterUrl, cityPosterUrl: cityPoster?.posterUrl, tourPosterUrl: MusicTour.posterUrl })
  return NextResponse.json({
    concert: {
      ...data,
      tour: MusicTour,
      cityPosterUrl: cityPoster?.posterUrl || null,
      tourPosterUrl: MusicTour.posterUrl,
      resolvedPosterUrl: posterResolution.resolvedPosterUrl,
      posterSource: posterResolution.posterSource,
      setlist: MusicConcertSetlistItem.map(({ MusicSong, ...item }) => ({ ...item, song: MusicSong ? { id: MusicSong.id, title: MusicSong.title, releaseYear: MusicSong.releaseYear, album: MusicSong.MusicAlbum.name } : null })),
      highlights: MusicConcertHighlight,
    },
  })
}
