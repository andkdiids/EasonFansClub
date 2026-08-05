import type { Prisma } from '@prisma/client'
import { resolveConcertPoster } from '@/lib/music-concert-poster'
import { prisma } from '@/lib/prisma'

export const PERSONAL_LIVE_NO_STORE_HEADERS = {
  'Cache-Control': 'private, no-store, max-age=0',
  Vary: 'Cookie',
}

export function withPersonalNoStore<T extends Response>(response: T) {
  for (const [name, value] of Object.entries(PERSONAL_LIVE_NO_STORE_HEADERS)) {
    response.headers.set(name, value)
  }
  return response
}

export const ATTENDANCE_LIMITS = {
  seatInfo: 100,
  mood: 100,
  note: 5000,
} as const

type AttendanceInput = {
  seatInfo: string | null
  mood: string | null
  note: string | null
  isPublic: boolean
}

function parseOptionalText(value: unknown, maxLength: number, label: string) {
  if (value === undefined || value === null || value === '') return { value: null }
  if (typeof value !== 'string') return { message: `${label}格式不正确` }
  const trimmed = value.trim()
  if (!trimmed) return { value: null }
  if (trimmed.length > maxLength) return { message: `${label}最多${maxLength}个字符` }
  return { value: trimmed }
}

export function parseAttendanceInput(value: unknown): { data?: AttendanceInput; message?: string } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { message: '观演记录格式不正确' }
  const body = value as Record<string, unknown>
  if ('userId' in body) return { message: '不能指定其他用户' }
  const seatInfo = parseOptionalText(body.seatInfo, ATTENDANCE_LIMITS.seatInfo, '座位信息')
  if (seatInfo.message) return { message: seatInfo.message }
  const mood = parseOptionalText(body.mood, ATTENDANCE_LIMITS.mood, '当晚心情')
  if (mood.message) return { message: mood.message }
  const note = parseOptionalText(body.note, ATTENDANCE_LIMITS.note, '个人笔记')
  if (note.message) return { message: note.message }
  if (body.isPublic !== undefined && typeof body.isPublic !== 'boolean') return { message: '公开设置格式不正确' }
  return {
    data: {
      seatInfo: seatInfo.value ?? null,
      mood: mood.value ?? null,
      note: note.value ?? null,
      isPublic: body.isPublic === true,
    },
  }
}

export function parseAttendanceVersion(value: unknown) {
  if (value === undefined || value === null || value === '') return null
  if (typeof value !== 'string') return undefined
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? undefined : parsed
}

export function parsePositivePage(value: string | null, fallback = 1) {
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback
}

export function parsePersonalPageSize(value: string | null, fallback = 20) {
  if (!value) return fallback
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) ? Math.min(50, Math.max(1, parsed)) : fallback
}

export function normalizedCityKey(value: string | null | undefined) {
  return value?.trim().toLocaleLowerCase('zh-CN') || null
}

export type PersonalLiveSummary = {
  attendedShowCount: number
  attendedTourCount: number
  attendedCityCount: number
  latestAttendedShow: {
    showId: string
    tourId: string
    tourName: string
    city: string
    date: Date
  } | null
}

type PersonalLiveSummaryRow = {
  MusicConcert: {
    id: string
    tourId: string
    concertDate: Date
    city: string
    MusicTour: { id: string; name: string }
  }
}

export function summarizePersonalLiveSummaryRows(rows: PersonalLiveSummaryRow[]): PersonalLiveSummary {
  const uniqueShows = new Map<string, PersonalLiveSummaryRow['MusicConcert']>()
  for (const row of rows) {
    if (!uniqueShows.has(row.MusicConcert.id)) uniqueShows.set(row.MusicConcert.id, row.MusicConcert)
  }

  const shows = [...uniqueShows.values()]
  const tours = new Set(shows.map((show) => show.tourId))
  const cities = new Set(shows.map((show) => normalizedCityKey(show.city)).filter((city): city is string => Boolean(city)))
  const latest = [...shows].sort((left, right) => right.concertDate.getTime() - left.concertDate.getTime() || right.id.localeCompare(left.id))[0]

  return {
    attendedShowCount: shows.length,
    attendedTourCount: tours.size,
    attendedCityCount: cities.size,
    latestAttendedShow: latest ? {
      showId: latest.id,
      tourId: latest.tourId,
      tourName: latest.MusicTour.name,
      city: latest.city,
      date: latest.concertDate,
    } : null,
  }
}

export type PersonalSetlistItem = {
  songId: string | null
  displayName: string | null
  section: string
  MusicSong?: {
    id: string
    title: string
    MusicAlbum: { id: string; name: string; coverUrl: string | null }
  } | null
}

export type PersonalLiveRow = {
  id: string
  seatInfo: string | null
  mood: string | null
  note: string | null
  isPublic: boolean
  createdAt: Date
  updatedAt: Date
  MusicConcert: {
    id: string
    title: string | null
    concertDate: Date
    city: string
    venue: string | null
    sessionNumber: string | null
    posterUrl: string | null
    status: 'DRAFT' | 'PUBLISHED'
    stageType: 'NORMAL' | 'ENCORE' | 'FINAL'
    tourId: string
    MusicTour: {
      id: string
      name: string
      posterUrl: string | null
      status: 'DRAFT' | 'PUBLISHED'
    }
    MusicConcertSetlistItem: PersonalSetlistItem[]
  }
}

type PersonalPosterFallbacks = {
  city: ReadonlyMap<string, string>
  tour: ReadonlyMap<string, string>
}

const EMPTY_PERSONAL_POSTER_FALLBACKS: PersonalPosterFallbacks = {
  city: new Map(),
  tour: new Map(),
}

function personalPosterKey(tourId: string, city: string) {
  return `${tourId}::${normalizedCityKey(city) || ''}`
}

function isPublishedRow(row: PersonalLiveRow) {
  return row.MusicConcert.status === 'PUBLISHED' && row.MusicConcert.MusicTour.status === 'PUBLISHED'
}

function isCountableSetlistItem(item: PersonalSetlistItem) {
  const hasContent = Boolean(item.songId || item.displayName?.trim())
  if (!hasContent) return false
  return item.section !== 'TALK' || hasContent
}

export function summarizePersonalLiveRows(rows: PersonalLiveRow[]) {
  const uniqueRows = [...new Map(rows.map((row) => [row.MusicConcert.id, row])).values()]
  const summary = summarizePersonalLiveSummaryRows(uniqueRows.map((row) => ({
    MusicConcert: {
      id: row.MusicConcert.id,
      tourId: row.MusicConcert.tourId,
      concertDate: row.MusicConcert.concertDate,
      city: row.MusicConcert.city,
      MusicTour: {
        id: row.MusicConcert.MusicTour.id,
        name: row.MusicConcert.MusicTour.name,
      },
    },
  })))
  const availableRows = uniqueRows.filter(isPublishedRow)
  const tourIds = new Set<string>()
  const cities = new Map<string, { name: string; count: number }>()
  const songIds = new Set<string>()
  let totalLiveSongCount = 0

  for (const row of uniqueRows) {
    tourIds.add(row.MusicConcert.tourId)
    const cityName = row.MusicConcert.city.trim()
    const cityKey = normalizedCityKey(cityName)
    if (cityKey) {
      const current = cities.get(cityKey)
      cities.set(cityKey, { name: current?.name || cityName, count: (current?.count || 0) + 1 })
    } else {
      console.warn('[music.live.me] ignored blank city', { concertId: row.MusicConcert.id })
    }
    if (!isPublishedRow(row)) continue
    for (const item of row.MusicConcert.MusicConcertSetlistItem) {
      if (!isCountableSetlistItem(item)) continue
      totalLiveSongCount += 1
      if (item.songId) songIds.add(item.songId)
    }
  }

  return {
    concertCount: uniqueRows.length,
    tourCount: tourIds.size,
    cityCount: cities.size,
    latestAttendedShow: summary.latestAttendedShow,
    unlockedSongCount: songIds.size,
    totalLiveSongCount,
    unavailableCount: uniqueRows.length - availableRows.length,
    cities: [...cities.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'zh-CN')),
  }
}

export function buildPersonalSongAtlas(rows: PersonalLiveRow[]) {
  const songs = new Map<string, {
    songId: string
    title: string
    album: { id: string; name: string; coverUrl: string | null }
    occurrenceCount: number
    concerts: Map<string, { concertId: string; date: Date; city: string; venue: string | null; tourId: string; tourName: string }>
  }>()

  for (const row of rows.filter(isPublishedRow)) {
    const concert = row.MusicConcert
    for (const item of concert.MusicConcertSetlistItem) {
      if (!item.songId || !item.MusicSong) continue
      const current = songs.get(item.songId) || {
        songId: item.songId,
        title: item.MusicSong.title,
        album: item.MusicSong.MusicAlbum,
        occurrenceCount: 0,
        concerts: new Map(),
      }
      current.occurrenceCount += 1
      current.concerts.set(concert.id, {
        concertId: concert.id,
        date: concert.concertDate,
        city: concert.city.trim(),
        venue: concert.venue,
        tourId: concert.MusicTour.id,
        tourName: concert.MusicTour.name,
        stageType: concert.stageType,
      })
      songs.set(item.songId, current)
    }
  }

  return [...songs.values()].map((song) => {
    const concerts = [...song.concerts.values()].sort((a, b) => a.date.getTime() - b.date.getTime())
    return {
      songId: song.songId,
      title: song.title,
      album: song.album,
      occurrenceCount: song.occurrenceCount,
      concertCount: concerts.length,
      first: concerts[0],
      latest: concerts.at(-1),
      concerts,
    }
  })
}

export function buildTourStats(rows: PersonalLiveRow[], fallbacks: PersonalPosterFallbacks = EMPTY_PERSONAL_POSTER_FALLBACKS) {
  const tours = new Map<string, {
    id: string
    name: string
    posterUrl: string | null
    dates: Date[]
    songs: Set<string>
  }>()
  for (const row of rows.filter(isPublishedRow)) {
    const concert = row.MusicConcert
    const current = tours.get(concert.tourId) || {
      id: concert.MusicTour.id,
      name: concert.MusicTour.name,
      posterUrl: concert.MusicTour.posterUrl,
      dates: [],
      songs: new Set<string>(),
    }
    current.dates.push(concert.concertDate)
    concert.MusicConcertSetlistItem.forEach((item) => {
      if (item.songId) current.songs.add(item.songId)
    })
    tours.set(concert.tourId, current)
  }
  return [...tours.values()].map((tour) => {
    const dates = tour.dates.sort((a, b) => a.getTime() - b.getTime())
    return {
      id: tour.id,
      name: tour.name,
      posterUrl: tour.posterUrl,
      resolvedPosterUrl: resolveConcertPoster({ posterUrl: tour.posterUrl, cityPosterUrl: fallbacks.tour.get(tour.id) }).resolvedPosterUrl,
      concertCount: dates.length,
      firstDate: dates[0],
      latestDate: dates.at(-1)!,
      unlockedSongCount: tour.songs.size,
    }
  }).sort((a, b) => b.latestDate.getTime() - a.latestDate.getTime())
}

const personalConcertSelect = {
  id: true,
  seatInfo: true,
  mood: true,
  note: true,
  isPublic: true,
  createdAt: true,
  updatedAt: true,
  MusicConcert: {
      select: {
        id: true,
        title: true,
        concertDate: true,
        city: true,
        venue: true,
        sessionNumber: true,
        posterUrl: true,
        status: true,
        stageType: true,
        tourId: true,
      MusicTour: { select: { id: true, name: true, posterUrl: true, status: true } },
      MusicConcertSetlistItem: {
        orderBy: [{ position: 'asc' as const }, { createdAt: 'asc' as const }, { id: 'asc' as const }],
        select: {
          songId: true,
          displayName: true,
          section: true,
          MusicSong: {
            select: {
              id: true,
              title: true,
              MusicAlbum: { select: { id: true, name: true, coverUrl: true } },
            },
          },
        },
      },
    },
  },
} satisfies Prisma.UserMusicConcertSelect

export async function getPersonalLiveRows(userId: string) {
  const rows = await prisma.userMusicConcert.findMany({
    where: { userId },
    orderBy: [
      { MusicConcert: { concertDate: 'desc' } },
      { createdAt: 'desc' },
    ],
    select: personalConcertSelect,
  })
  return rows as PersonalLiveRow[]
}

async function getPersonalPosterFallbacks(rows: PersonalLiveRow[]): Promise<PersonalPosterFallbacks> {
  const tourIds = [...new Set(rows.map((row) => row.MusicConcert.tourId))]
  if (!tourIds.length) return EMPTY_PERSONAL_POSTER_FALLBACKS
  const candidates = await prisma.musicConcert.findMany({
    where: { tourId: { in: tourIds }, status: 'PUBLISHED', posterUrl: { not: null } },
    orderBy: [{ concertDate: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
    select: { tourId: true, city: true, posterUrl: true },
  })
  const city = new Map<string, string>()
  const tour = new Map<string, string>()
  for (const candidate of candidates) {
    if (!candidate.posterUrl) continue
    const cityKey = personalPosterKey(candidate.tourId, candidate.city)
    if (!city.has(cityKey)) city.set(cityKey, candidate.posterUrl)
    if (!tour.has(candidate.tourId)) tour.set(candidate.tourId, candidate.posterUrl)
  }
  return { city, tour }
}

export function serializePersonalRecord(row: PersonalLiveRow, fallbacks: PersonalPosterFallbacks = EMPTY_PERSONAL_POSTER_FALLBACKS) {
  const available = isPublishedRow(row)
  if (!available) {
    return {
      id: row.id,
      concertId: row.MusicConcert.id,
      unavailable: true,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    }
  }
  const concert = row.MusicConcert
  const posterResolution = resolveConcertPoster({
    posterUrl: concert.posterUrl,
    cityPosterUrl: fallbacks.city.get(personalPosterKey(concert.tourId, concert.city)),
    tourPosterUrl: concert.MusicTour.posterUrl,
  })
  return {
    id: row.id,
    concertId: concert.id,
    unavailable: false,
    seatInfo: row.seatInfo,
    mood: row.mood,
    note: row.note,
    isPublic: row.isPublic,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    concert: {
      id: concert.id,
      title: concert.title,
      concertDate: concert.concertDate.toISOString(),
      city: concert.city,
      venue: concert.venue,
      sessionNumber: concert.sessionNumber,
      stageType: concert.stageType,
      posterUrl: concert.posterUrl,
      resolvedPosterUrl: posterResolution.resolvedPosterUrl,
      posterSource: posterResolution.posterSource,
      setlistCount: concert.MusicConcertSetlistItem.filter(isCountableSetlistItem).length,
      tour: {
        id: concert.MusicTour.id,
        name: concert.MusicTour.name,
        posterUrl: concert.MusicTour.posterUrl,
        resolvedPosterUrl: resolveConcertPoster({ posterUrl: concert.MusicTour.posterUrl, cityPosterUrl: fallbacks.tour.get(concert.MusicTour.id) }).resolvedPosterUrl,
      },
    },
  }
}

export async function getPersonalLiveOverview(userId: string) {
  const rows = await getPersonalLiveRows(userId)
  const posterFallbacks = await getPersonalPosterFallbacks(rows)
  const stats = summarizePersonalLiveRows(rows)
  const songs = buildPersonalSongAtlas(rows)
  const tours = buildTourStats(rows, posterFallbacks)
  return {
    stats,
    records: rows.map((row) => serializePersonalRecord(row, posterFallbacks)),
    songs,
    tours,
  }
}
