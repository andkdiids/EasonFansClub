import type { Prisma } from '@prisma/client'
import { NextResponse } from 'next/server'
import { parseLiveDate, parseLiveInteger, parsePublicationStatus } from '@/lib/music-live'
import { prisma } from '@/lib/prisma'
import { requireAdmin, sanitizeText } from '@/lib/security'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const guard = await requireAdmin('music_manage')
  if (!guard.user) return guard.response
  const params = new URL(request.url).searchParams
  const tourId = sanitizeText(params.get('tourId'), 100)
  const city = sanitizeText(params.get('city'), 100)
  const status = params.get('status')
  const keyword = sanitizeText(params.get('q'), 100)
  const year = Number(params.get('year'))
  const yearStart = Number.isInteger(year) && year >= 1900 && year <= 2100 ? new Date(`${year}-01-01T00:00:00.000Z`) : null
  const where: Prisma.MusicConcertWhereInput = {
    ...(tourId ? { tourId } : {}),
    ...(city ? { city } : {}),
    ...(status === 'DRAFT' || status === 'PUBLISHED' ? { status: status as 'DRAFT' | 'PUBLISHED' } : {}),
    ...(yearStart ? { concertDate: { gte: yearStart, lt: new Date(`${year + 1}-01-01T00:00:00.000Z`) } } : {}),
    ...(keyword ? { OR: [{ title: { contains: keyword } }, { city: { contains: keyword } }, { venue: { contains: keyword } }, { sessionNumber: { contains: keyword } }, { MusicTour: { name: { contains: keyword } } }] } : {}),
  }
  const concerts = await prisma.musicConcert.findMany({
    where,
    orderBy: [{ concertDate: 'desc' }, { sortOrder: 'asc' }, { createdAt: 'desc' }],
    include: { MusicTour: { select: { id: true, name: true } }, _count: { select: { MusicConcertSetlistItem: true, MusicConcertHighlight: true, UserMusicConcert: true } } },
    take: 200,
  })
  return NextResponse.json({
    concerts: concerts.map(({ MusicTour, _count, ...concert }) => ({
      ...concert,
      tour: MusicTour,
      setlistCount: _count.MusicConcertSetlistItem,
      highlightCount: _count.MusicConcertHighlight,
      attendanceCount: _count.UserMusicConcert,
    })),
  })
}

export async function POST(request: Request) {
  const guard = await requireAdmin('music_manage')
  if (!guard.user) return guard.response
  const body = await request.json().catch(() => null)
  const tourId = sanitizeText(body?.tourId, 100)
  const city = sanitizeText(body?.city, 100)
  const concertDate = parseLiveDate(body?.concertDate, true)
  const sortOrder = parseLiveInteger(body?.sortOrder)
  if (!tourId || !await prisma.musicTour.findUnique({ where: { id: tourId }, select: { id: true } })) return NextResponse.json({ message: '请选择有效巡演' }, { status: 400 })
  if (!city) return NextResponse.json({ message: '请填写城市' }, { status: 400 })
  if (!concertDate) return NextResponse.json({ message: '请填写有效演出日期' }, { status: 400 })
  if (sortOrder === undefined) return NextResponse.json({ message: '排序必须是非负整数' }, { status: 400 })
  const concert = await prisma.musicConcert.create({
    data: {
      tourId,
      concertDate,
      city,
      title: sanitizeText(body?.title, 160) || null,
      countryOrRegion: sanitizeText(body?.countryOrRegion, 100) || null,
      venue: sanitizeText(body?.venue, 200) || null,
      sessionNumber: sanitizeText(body?.sessionNumber, 100) || null,
      posterUrl: sanitizeText(body?.posterUrl, 1000) || null,
      description: sanitizeText(body?.description, 20_000) || null,
      status: parsePublicationStatus(body?.status),
      sortOrder,
    },
  })
  return NextResponse.json({ concert, message: '场次已创建' }, { status: 201 })
}
