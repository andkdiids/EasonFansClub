import { NextResponse } from 'next/server'
import { parseLiveDate } from '@/lib/music-live'
import { prisma } from '@/lib/prisma'
import { sanitizeText } from '@/lib/security'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams
  const kind = params.get('kind') === 'tours' ? 'tours' : 'concerts'
  if (kind === 'tours') {
    const tours = await prisma.musicTour.findMany({
      where: { status: 'PUBLISHED' },
      orderBy: [{ sortOrder: 'asc' }, { startDate: 'desc' }, { createdAt: 'asc' }],
      take: 200,
      select: { id: true, name: true, category: true, categoryId: true, startDate: true, endDate: true },
    })
    return NextResponse.json({ tours })
  }

  const tourId = sanitizeText(params.get('tourId'), 100)
  const city = sanitizeText(params.get('city'), 100)
  const query = sanitizeText(params.get('q'), 100)
  const dateKey = sanitizeText(params.get('date'), 10)
  const date = dateKey ? parseLiveDate(dateKey, true) : null
  const endDate = date ? new Date(date.getTime() + 24 * 60 * 60 * 1000) : null
  const concerts = await prisma.musicConcert.findMany({
    where: {
      status: 'PUBLISHED',
      MusicTour: { status: 'PUBLISHED' },
      ...(tourId ? { tourId } : {}),
      ...(city ? { city: { contains: city } } : {}),
      ...(date && endDate ? { concertDate: { gte: date, lt: endDate } } : {}),
      ...(query ? { OR: [{ city: { contains: query } }, { venue: { contains: query } }, { title: { contains: query } }, { MusicTour: { name: { contains: query } } }] } : {}),
    },
    orderBy: [{ concertDate: 'desc' }, { startTime: 'asc' }, { createdAt: 'desc' }],
    take: 100,
    select: {
      id: true,
      title: true,
      concertDate: true,
      startTime: true,
      city: true,
      countryOrRegion: true,
      venue: true,
      stageType: true,
      MusicTour: { select: { id: true, name: true, category: true } },
      _count: { select: { MusicConcertSetlistItem: true } },
    },
  })
  return NextResponse.json({ concerts })
}
