import type { Prisma } from '@prisma/client'
import { NextResponse } from 'next/server'
import { parsePersonalPageSize, parsePositivePage, PERSONAL_LIVE_NO_STORE_HEADERS, withPersonalNoStore } from '@/lib/music-personal-live'
import { prisma } from '@/lib/prisma'
import { requireUser, sanitizeText } from '@/lib/security'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const guard = await requireUser()
  if (!guard.user) return withPersonalNoStore(guard.response)
  const params = new URL(request.url).searchParams
  const page = parsePositivePage(params.get('page'))
  const pageSize = parsePersonalPageSize(params.get('pageSize'))
  const tourId = sanitizeText(params.get('tourId'), 100)
  const city = sanitizeText(params.get('city'), 100)
  const year = Number(params.get('year'))
  const visibility = params.get('visibility')
  const sort = params.get('sort')
  const concertWhere: Prisma.MusicConcertWhereInput = {
    ...(tourId ? { tourId } : {}),
    ...(city ? { city: { equals: city } } : {}),
    ...(Number.isInteger(year) && year >= 1900 && year <= 2100 ? {
      concertDate: {
        gte: new Date(`${year}-01-01T00:00:00.000Z`),
        lt: new Date(`${year + 1}-01-01T00:00:00.000Z`),
      },
    } : {}),
  }
  const where: Prisma.UserMusicConcertWhereInput = {
    userId: guard.user.id,
    ...(Object.keys(concertWhere).length ? { MusicConcert: concertWhere } : {}),
    ...(visibility === 'public' ? { isPublic: true } : visibility === 'private' ? { isPublic: false } : {}),
  }
  const orderBy: Prisma.UserMusicConcertOrderByWithRelationInput[] = sort === 'oldest'
    ? [{ MusicConcert: { concertDate: 'asc' } }, { createdAt: 'asc' }]
    : sort === 'added'
      ? [{ createdAt: 'desc' }]
      : [{ MusicConcert: { concertDate: 'desc' } }, { createdAt: 'desc' }]
  const [total, rows] = await Promise.all([
    prisma.userMusicConcert.count({ where }),
    prisma.userMusicConcert.findMany({
      where,
      orderBy,
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: {
        id: true, seatInfo: true, mood: true, note: true, isPublic: true, createdAt: true, updatedAt: true,
        MusicConcert: {
          select: {
            id: true, title: true, concertDate: true, city: true, venue: true, sessionNumber: true, posterUrl: true, status: true,
            MusicTour: { select: { id: true, name: true, posterUrl: true, status: true } },
            _count: { select: { MusicConcertSetlistItem: true } },
          },
        },
      },
    }),
  ])
  return NextResponse.json({
    page,
    pageSize,
    total,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
    records: rows.map((row) => {
      const available = row.MusicConcert.status === 'PUBLISHED' && row.MusicConcert.MusicTour.status === 'PUBLISHED'
      if (!available) return { id: row.id, concertId: row.MusicConcert.id, unavailable: true, createdAt: row.createdAt }
      return {
        id: row.id,
        concertId: row.MusicConcert.id,
        unavailable: false,
        seatInfo: row.seatInfo,
        mood: row.mood,
        note: row.note,
        isPublic: row.isPublic,
        createdAt: row.createdAt,
        concert: { ...row.MusicConcert, tour: row.MusicConcert.MusicTour, MusicTour: undefined, setlistCount: row.MusicConcert._count.MusicConcertSetlistItem, _count: undefined },
      }
    }),
  }, { headers: PERSONAL_LIVE_NO_STORE_HEADERS })
}
