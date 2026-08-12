import { Prisma } from '@prisma/client'
import { getShanghaiDateKey } from '@/lib/checkin'
import { isSupabaseStorageUrl } from '@/lib/images'
import { getMusicPlaybackUrl } from '@/lib/music-playback'
import { toPublicMediaUrl } from '@/lib/media-url'
import { prisma } from '@/lib/prisma'

export const DAILY_MUSIC_ANONYMOUS_COOKIE = 'eason-daily-music-anonymous'

const songSelect = {
  id: true,
  title: true,
  artist: true,
  releaseYear: true,
  lyrics: true,
  previewUrl: true,
  previewDuration: true,
  sourceType: true,
  coverUrl: true,
  MusicAlbum: { select: { id: true, name: true, coverUrl: true } },
} as const

type DailySong = Prisma.MusicSongGetPayload<{ select: typeof songSelect }>

function resolveDailyCoverUrl(songCoverUrl: string | null | undefined, albumCoverUrl: string | null | undefined) {
  const songUrl = toPublicMediaUrl(songCoverUrl)
  if (songUrl && !isSupabaseStorageUrl(songUrl)) return songUrl
  return toPublicMediaUrl(albumCoverUrl)
}

const dailyMusicCandidateWhere = {
  MusicAlbum: { status: 'PUBLISHED' as const },
  previewUrl: { not: null },
}

export function dailyRecommendationIndex(identity: string, recommendDate: string, count: number) {
  if (count <= 0) return 0
  let hash = 2166136261
  for (const character of `${identity}:${recommendDate}`) {
    hash ^= character.charCodeAt(0)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0) % count
}

function recommendationWhere(recommendDate: string, userId?: string, anonymousId?: string) {
  if (userId) return { userId_recommendDate: { userId, recommendDate } }
  if (anonymousId) return { anonymousId_recommendDate: { anonymousId, recommendDate } }
  throw new Error('DAILY_MUSIC_IDENTITY_REQUIRED')
}

function serializeSong(song: DailySong) {
  return {
    id: song.id,
    title: song.title,
    artist: song.artist,
    releaseYear: song.releaseYear,
    lyrics: song.lyrics,
    coverUrl: resolveDailyCoverUrl(song.coverUrl, song.MusicAlbum.coverUrl),
    album: { id: song.MusicAlbum.id, name: song.MusicAlbum.name, coverUrl: toPublicMediaUrl(song.MusicAlbum.coverUrl) },
    previewUrl: song.previewUrl ? `${getMusicPlaybackUrl(song.id)}?preview=1` : '',
    previewDuration: Math.min(60, Math.max(1, song.previewDuration || 60)),
    isFullPlayback: false,
  }
}

export async function getFallbackDailyMusicRecommendation(userId?: string, anonymousId?: string, now = new Date()) {
  const candidates = await prisma.musicSong.findMany({
    where: dailyMusicCandidateWhere,
    orderBy: { id: 'asc' },
    take: 500,
    select: songSelect,
  })
  if (!candidates.length) return null

  const identity = userId || anonymousId || 'anonymous'
  const recommendDate = getShanghaiDateKey(now)
  const selected = candidates[dailyRecommendationIndex(identity, recommendDate, candidates.length)]
  return selected ? serializeSong(selected) : null
}

export async function getDailyMusicRecommendation(userId?: string, anonymousId?: string, now = new Date()) {
  const recommendDate = getShanghaiDateKey(now)
  const where = recommendationWhere(recommendDate, userId, anonymousId)
  const existing = await prisma.userDailyMusicRecommendation.findUnique({
    where,
    include: { MusicSong: { select: songSelect } },
  })
  if (existing?.MusicSong?.MusicAlbum) return serializeSong(existing.MusicSong)

  const candidates = await prisma.musicSong.findMany({
    where: dailyMusicCandidateWhere,
    orderBy: { id: 'asc' },
    select: { id: true },
  })
  if (!candidates.length) return null

  const occupied = await prisma.userDailyMusicRecommendation.findMany({
    where: { recommendDate },
    select: { songId: true },
  })
  const occupiedIds = new Set(occupied.map((item) => item.songId))
  const available = candidates.filter((candidate) => !occupiedIds.has(candidate.id))
  const pool = available.length ? available : candidates
  const identity = userId || anonymousId || 'anonymous'
  const selectedId = pool[dailyRecommendationIndex(identity, recommendDate, pool.length)].id

  try {
    const recommendation = await prisma.userDailyMusicRecommendation.create({
      data: { recommendDate, userId: userId || null, anonymousId: userId ? null : anonymousId || null, songId: selectedId },
      include: { MusicSong: { select: songSelect } },
    })
    return serializeSong(recommendation.MusicSong)
  } catch (error) {
    if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') throw error
    const concurrent = await prisma.userDailyMusicRecommendation.findUnique({
      where,
      include: { MusicSong: { select: songSelect } },
    })
    return concurrent?.MusicSong ? serializeSong(concurrent.MusicSong) : null
  }
}
