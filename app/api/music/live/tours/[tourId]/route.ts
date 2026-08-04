import { NextResponse } from 'next/server'
import { resolveConcertPoster } from '@/lib/music-concert-poster'
import { prisma } from '@/lib/prisma'

type Context = { params: Promise<{ tourId: string }> }

export async function GET(request: Request, { params }: Context) {
  const { tourId } = await params
  const url = new URL(request.url)
  const mode = url.searchParams.get('mode')
  const cityParam = url.searchParams.get('city') || undefined

  if (mode === 'cities') {
    const tour = await prisma.musicTour.findFirst({
      where: { id: tourId, status: 'PUBLISHED' },
      select: {
        id: true, name: true, subtitle: true, description: true, posterUrl: true, startDate: true, endDate: true, category: true,
        MusicConcert: {
          where: { status: 'PUBLISHED' },
          orderBy: [{ concertDate: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
          select: { city: true, concertDate: true, posterUrl: true },
        },
      },
    })
    if (!tour) return NextResponse.json({ message: '巡演不存在' }, { status: 404 })
    const { MusicConcert, ...data } = tour
    const groups = new Map<string, { city: string; count: number; dates: Date[]; posterUrl: string | null }>()
    for (const concert of MusicConcert) {
      const group = groups.get(concert.city) || { city: concert.city, count: 0, dates: [] as Date[], posterUrl: concert.posterUrl }
      group.count += 1
      group.dates.push(concert.concertDate)
      if (!group.posterUrl && concert.posterUrl) group.posterUrl = concert.posterUrl
      groups.set(concert.city, group)
    }
    const cities = [...groups.values()]
      .map((group) => ({
        city: group.city,
        count: group.count,
        posterUrl: group.posterUrl,
        resolvedPosterUrl: resolveConcertPoster({ cityPosterUrl: group.posterUrl, tourPosterUrl: data.posterUrl }).resolvedPosterUrl,
        firstDate: group.dates[0].toISOString().slice(0, 10),
        lastDate: group.dates[group.dates.length - 1].toISOString().slice(0, 10),
      }))
      .sort((left, right) => left.firstDate.localeCompare(right.firstDate) || left.city.localeCompare(right.city, 'zh-CN'))
    return NextResponse.json({ tour: data, cities })
  }

  const tour = await prisma.musicTour.findFirst({
    where: { id: tourId, status: 'PUBLISHED' },
    select: {
      id: true, name: true, subtitle: true, description: true, posterUrl: true, startDate: true, endDate: true, category: true,
      MusicConcert: {
        where: { status: 'PUBLISHED', ...(cityParam ? { city: cityParam } : {}) },
        orderBy: [{ concertDate: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
        select: {
          id: true, title: true, concertDate: true, city: true, venue: true, sessionNumber: true, posterUrl: true,
          _count: { select: { MusicConcertSetlistItem: true, MusicConcertHighlight: true } },
        },
      },
    },
  })
  if (!tour) return NextResponse.json({ message: '巡演不存在' }, { status: 404 })
  const { MusicConcert, ...data } = tour
  const cityPosters = new Map<string, string>()
  for (const concert of MusicConcert) {
    if (concert.posterUrl && !cityPosters.has(concert.city)) cityPosters.set(concert.city, concert.posterUrl)
  }
  return NextResponse.json({
    tour: data,
    concerts: MusicConcert.map(({ _count, ...concert }) => ({
      ...concert,
      ...resolveConcertPoster({ posterUrl: concert.posterUrl, cityPosterUrl: cityPosters.get(concert.city), tourPosterUrl: data.posterUrl }),
      songCount: _count.MusicConcertSetlistItem,
      hasHighlights: _count.MusicConcertHighlight > 0,
    })),
  })
}
