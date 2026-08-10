import { NextResponse } from 'next/server'
import { cityGroupSlug, effectiveCityGroup, CITY_GROUP_TYPE_LABEL } from '@/lib/music-slug'
import { checkConcertBadge } from '@/lib/concert-badge'
import { parseBulkAttendanceRequest } from '@/lib/music-live-bulk'
import { PERSONAL_LIVE_NO_STORE_HEADERS, withPersonalNoStore } from '@/lib/music-personal-live'
import { prisma } from '@/lib/prisma'
import { rejectInvalidRequestOrigin, requireUser } from '@/lib/security'

export const dynamic = 'force-dynamic'

const concertOrder = [
  { concertDate: 'asc' as const },
  { startTime: 'asc' as const },
  { createdAt: 'asc' as const },
  { id: 'asc' as const },
]

function buildCatalogCities(concerts: Array<{
  id: string
  title: string | null
  concertDate: Date
  startTime: Date | null
  city: string
  venue: string | null
  sessionNumber: string | null
  stageType: string
  attended: boolean
}>) {
  const groups = new Map<string, {
    id: string
    name: string
    label: string
    concerts: Array<{
      id: string
      title: string | null
      concertDate: string
      startTime: string | null
      venue: string | null
      sessionNumber: string | null
      attended: boolean
    }>
  }>()

  for (const concert of concerts) {
    const group = effectiveCityGroup(concert.city, concert.stageType)
    const groupKey = `${group.base.trim().toLocaleLowerCase('zh-CN')}::${group.type}`
    const current = groups.get(groupKey) || {
      id: cityGroupSlug(group.base, group.type),
      name: group.base,
      label: CITY_GROUP_TYPE_LABEL[group.type],
      concerts: [],
    }
    current.concerts.push({
      id: concert.id,
      title: concert.title,
      concertDate: concert.concertDate.toISOString(),
      startTime: concert.startTime?.toISOString() || null,
      venue: concert.venue,
      sessionNumber: concert.sessionNumber,
      attended: concert.attended,
    })
    groups.set(groupKey, current)
  }

  return [...groups.values()]
}

async function getBatchCatalog(userId: string, tourId?: string) {
  const tours = await prisma.musicTour.findMany({
    where: tourId ? { id: tourId, status: 'PUBLISHED' } : { status: 'PUBLISHED' },
    orderBy: [{ sortOrder: 'asc' }, { startDate: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
    select: {
      id: true,
      name: true,
      MusicConcert: {
        where: { status: 'PUBLISHED' },
        orderBy: concertOrder,
        select: {
          id: true,
          title: true,
          concertDate: true,
          startTime: true,
          city: true,
          venue: true,
          sessionNumber: true,
          stageType: true,
        },
      },
    },
  })
  if (tourId && !tours.length) return null

  const concertIds = tours.flatMap((tour) => tour.MusicConcert.map((concert) => concert.id))
  const attendedRows = concertIds.length
    ? await prisma.userMusicConcert.findMany({
      where: { userId, concertId: { in: concertIds } },
      select: { concertId: true },
    })
    : []
  const attendedIds = new Set(attendedRows.map((row) => row.concertId))

  return {
    tours: tours.map((tour) => ({
      id: tour.id,
      name: tour.name,
      cities: buildCatalogCities(tour.MusicConcert.map((concert) => ({ ...concert, attended: attendedIds.has(concert.id) }))),
    })),
  }
}

async function getPublishedScopeConcerts(tourId?: string) {
  return prisma.musicConcert.findMany({
    where: {
      status: 'PUBLISHED',
      MusicTour: tourId ? { id: tourId, status: 'PUBLISHED' } : { status: 'PUBLISHED' },
    },
    select: { id: true, tourId: true },
  })
}

export async function GET(request: Request) {
  const guard = await requireUser()
  if (!guard.user) return withPersonalNoStore(guard.response)
  const tourId = new URL(request.url).searchParams.get('tourId')?.trim() || undefined
  const catalog = await getBatchCatalog(guard.user.id, tourId)
  if (!catalog) {
    return NextResponse.json({ message: '巡演不存在或暂未公开' }, { status: 404, headers: PERSONAL_LIVE_NO_STORE_HEADERS })
  }
  return NextResponse.json(catalog, { headers: PERSONAL_LIVE_NO_STORE_HEADERS })
}

export async function POST(request: Request) {
  const guard = await requireUser()
  if (!guard.user) return withPersonalNoStore(guard.response)
  const originError = rejectInvalidRequestOrigin(request)
  if (originError) return withPersonalNoStore(originError)

  const parsed = parseBulkAttendanceRequest(await request.json().catch(() => null))
  if (!parsed.data) {
    return NextResponse.json({ message: parsed.message }, { status: 400, headers: PERSONAL_LIVE_NO_STORE_HEADERS })
  }

  const { tourId, addShowIds, removeShowIds } = parsed.data
  if (tourId) {
    const tour = await prisma.musicTour.findFirst({ where: { id: tourId, status: 'PUBLISHED' }, select: { id: true } })
    if (!tour) return NextResponse.json({ message: '巡演不存在或暂未公开' }, { status: 404, headers: PERSONAL_LIVE_NO_STORE_HEADERS })
  }

  const scopeConcerts = await getPublishedScopeConcerts(tourId)
  const scopeIds = new Set(scopeConcerts.map((concert) => concert.id))
  const requestedIds = [...new Set([...addShowIds, ...removeShowIds])]
  const invalidIds = requestedIds.filter((id) => !scopeIds.has(id))
  if (invalidIds.length) {
    return NextResponse.json({ message: '部分场次不存在或暂未公开，请重新打开批量选择' }, { status: 400, headers: PERSONAL_LIVE_NO_STORE_HEADERS })
  }

  const result = await prisma.$transaction(async (tx) => {
    const removed = removeShowIds.length
      ? await tx.userMusicConcert.deleteMany({ where: { userId: guard.user.id, concertId: { in: removeShowIds } } })
      : { count: 0 }
    const created = addShowIds.length
      ? await tx.userMusicConcert.createMany({
        data: addShowIds.map((concertId) => ({ userId: guard.user.id, concertId })),
        skipDuplicates: true,
      })
      : { count: 0 }
    const recordedCount = scopeIds.size
      ? await tx.userMusicConcert.count({ where: { userId: guard.user.id, concertId: { in: [...scopeIds] } } })
      : 0
    return { addedCount: created.count, removedCount: removed.count, recordedCount }
  })

  const badgeSources = [...new Set(scopeConcerts.filter((concert) => addShowIds.includes(concert.id)).map((concert) => concert.tourId))]
    .map((addedTourId) => scopeConcerts.find((concert) => concert.tourId === addedTourId)?.id)
    .filter((concertId): concertId is string => Boolean(concertId))
  await Promise.all(badgeSources.map((concertId) => checkConcertBadge(guard.user!.id, concertId)))

  return NextResponse.json({
    ok: true,
    ...result,
    message: `已更新我的现场，共记录 ${result.recordedCount} 场`,
  }, { headers: PERSONAL_LIVE_NO_STORE_HEADERS })
}
