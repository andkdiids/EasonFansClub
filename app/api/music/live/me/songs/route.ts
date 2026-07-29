import { NextResponse } from 'next/server'
import { buildPersonalSongAtlas, getPersonalLiveRows, parsePersonalPageSize, parsePositivePage, PERSONAL_LIVE_NO_STORE_HEADERS, withPersonalNoStore } from '@/lib/music-personal-live'
import { requireUser, sanitizeText } from '@/lib/security'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const guard = await requireUser()
  if (!guard.user) return withPersonalNoStore(guard.response)
  const params = new URL(request.url).searchParams
  const page = parsePositivePage(params.get('page'))
  const pageSize = parsePersonalPageSize(params.get('pageSize'), 50)
  const albumId = sanitizeText(params.get('albumId'), 100)
  const tourId = sanitizeText(params.get('tourId'), 100)
  const frequency = params.get('frequency')
  const sort = params.get('sort')
  let songs = buildPersonalSongAtlas(await getPersonalLiveRows(guard.user.id))
  if (albumId) songs = songs.filter((song) => song.album.id === albumId)
  if (tourId) songs = songs.filter((song) => song.concerts.some((concert) => concert.tourId === tourId))
  if (frequency === 'once') songs = songs.filter((song) => song.occurrenceCount === 1)
  if (frequency === 'multiple') songs = songs.filter((song) => song.occurrenceCount > 1)
  songs.sort((a, b) => {
    if (sort === 'recent') return b.latest!.date.getTime() - a.latest!.date.getTime()
    if (sort === 'first') return b.first.date.getTime() - a.first.date.getTime()
    if (sort === 'name') return a.title.localeCompare(b.title, 'zh-CN')
    return b.occurrenceCount - a.occurrenceCount || b.concertCount - a.concertCount || a.title.localeCompare(b.title, 'zh-CN')
  })
  const total = songs.length
  return NextResponse.json({
    page,
    pageSize,
    total,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
    songs: songs.slice((page - 1) * pageSize, page * pageSize),
  }, { headers: PERSONAL_LIVE_NO_STORE_HEADERS })
}
