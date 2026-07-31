import { NextResponse } from 'next/server'
import { buildConcertSequenceUpdates, DEFAULT_CONCERT_COUNTRY, parseConcertDates } from '@/lib/music-concert-admin'
import { prisma } from '@/lib/prisma'
import { requireAdmin, sanitizeText } from '@/lib/security'

export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
  const guard = await requireAdmin('music_manage')
  if (!guard.user) return guard.response
  const body = await request.json().catch(() => null)
  const tourId = sanitizeText(body?.tourId, 100)
  const sourceCity = sanitizeText(body?.sourceCity, 100)
  const targetCity = sanitizeText(body?.targetCity, 100)
  const options = {
    venue: body?.options?.venue !== false,
    poster: body?.options?.poster !== false,
    description: body?.options?.description !== false,
    setlist: body?.options?.setlist !== false,
    highlights: body?.options?.highlights !== false,
  }
  if (!tourId || !await prisma.musicTour.findUnique({ where: { id: tourId }, select: { id: true } })) {
    return NextResponse.json({ message: '请选择有效巡演' }, { status: 400 })
  }
  if (!sourceCity) return NextResponse.json({ message: '请选择来源城市' }, { status: 400 })
  if (!targetCity) return NextResponse.json({ message: '请填写目标城市' }, { status: 400 })
  const dateResult = parseConcertDates(body?.concertDates ?? [])
  if (!('dates' in dateResult)) return NextResponse.json({ message: dateResult.message }, { status: 400 })
  const concertDates = dateResult.dates!

  const sourceConcerts = await prisma.musicConcert.findMany({
    where: { tourId, city: sourceCity },
    orderBy: [{ concertDate: 'asc' }],
    include: {
      MusicConcertSetlistItem: { orderBy: [{ position: 'asc' }] },
      MusicConcertHighlight: { orderBy: [{ sortOrder: 'asc' }] },
    },
  })
  if (!sourceConcerts.length) {
    return NextResponse.json({ message: `来源城市 ${sourceCity} 暂无场次可复制` }, { status: 400 })
  }

  const duplicates = await prisma.musicConcert.findMany({
    where: { tourId, city: targetCity, concertDate: { in: concertDates } },
    select: { concertDate: true },
  })
  if (duplicates.length) {
    const dates = duplicates.map((item) => item.concertDate.toISOString().slice(0, 10))
    return NextResponse.json(
      { message: `目标城市 ${targetCity} 已存在以下日期的场次：${dates.join('、')}`, duplicateDates: dates },
      { status: 409 },
    )
  }

  try {
    const created = await prisma.$transaction(async (tx) => {
      const createdIds: string[] = []
      for (let index = 0; index < concertDates.length; index++) {
        // 一一对应：第 index 个目标日期复制第 index 个源场次；源场次不足时复用最后一个源场次作为模板
        const source = sourceConcerts[index] ?? sourceConcerts[sourceConcerts.length - 1]
        const concert = await tx.musicConcert.create({
          data: {
            tourId,
            concertDate: concertDates[index],
            city: targetCity,
            title: `${targetCity}站`,
            countryOrRegion: source.countryOrRegion || DEFAULT_CONCERT_COUNTRY,
            venue: options.venue ? (source.venue || null) : null,
            posterUrl: options.poster ? (source.posterUrl || null) : null,
            description: options.description ? (source.description || null) : null,
            status: 'DRAFT',
            sessionNumber: null,
            sortOrder: 0,
          },
        })
        createdIds.push(concert.id)
        if (options.setlist) {
          const items = source.MusicConcertSetlistItem.map((item, position) => ({
            songId: item.songId,
            displayName: item.displayName,
            section: item.section,
            position: position + 1,
            versionName: item.versionName,
            note: item.note,
            isEncore: item.isEncore,
            isRequest: item.isRequest,
            isDebut: item.isDebut,
            isGuest: item.isGuest,
            isMedley: item.isMedley,
            isSpecial: item.isSpecial,
          }))
          if (items.length) {
            await tx.musicConcertSetlistItem.createMany({ data: items.map((item) => ({ ...item, concertId: concert.id })) })
          }
        }
        if (options.highlights) {
          const items = source.MusicConcertHighlight.map((item, position) => ({
            type: item.type,
            title: item.title,
            content: item.content,
            sortOrder: position,
          }))
          if (items.length) {
            await tx.musicConcertHighlight.createMany({ data: items.map((item) => ({ ...item, concertId: concert.id })) })
          }
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
      return tx.musicConcert.findMany({ where: { id: { in: createdIds } }, orderBy: [{ concertDate: 'asc' }] })
    })
    return NextResponse.json(
      { concerts: created, message: `已将 ${sourceCity} 各场次按日期顺序复制到 ${targetCity}，生成 ${created.length} 个草稿场次` },
      { status: 201 },
    )
  } catch (error) {
    console.error('[concert.copy-city]', error)
    return NextResponse.json({ message: '复制城市失败，请重试' }, { status: 500 })
  }
}
