import type { Prisma } from '@prisma/client'
import { NextResponse } from 'next/server'
import {
  buildConcertSequenceUpdates,
  cloneSetlistItems,
  DEFAULT_CONCERT_COUNTRY,
  parseConcertDates,
} from '@/lib/music-concert-admin'
import { parsePublicationStatus, parseSetlistItems } from '@/lib/music-live'
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
  const dateResult = parseConcertDates(body?.concertDates ?? body?.concertDate)
  const setlistSource = body?.setlistSource === 'NEW' ? 'NEW' : 'PREVIOUS'
  const setlistResult = parseSetlistItems(body?.setlist ?? [])
  if (!tourId || !await prisma.musicTour.findUnique({ where: { id: tourId }, select: { id: true } })) return NextResponse.json({ message: '请选择有效巡演' }, { status: 400 })
  if (!city) return NextResponse.json({ message: '请填写城市' }, { status: 400 })
  if (!('dates' in dateResult)) return NextResponse.json({ message: dateResult.message }, { status: 400 })
  if (!setlistResult.items) return NextResponse.json({ message: setlistResult.message }, { status: 400 })
  const concertDates = dateResult.dates!
  const initialSetlistItems = setlistResult.items
  const duplicate = await prisma.musicConcert.findFirst({
    where: { tourId, city, concertDate: { in: concertDates } },
    select: { concertDate: true },
  })
  if (duplicate) return NextResponse.json({ message: `${duplicate.concertDate.toISOString().slice(0, 10)} 已存在同城市场次` }, { status: 409 })

  const result = await prisma.$transaction(async (tx) => {
    let inheritedItems = initialSetlistItems
    if (setlistSource === 'PREVIOUS') {
      const previous = await tx.musicConcert.findFirst({
        where: { tourId },
        orderBy: [{ concertDate: 'desc' }, { sortOrder: 'desc' }, { createdAt: 'desc' }],
        include: { MusicConcertSetlistItem: { orderBy: [{ position: 'asc' }, { createdAt: 'asc' }] } },
      })
      if (!previous) return { message: '当前巡演还没有上一场歌单，请选择“创建新歌单”' }
      inheritedItems = previous.MusicConcertSetlistItem.map((item) => ({
        songId: item.songId,
        displayName: item.displayName,
        section: item.section,
        position: item.position,
        versionName: item.versionName,
        note: item.note,
        isEncore: item.isEncore,
        isRequest: item.isRequest,
        isDebut: item.isDebut,
        isGuest: item.isGuest,
        isMedley: item.isMedley,
        isSpecial: item.isSpecial,
      }))
    }

    const createdIds: string[] = []
    for (const concertDate of concertDates) {
      const concert = await tx.musicConcert.create({
        data: {
          tourId,
          concertDate,
          city,
          title: sanitizeText(body?.title, 160) || `${city}站`,
          countryOrRegion: sanitizeText(body?.countryOrRegion, 100) || DEFAULT_CONCERT_COUNTRY,
          venue: sanitizeText(body?.venue, 200) || null,
          description: sanitizeText(body?.description, 20_000) || null,
          status: parsePublicationStatus(body?.status),
          sessionNumber: null,
          sortOrder: 0,
        },
      })
      createdIds.push(concert.id)
      if (inheritedItems.length) {
        await tx.musicConcertSetlistItem.createMany({
          data: cloneSetlistItems(inheritedItems, concert.id),
        })
      }
    }
    const allConcerts = await tx.musicConcert.findMany({
      where: { tourId },
      select: { id: true, city: true, concertDate: true, createdAt: true },
    })
    for (const sequence of buildConcertSequenceUpdates(allConcerts)) {
      await tx.musicConcert.update({
        where: { id: sequence.id },
        data: { sessionNumber: sequence.sessionNumber, sortOrder: sequence.sortOrder },
      })
    }
    const concerts = await tx.musicConcert.findMany({
      where: { id: { in: createdIds } },
      orderBy: [{ concertDate: 'asc' }],
    })
    return { concerts }
  })
  if ('message' in result) return NextResponse.json({ message: result.message }, { status: 400 })
  return NextResponse.json({
    concerts: result.concerts,
    concert: result.concerts[0],
    inherited: setlistSource === 'PREVIOUS',
    message: `已创建 ${result.concerts.length} 个场次${setlistSource === 'PREVIOUS' ? '，并继承上一场歌单' : ''}`,
  }, { status: 201 })
}
