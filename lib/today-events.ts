import { parseCalendarDate } from '@/lib/calendar-date'
import { safeDb } from '@/lib/db-timeout'
import { publicImageUrl } from '@/lib/images'
import { resolveConcertPoster } from '@/lib/music-concert-poster'
import { buildConcertSlugPath } from '@/lib/music-slug'
import { prisma } from '@/lib/prisma'
import { getTodayEventDateParts, getTodayMonthDay, type TodayEventSourceValue, type TodayEventTypeValue } from '@/lib/today'

export type TodayEventRecord = {
  id: string
  date: string
  year: number
  month: number
  day: number
  type: TodayEventTypeValue
  title: string
  content: string
  imageUrl: string | null
  source: TodayEventSourceValue
  reference: string | null
  status: 'APPROVED'
  href: string | null
}

function dateParts(value: Date) {
  return parseCalendarDate(value)
}

function isTodayMonthDay(value: Date, month: number, day: number) {
  const parts = dateParts(value)
  return parts.month === month && parts.day === day
}

function sortTodayEvents(a: TodayEventRecord, b: TodayEventRecord) {
  return b.year - a.year || b.date.localeCompare(a.date) || a.title.localeCompare(b.title, 'zh-CN')
}

async function loadManualTodayEvents(month: number, day: number) {
  const rows = await safeDb(
    'TodayEvent.findMany today.events',
    prisma.todayEvent.findMany({
      where: { month, day, status: 'APPROVED' },
      orderBy: [{ date: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }],
      take: 200,
      select: {
        id: true,
        date: true,
        month: true,
        day: true,
        type: true,
        title: true,
        content: true,
        imageUrl: true,
        source: true,
        reference: true,
        status: true,
      },
    }),
    [],
    8000,
  )

  return rows.map((event) => {
    const parts = getTodayEventDateParts(event.date, event.month, event.day)
    return {
      id: event.id,
      date: parts.key,
      year: parts.year,
      month: parts.month,
      day: parts.day,
      type: event.type,
      title: event.title,
      content: event.content,
      imageUrl: publicImageUrl(event.imageUrl),
      source: event.source,
      reference: event.reference,
      status: 'APPROVED' as const,
      href: null,
    }
  })
}

async function loadAutomaticTodayEvents(month: number, day: number) {
  const [albums, concerts] = await Promise.all([
    safeDb(
      'MusicAlbum.findMany today.auto.albums',
      prisma.musicAlbum.findMany({
        where: { status: 'PUBLISHED', releaseDate: { not: null } },
        orderBy: [{ releaseDate: 'desc' }, { id: 'desc' }],
        take: 5000,
        select: { id: true, name: true, artist: true, releaseDate: true, coverUrl: true },
      }),
      [],
      8000,
    ),
    safeDb(
      'MusicConcert.findMany today.auto.concerts',
      prisma.musicConcert.findMany({
        where: { status: 'PUBLISHED', MusicTour: { status: 'PUBLISHED' } },
        orderBy: [{ concertDate: 'desc' }, { id: 'desc' }],
        take: 5000,
        select: {
          id: true,
          title: true,
          concertDate: true,
          city: true,
          venue: true,
          stageType: true,
          posterUrl: true,
          MusicTour: { select: { name: true, posterUrl: true } },
        },
      }),
      [],
      8000,
    ),
  ])

  const albumEvents: TodayEventRecord[] = albums.flatMap((album) => {
    if (!album.releaseDate || !isTodayMonthDay(album.releaseDate, month, day)) return []
    const parts = dateParts(album.releaseDate)
    return [{
      id: `auto-album-${album.id}`,
      date: parts.key,
      year: parts.year,
      month: parts.month,
      day: parts.day,
      type: 'ALBUM',
      title: `《${album.name}》发行`,
      content: `${album.artist}专辑《${album.name}》于${parts.year}年发行。`,
      imageUrl: publicImageUrl(album.coverUrl),
      source: 'AUTO',
      reference: 'EasMusic',
      status: 'APPROVED',
      href: `/music/album/${album.id}`,
    }]
  })

  const concertEvents: TodayEventRecord[] = concerts.flatMap((concert) => {
    if (!isTodayMonthDay(concert.concertDate, month, day)) return []
    const parts = dateParts(concert.concertDate)
    const title = concert.title?.trim() || `${concert.MusicTour.name} · ${concert.city}`
    const posterUrl = resolveConcertPoster({ posterUrl: concert.posterUrl, tourPosterUrl: concert.MusicTour.posterUrl }).resolvedPosterUrl
    return [{
      id: `auto-concert-${concert.id}`,
      date: parts.key,
      year: parts.year,
      month: parts.month,
      day: parts.day,
      type: 'CONCERT',
      title,
      content: `${concert.MusicTour.name} · ${concert.city}${concert.venue ? ` · ${concert.venue}` : ''}`,
      imageUrl: publicImageUrl(posterUrl),
      source: 'AUTO',
      reference: 'MusicConcert',
      status: 'APPROVED',
      href: buildConcertSlugPath(concert.MusicTour.name, concert.city, concert.concertDate, concert.stageType),
    }]
  })

  return [...albumEvents, ...concertEvents]
}

export async function getTodayEventRecords(now = new Date()) {
  const { month, day } = getTodayMonthDay(now)
  const [manualEvents, automaticEvents] = await Promise.all([
    loadManualTodayEvents(month, day),
    loadAutomaticTodayEvents(month, day),
  ])
  return [...manualEvents, ...automaticEvents].sort(sortTodayEvents)
}
