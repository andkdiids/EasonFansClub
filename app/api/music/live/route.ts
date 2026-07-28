import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

export async function GET() {
  const [tours, latestConcerts] = await Promise.all([
    prisma.musicTour.findMany({
      where: { status: 'PUBLISHED' },
      orderBy: [{ sortOrder: 'asc' }, { startDate: 'desc' }, { createdAt: 'asc' }],
      take: 50,
      select: {
        id: true, name: true, subtitle: true, posterUrl: true, startDate: true, endDate: true,
        MusicConcert: { where: { status: 'PUBLISHED' }, select: { city: true } },
        _count: { select: { MusicConcert: { where: { status: 'PUBLISHED' } } } },
      },
    }),
    prisma.musicConcert.findMany({
      where: { status: 'PUBLISHED', MusicTour: { status: 'PUBLISHED' } },
      orderBy: [{ createdAt: 'desc' }, { concertDate: 'desc' }],
      take: 12,
      select: {
        id: true, title: true, concertDate: true, city: true, venue: true,
        MusicTour: { select: { id: true, name: true } },
        _count: { select: { MusicConcertSetlistItem: true } },
      },
    }),
  ])
  return NextResponse.json({
    tours: tours.map(({ MusicConcert, _count, ...tour }) => ({ ...tour, concertCount: _count.MusicConcert, cityCount: new Set(MusicConcert.map((concert) => concert.city)).size })),
    concerts: latestConcerts.map(({ MusicTour, _count, ...concert }) => ({ ...concert, tour: MusicTour, songCount: _count.MusicConcertSetlistItem })),
  })
}
