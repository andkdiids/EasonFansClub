import type { Prisma } from '@prisma/client'
import { NextResponse } from 'next/server'
import {
  buildConcertSequenceUpdates,
  cloneSetlistItems,
  combineDateAndTime,
  DEFAULT_CONCERT_COUNTRY,
  parseConcertDates,
} from '@/lib/music-concert-admin'
import { parseLiveDate, parsePublicationStatus, parseSetlistItems } from '@/lib/music-live'
import { resolveConcertPoster } from '@/lib/music-concert-poster'
import { toPublicMediaUrl } from '@/lib/media-url'
import { prisma } from '@/lib/prisma'
import { requireAdmin, sanitizeText } from '@/lib/security'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const guard = await requireAdmin('music_manage')
  if (!guard.user) return guard.response
  const params = new URL(request.url).searchParams
  const tourId = sanitizeText(params.get('tourId'), 100)
  const city = sanitizeText(params.get('city'), 100)
  const mode = params.get('mode')
  const excludeId = sanitizeText(params.get('excludeId'), 100)
  const status = params.get('status')
  const keyword = sanitizeText(params.get('q'), 100)
  const year = Number(params.get('year'))
  const startDate = parseLiveDate(params.get('startDate'))
  const endDate = parseLiveDate(params.get('endDate'))
  const pageValue = Number(params.get('page'))
  const pageSizeValue = Number(params.get('pageSize'))
  const page = Number.isInteger(pageValue) && pageValue > 0 ? Math.min(pageValue, 10_000) : 1
  const pageSize = Number.isInteger(pageSizeValue) && pageSizeValue > 0 ? Math.min(pageSizeValue, 100) : 50
  const idsOnly = params.get('idsOnly') === '1'

  if (startDate && endDate && startDate.getTime() > endDate.getTime()) {
    return NextResponse.json({ message: '开始日期不能晚于结束日期' }, { status: 400 })
  }

  // 城市分组模式：仅返回该巡演下的城市及其场次计数（含首尾日期），不加载全部场次，
  // 避免未来单巡演超过 200 场时被截断。
  if (mode === 'cities') {
    if (!tourId) return NextResponse.json({ cities: [] })
    const grouped = await prisma.musicConcert.groupBy({
      by: ['city'],
      where: { tourId },
      _count: { _all: true },
      _min: { concertDate: true },
      _max: { concertDate: true },
    })
    const posterRows = await prisma.musicConcert.findMany({
      where: { tourId, posterUrl: { not: null } },
      orderBy: [{ concertDate: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
      select: { city: true, posterUrl: true },
    })
    const cityPosters = new Map<string, string>()
    for (const row of posterRows) if (row.posterUrl && !cityPosters.has(row.city)) cityPosters.set(row.city, row.posterUrl)
    const cities = grouped
      .map((group) => ({
        city: group.city,
        count: group._count._all,
        firstDate: group._min.concertDate ? group._min.concertDate.toISOString().slice(0, 10) : null,
        lastDate: group._max.concertDate ? group._max.concertDate.toISOString().slice(0, 10) : null,
        posterUrl: cityPosters.get(group.city) || null,
      }))
      .sort((left, right) => left.city.localeCompare(right.city, 'zh-CN'))
    return NextResponse.json({ cities: cities.map((city) => ({ ...city, posterUrl: toPublicMediaUrl(city.posterUrl) })) })
  }

  if (mode === 'copy-options') {
    const concerts = await prisma.musicConcert.findMany({
      where: {
        ...(tourId ? { tourId } : {}),
        ...(excludeId ? { id: { not: excludeId } } : {}),
      },
      orderBy: [{ concertDate: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
      select: {
        id: true,
        city: true,
        concertDate: true,
        sessionNumber: true,
        sortOrder: true,
        MusicTour: { select: { id: true, name: true } },
      },
    })
    return NextResponse.json({
      concerts: concerts.map(({ MusicTour, ...concert }) => ({ ...concert, tour: MusicTour })),
    })
  }

  const yearStart = Number.isInteger(year) && year >= 1900 && year <= 2100 ? new Date(`${year}-01-01T00:00:00.000Z`) : null
  const dateFilter: Prisma.DateTimeFilter = {}
  if (startDate) dateFilter.gte = startDate
  if (endDate) dateFilter.lt = new Date(endDate.getTime() + 24 * 60 * 60 * 1000)
  const where: Prisma.MusicConcertWhereInput = {
    ...(tourId ? { tourId } : {}),
    ...(city ? { city } : {}),
    ...(excludeId ? { id: { not: excludeId } } : {}),
    ...(status === 'DRAFT' || status === 'PUBLISHED' ? { status: status as 'DRAFT' | 'PUBLISHED' } : {}),
    ...(yearStart ? { concertDate: { gte: yearStart, lt: new Date(`${year + 1}-01-01T00:00:00.000Z`) } } : {}),
    ...(Object.keys(dateFilter).length ? { concertDate: dateFilter } : {}),
    ...(keyword ? { OR: [{ title: { contains: keyword } }, { city: { contains: keyword } }, { venue: { contains: keyword } }, { sessionNumber: { contains: keyword } }, { MusicTour: { name: { contains: keyword } } }] } : {}),
  }
  if (idsOnly) {
    const ids = await prisma.musicConcert.findMany({ where, orderBy: [{ concertDate: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }], select: { id: true } })
    return NextResponse.json({ ids: ids.map((item) => item.id), total: ids.length })
  }
  const [total, concerts] = await Promise.all([
    prisma.musicConcert.count({ where }),
    prisma.musicConcert.findMany({
    where,
      orderBy: [{ concertDate: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
    include: { MusicTour: { select: { id: true, name: true, posterUrl: true } }, _count: { select: { MusicConcertSetlistItem: true, MusicConcertHighlight: true, UserMusicConcert: true } } },
    // city 级查询（三级浏览第三级）不限制条数，避免单城市场次被截断；平铺模式保留 200 上限
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
  ])
  const tourIds = [...new Set(concerts.map((concert) => concert.tourId))]
  const posterCandidates = tourIds.length
    ? await prisma.musicConcert.findMany({
      where: { tourId: { in: tourIds }, posterUrl: { not: null } },
      orderBy: [{ concertDate: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
      select: { tourId: true, city: true, posterUrl: true },
    })
    : []
  const cityPosters = new Map<string, string>()
  const tourPosters = new Map<string, string>()
  for (const candidate of posterCandidates) {
    if (!candidate.posterUrl) continue
    const cityKey = `${candidate.tourId}::${candidate.city}`
    if (!cityPosters.has(cityKey)) cityPosters.set(cityKey, candidate.posterUrl)
    if (!tourPosters.has(candidate.tourId)) tourPosters.set(candidate.tourId, candidate.posterUrl)
  }
  return NextResponse.json({
    concerts: concerts.map(({ MusicTour, _count, ...concert }) => ({
      ...concert,
      posterUrl: toPublicMediaUrl(concert.posterUrl),
      tour: { ...MusicTour, posterUrl: toPublicMediaUrl(MusicTour.posterUrl) },
      setlistCount: _count.MusicConcertSetlistItem,
      highlightCount: _count.MusicConcertHighlight,
      attendanceCount: _count.UserMusicConcert,
      ...resolveConcertPoster({
        posterUrl: concert.posterUrl,
        cityPosterUrl: cityPosters.get(`${concert.tourId}::${concert.city}`),
        tourPosterUrl: MusicTour.posterUrl || tourPosters.get(concert.tourId),
      }),
    })),
    pagination: { page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) },
  })
}

export async function POST(request: Request) {
  const guard = await requireAdmin('music_manage')
  if (!guard.user) return guard.response
  const body = await request.json().catch(() => null)
  const tourId = sanitizeText(body?.tourId, 100)
  const city = sanitizeText(body?.city, 100)
  const STAGE_TYPES = ['NORMAL', 'ENCORE', 'FINAL'] as const
  const stageType = STAGE_TYPES.includes(body?.stageType) ? (body.stageType as 'NORMAL' | 'ENCORE' | 'FINAL') : 'NORMAL'
  const dateResult = parseConcertDates(body?.concertDates ?? body?.concertDate)
  const setlistSource = body?.setlistSource === 'NEW' || body?.setlistSource === 'SOURCE' ? body.setlistSource : 'PREVIOUS'
  const sourceConcertId = sanitizeText(body?.sourceConcertId, 100)
  const setlistResult = parseSetlistItems(body?.setlist ?? [])
  if (!tourId || !await prisma.musicTour.findUnique({ where: { id: tourId }, select: { id: true } })) return NextResponse.json({ message: '请选择有效巡演' }, { status: 400 })
  if (!city) return NextResponse.json({ message: '请填写城市' }, { status: 400 })
  if (!('dates' in dateResult)) return NextResponse.json({ message: dateResult.message }, { status: 400 })
  if (!setlistResult.items) return NextResponse.json({ message: setlistResult.message }, { status: 400 })
  if (setlistSource === 'SOURCE' && !sourceConcertId) return NextResponse.json({ message: '请选择当前巡演下的来源场次' }, { status: 400 })
  const concertDates = dateResult.dates!
  const initialSetlistItems = setlistResult.items
  // 同一天可创建多场（如下午场 18:00 / 晚上场 20:30），故不再按（城市, 场次类型, 日期）拦截重复。
  // 开始/结束时间可选；缺失时该场次时间字段为 null，展示层回退到旧格式。
  const startTime = sanitizeText(body?.startTime, 5)
  const endTime = sanitizeText(body?.endTime, 5)

  const result = await prisma.$transaction(async (tx) => {
    let inheritedItems = initialSetlistItems
    if (setlistSource === 'PREVIOUS') {
      const previous = await tx.musicConcert.findFirst({
        where: { tourId },
        orderBy: [{ concertDate: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }],
        include: { MusicConcertSetlistItem: { orderBy: [{ position: 'asc' }] } },
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
    if (setlistSource === 'SOURCE') {
      const source = await tx.musicConcert.findFirst({
        where: { id: sourceConcertId, tourId },
        include: { MusicConcertSetlistItem: { orderBy: [{ position: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }] } },
      })
      if (!source) return { message: '来源场次不存在或不属于当前巡演' }
      inheritedItems = source.MusicConcertSetlistItem.map((item) => ({
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
          stageType,
          title: sanitizeText(body?.title, 160) || `${city}站`,
          countryOrRegion: sanitizeText(body?.countryOrRegion, 100) || DEFAULT_CONCERT_COUNTRY,
          venue: sanitizeText(body?.venue, 200) || null,
          posterUrl: toPublicMediaUrl(sanitizeText(body?.posterUrl, 1000)) || null,
          description: sanitizeText(body?.description, 20_000) || null,
          status: parsePublicationStatus(body?.status),
          startTime: combineDateAndTime(concertDate, startTime),
          endTime: combineDateAndTime(concertDate, endTime),
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
      select: { id: true, city: true, stageType: true, concertDate: true, startTime: true, endTime: true, createdAt: true, sortOrder: true },
    })
    for (const sequence of buildConcertSequenceUpdates(allConcerts)) {
      await tx.musicConcert.update({
        where: { id: sequence.id },
        data: { sessionNumber: sequence.sessionNumber, sortOrder: sequence.sortOrder },
      })
    }
    const concerts = await tx.musicConcert.findMany({
      where: { id: { in: createdIds } },
      orderBy: [{ sortOrder: 'asc' }, { concertDate: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
    })
    return { concerts }
  })
  if ('message' in result) return NextResponse.json({ message: result.message }, { status: 400 })
  const publicConcerts = result.concerts.map((concert) => ({ ...concert, posterUrl: toPublicMediaUrl(concert.posterUrl) }))
  return NextResponse.json({
    concerts: publicConcerts,
    concert: publicConcerts[0],
    inherited: setlistSource !== 'NEW',
    sourceConcertId: setlistSource === 'SOURCE' ? sourceConcertId : null,
    message: `已创建 ${result.concerts.length} 个场次${setlistSource === 'PREVIOUS' ? '，并继承上一场歌单' : setlistSource === 'SOURCE' ? '，并复制来源场次歌单' : ''}`,
  }, { status: 201 })
}
