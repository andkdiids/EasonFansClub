import { Prisma } from '@prisma/client'
import { NextResponse } from 'next/server'
import { buildConcertSequenceUpdates, cloneSetlistItems, DEFAULT_CONCERT_COUNTRY } from '@/lib/music-concert-admin'
import { resolveConcertPoster } from '@/lib/music-concert-poster'
import { parseHighlights, parseLiveDate, parsePublicationStatus, parseSetlistItems } from '@/lib/music-live'
import { prisma } from '@/lib/prisma'
import { requireAdmin, sanitizeText } from '@/lib/security'

type Context = { params: Promise<{ concertId: string }> }

async function normalizeTourConcerts(tx: Prisma.TransactionClient, tourId: string) {
  const concerts = await tx.musicConcert.findMany({
    where: { tourId },
    select: { id: true, city: true, stageType: true, concertDate: true, createdAt: true, sortOrder: true },
  })
  for (const sequence of buildConcertSequenceUpdates(concerts)) {
    await tx.musicConcert.update({
      where: { id: sequence.id },
      data: { sessionNumber: sequence.sessionNumber, sortOrder: sequence.sortOrder },
    })
  }
}

const concertInclude = {
  MusicTour: { select: { id: true, name: true, posterUrl: true } },
  MusicConcertSetlistItem: {
    orderBy: [{ position: 'asc' as const }, { createdAt: 'asc' as const }, { id: 'asc' as const }],
    include: { MusicSong: { select: { id: true, title: true, releaseYear: true, MusicAlbum: { select: { name: true } } } } },
  },
  MusicConcertHighlight: { orderBy: [{ sortOrder: 'asc' as const }, { createdAt: 'asc' as const }] },
  _count: { select: { UserMusicConcert: true } },
}

export async function GET(_request: Request, { params }: Context) {
  const guard = await requireAdmin('music_manage')
  if (!guard.user) return guard.response
  const { concertId } = await params
  const concert = await prisma.musicConcert.findUnique({ where: { id: concertId }, include: concertInclude })
  if (!concert) return NextResponse.json({ message: '演唱会场次不存在' }, { status: 404 })
  const cityPoster = await prisma.musicConcert.findFirst({
    where: { tourId: concert.tourId, city: concert.city, id: { not: concert.id }, posterUrl: { not: null } },
    orderBy: [{ concertDate: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
    select: { posterUrl: true },
  })
  const { MusicTour, MusicConcertSetlistItem, MusicConcertHighlight, ...data } = concert
  const posterResolution = resolveConcertPoster({ posterUrl: concert.posterUrl, cityPosterUrl: cityPoster?.posterUrl, tourPosterUrl: MusicTour.posterUrl })
  return NextResponse.json({ concert: {
    ...data,
    tour: MusicTour,
    cityPosterUrl: cityPoster?.posterUrl || null,
    tourPosterUrl: MusicTour.posterUrl,
    resolvedPosterUrl: posterResolution.resolvedPosterUrl,
    posterSource: posterResolution.posterSource,
    setlist: MusicConcertSetlistItem.map(({ MusicSong, ...item }) => ({ ...item, song: MusicSong ? { ...MusicSong, album: MusicSong.MusicAlbum.name, MusicAlbum: undefined } : null })),
    highlights: MusicConcertHighlight,
  } })
}

export async function PATCH(request: Request, { params }: Context) {
  const guard = await requireAdmin('music_manage')
  if (!guard.user) return guard.response
  const { concertId } = await params
  const body = await request.json().catch(() => null)
  const hasPosterUrl = Boolean(body && typeof body === 'object' && 'posterUrl' in body)
  const tourId = sanitizeText(body?.tourId, 100)
  const city = sanitizeText(body?.city, 100)
  const STAGE_TYPES = ['NORMAL', 'ENCORE', 'FINAL'] as const
  const stageType = STAGE_TYPES.includes(body?.stageType) ? (body.stageType as 'NORMAL' | 'ENCORE' | 'FINAL') : 'NORMAL'
  const concertDate = parseLiveDate(body?.concertDate, true)
  const setlistResult = parseSetlistItems(body?.setlist ?? [])
  const highlightResult = parseHighlights(body?.highlights ?? [])
  if (!tourId || !await prisma.musicTour.findUnique({ where: { id: tourId }, select: { id: true } })) return NextResponse.json({ message: '请选择有效巡演' }, { status: 400 })
  if (!city || !concertDate) return NextResponse.json({ message: '城市和有效演出日期为必填' }, { status: 400 })
  if (!setlistResult.items) return NextResponse.json({ message: setlistResult.message }, { status: 400 })
  if (!highlightResult.items) return NextResponse.json({ message: highlightResult.message }, { status: 400 })
  const setlistItems = setlistResult.items
  const highlightItems = highlightResult.items
  const songIds = [...new Set(setlistItems.map((item) => item.songId).filter((id): id is string => Boolean(id)))]
  if (songIds.length) {
    const count = await prisma.musicSong.count({ where: { id: { in: songIds } } })
    if (count !== songIds.length) return NextResponse.json({ message: '歌单中包含不存在的歌曲关联，请重新选择' }, { status: 400 })
  }
  const existingConcert = await prisma.musicConcert.findUnique({ where: { id: concertId }, select: { tourId: true } })
  if (!existingConcert) return NextResponse.json({ message: '演唱会场次不存在' }, { status: 404 })
  try {
    const concert = await prisma.$transaction(async (tx) => {
      const updated = await tx.musicConcert.update({
        where: { id: concertId },
        data: {
          tourId,
          concertDate,
          city,
          stageType,
          title: sanitizeText(body?.title, 160) || null,
          countryOrRegion: sanitizeText(body?.countryOrRegion, 100) || DEFAULT_CONCERT_COUNTRY,
          venue: sanitizeText(body?.venue, 200) || null,
          ...(hasPosterUrl ? { posterUrl: sanitizeText(body?.posterUrl, 1000) || null } : {}),
          description: sanitizeText(body?.description, 20_000) || null,
          status: parsePublicationStatus(body?.status),
        },
      })
      await tx.musicConcertSetlistItem.deleteMany({ where: { concertId } })
      if (setlistItems.length) await tx.musicConcertSetlistItem.createMany({ data: cloneSetlistItems(setlistItems, concertId) })
      await tx.musicConcertHighlight.deleteMany({ where: { concertId } })
      if (highlightItems.length) await tx.musicConcertHighlight.createMany({ data: highlightItems.map((item) => ({ ...item, concertId })) })
      await normalizeTourConcerts(tx, tourId)
      if (existingConcert.tourId !== tourId) await normalizeTourConcerts(tx, existingConcert.tourId)
      return tx.musicConcert.findUniqueOrThrow({ where: { id: updated.id } })
    })
    return NextResponse.json({ concert, message: concert.status === 'PUBLISHED' ? '场次已发布并保存' : '场次草稿已保存' })
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') return NextResponse.json({ message: '演唱会场次不存在' }, { status: 404 })
    throw error
  }
}

export async function DELETE(_request: Request, { params }: Context) {
  const guard = await requireAdmin('music_manage')
  if (!guard.user) return guard.response
  const { concertId } = await params
  const concert = await prisma.musicConcert.findUnique({
    where: { id: concertId },
    select: { tourId: true, _count: { select: { UserMusicConcert: true } } },
  })
  if (!concert) return NextResponse.json({ message: '演唱会场次不存在' }, { status: 404 })
  if (concert._count.UserMusicConcert > 0) {
    return NextResponse.json({
      message: `该场次已有 ${concert._count.UserMusicConcert} 条用户观演记录，不能直接删除。请先确认是否仅转为草稿。`,
      attendanceCount: concert._count.UserMusicConcert,
    }, { status: 409 })
  }
  try {
    await prisma.$transaction(async (tx) => {
      await tx.musicConcert.delete({ where: { id: concertId } })
      await normalizeTourConcerts(tx, concert.tourId)
    })
    return NextResponse.json({ ok: true, message: '场次及其歌单、特别时刻已删除' })
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') return NextResponse.json({ message: '演唱会场次不存在' }, { status: 404 })
    throw error
  }
}
