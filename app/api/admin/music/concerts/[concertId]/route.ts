import { Prisma } from '@prisma/client'
import { NextResponse } from 'next/server'
import { parseHighlights, parseLiveDate, parseLiveInteger, parsePublicationStatus, parseSetlistItems } from '@/lib/music-live'
import { prisma } from '@/lib/prisma'
import { requireAdmin, sanitizeText } from '@/lib/security'

type Context = { params: Promise<{ concertId: string }> }

const concertInclude = {
  MusicTour: { select: { id: true, name: true } },
  MusicConcertSetlistItem: {
    orderBy: [{ position: 'asc' as const }, { createdAt: 'asc' as const }],
    include: { MusicSong: { select: { id: true, title: true, releaseYear: true, MusicAlbum: { select: { name: true } } } } },
  },
  MusicConcertHighlight: { orderBy: [{ sortOrder: 'asc' as const }, { createdAt: 'asc' as const }] },
}

export async function GET(_request: Request, { params }: Context) {
  const guard = await requireAdmin('music_manage')
  if (!guard.user) return guard.response
  const { concertId } = await params
  const concert = await prisma.musicConcert.findUnique({ where: { id: concertId }, include: concertInclude })
  if (!concert) return NextResponse.json({ message: '演唱会场次不存在' }, { status: 404 })
  const { MusicTour, MusicConcertSetlistItem, MusicConcertHighlight, ...data } = concert
  return NextResponse.json({ concert: { ...data, tour: MusicTour, setlist: MusicConcertSetlistItem.map(({ MusicSong, ...item }) => ({ ...item, song: MusicSong ? { ...MusicSong, album: MusicSong.MusicAlbum.name, MusicAlbum: undefined } : null })), highlights: MusicConcertHighlight } })
}

export async function PATCH(request: Request, { params }: Context) {
  const guard = await requireAdmin('music_manage')
  if (!guard.user) return guard.response
  const { concertId } = await params
  const body = await request.json().catch(() => null)
  const tourId = sanitizeText(body?.tourId, 100)
  const city = sanitizeText(body?.city, 100)
  const concertDate = parseLiveDate(body?.concertDate, true)
  const sortOrder = parseLiveInteger(body?.sortOrder)
  const setlistResult = parseSetlistItems(body?.setlist ?? [])
  const highlightResult = parseHighlights(body?.highlights ?? [])
  if (!tourId || !await prisma.musicTour.findUnique({ where: { id: tourId }, select: { id: true } })) return NextResponse.json({ message: '请选择有效巡演' }, { status: 400 })
  if (!city || !concertDate) return NextResponse.json({ message: '城市和有效演出日期为必填' }, { status: 400 })
  if (sortOrder === undefined) return NextResponse.json({ message: '排序必须是非负整数' }, { status: 400 })
  if (!setlistResult.items) return NextResponse.json({ message: setlistResult.message }, { status: 400 })
  if (!highlightResult.items) return NextResponse.json({ message: highlightResult.message }, { status: 400 })
  const setlistItems = setlistResult.items
  const highlightItems = highlightResult.items
  const songIds = [...new Set(setlistItems.map((item) => item.songId).filter((id): id is string => Boolean(id)))]
  if (songIds.length) {
    const count = await prisma.musicSong.count({ where: { id: { in: songIds } } })
    if (count !== songIds.length) return NextResponse.json({ message: '歌单中包含不存在的歌曲关联，请重新选择' }, { status: 400 })
  }
  try {
    const concert = await prisma.$transaction(async (tx) => {
      const updated = await tx.musicConcert.update({
        where: { id: concertId },
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
      await tx.musicConcertSetlistItem.deleteMany({ where: { concertId } })
      if (setlistItems.length) await tx.musicConcertSetlistItem.createMany({ data: setlistItems.map((item) => ({ ...item, concertId })) })
      await tx.musicConcertHighlight.deleteMany({ where: { concertId } })
      if (highlightItems.length) await tx.musicConcertHighlight.createMany({ data: highlightItems.map((item) => ({ ...item, concertId })) })
      return updated
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
  try {
    await prisma.musicConcert.delete({ where: { id: concertId } })
    return NextResponse.json({ ok: true, message: '场次及其歌单、特别时刻已删除' })
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') return NextResponse.json({ message: '演唱会场次不存在' }, { status: 404 })
    throw error
  }
}
