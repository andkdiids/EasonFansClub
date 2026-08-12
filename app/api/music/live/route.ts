import { NextResponse } from 'next/server'
import { firstPosterUrl, resolveConcertPoster } from '@/lib/music-concert-poster'
import { toPublicMediaUrl } from '@/lib/media-url'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

export async function GET() {
  const [tours, latestConcerts] = await Promise.all([
    prisma.musicTour.findMany({
      where: { status: 'PUBLISHED' },
      orderBy: [{ sortOrder: 'asc' }, { startDate: 'desc' }, { createdAt: 'asc' }],
      take: 50,
      select: {
        id: true, name: true, subtitle: true, posterUrl: true, startDate: true, endDate: true, category: true,
        MusicConcert: { where: { status: 'PUBLISHED' }, orderBy: [{ concertDate: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }], select: { city: true, posterUrl: true } },
        _count: { select: { MusicConcert: { where: { status: 'PUBLISHED' } } } },
      },
    }),
    prisma.musicConcert.findMany({
      where: { status: 'PUBLISHED', MusicTour: { status: 'PUBLISHED' } },
      orderBy: [{ createdAt: 'desc' }, { concertDate: 'desc' }],
      take: 12,
      select: {
        id: true, title: true, concertDate: true, city: true, venue: true, posterUrl: true,
        MusicTour: { select: { id: true, name: true, posterUrl: true } },
        _count: { select: { MusicConcertSetlistItem: true } },
      },
    }),
  ])
  const cityPosters = new Map<string, string>()
  for (const tour of tours) {
    for (const concert of tour.MusicConcert) {
      if (concert.posterUrl && !cityPosters.has(`${tour.id}::${concert.city}`)) cityPosters.set(`${tour.id}::${concert.city}`, concert.posterUrl)
    }
  }
  return NextResponse.json({
    tours: tours.map(({ MusicConcert, _count, ...tour }) => ({
      ...tour,
      posterUrl: toPublicMediaUrl(tour.posterUrl),
      ...resolveConcertPoster({ posterUrl: tour.posterUrl, cityPosterUrl: firstPosterUrl(MusicConcert.map((concert) => concert.posterUrl)) }),
      concertCount: _count.MusicConcert,
      cityCount: new Set(MusicConcert.map((concert) => concert.city)).size,
    })),
    concerts: latestConcerts.map(({ MusicTour, _count, ...concert }) => ({
      ...concert,
      posterUrl: toPublicMediaUrl(concert.posterUrl),
      ...resolveConcertPoster({ posterUrl: concert.posterUrl, cityPosterUrl: cityPosters.get(`${MusicTour.id}::${concert.city}`), tourPosterUrl: MusicTour.posterUrl }),
      tour: { ...MusicTour, posterUrl: toPublicMediaUrl(MusicTour.posterUrl) },
      songCount: _count.MusicConcertSetlistItem,
    })),
  })
}
