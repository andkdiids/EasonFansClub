import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

type Context = { params: Promise<{ tourId: string }> }

export async function GET(_request: Request, { params }: Context) {
  const { tourId } = await params
  const tour = await prisma.musicTour.findFirst({
    where: { id: tourId, status: 'PUBLISHED' },
    select: {
      id: true, name: true, subtitle: true, description: true, posterUrl: true, startDate: true, endDate: true,
      MusicConcert: {
        where: { status: 'PUBLISHED' },
        orderBy: [{ concertDate: 'asc' }, { sortOrder: 'asc' }, { createdAt: 'asc' }],
        select: {
          id: true, title: true, concertDate: true, city: true, venue: true, sessionNumber: true,
          _count: { select: { MusicConcertSetlistItem: true, MusicConcertHighlight: true } },
        },
      },
    },
  })
  if (!tour) return NextResponse.json({ message: '巡演不存在' }, { status: 404 })
  const { MusicConcert, ...data } = tour
  return NextResponse.json({
    tour: data,
    concerts: MusicConcert.map(({ _count, ...concert }) => ({ ...concert, songCount: _count.MusicConcertSetlistItem, hasHighlights: _count.MusicConcertHighlight > 0 })),
  })
}
