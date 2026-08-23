import { Prisma } from '@prisma/client'
import { getShanghaiDateKey } from '@/lib/checkin'
import { isSupabaseStorageUrl } from '@/lib/images'
import { publicImageVariantUrl } from '@/lib/image-variants'
import { getMusicPlaybackUrl } from '@/lib/music-playback'
import { getEasMusicSongLikeState } from '@/lib/easmusic-likes'
import { prisma } from '@/lib/prisma'

export const DAILY_MUSIC_ANONYMOUS_COOKIE = 'eason-daily-music-anonymous'
export const DAILY_MUSIC_RECOMMENDATION_SEED = 'easmusic-global'

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
  const songUrl = publicImageVariantUrl(songCoverUrl, 'thumb-sm')
  if (songUrl && !isSupabaseStorageUrl(songUrl)) return songUrl
  return publicImageVariantUrl(albumCoverUrl, 'thumb-sm')
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

export function globalDailyRecommendationIndex(recommendDate: string, count: number) {
  const currentIndex = dailyRecommendationIndex(DAILY_MUSIC_RECOMMENDATION_SEED, recommendDate, count)
  if (count <= 1) return currentIndex

  // Avoid selecting the same song on two adjacent business dates when the
  // candidate pool is unchanged, while keeping the choice deterministic.
  const previousIndex = dailyRecommendationIndex(DAILY_MUSIC_RECOMMENDATION_SEED, shiftDateKey(recommendDate, -1), count)
  return currentIndex === previousIndex ? (currentIndex + 1) % count : currentIndex
}

function shiftDateKey(value: string, days: number) {
  const [year, month, day] = value.split('-').map(Number)
  const date = new Date(Date.UTC(year, month - 1, day + days))
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`
}

async function serializeSong(song: DailySong, userId?: string) {
  const likeState = await getEasMusicSongLikeState(song.id, userId)
  return {
    id: song.id,
    title: song.title,
    artist: song.artist,
    releaseYear: song.releaseYear,
    lyrics: song.lyrics,
    coverUrl: resolveDailyCoverUrl(song.coverUrl, song.MusicAlbum.coverUrl),
    album: { id: song.MusicAlbum.id, name: song.MusicAlbum.name, coverUrl: publicImageVariantUrl(song.MusicAlbum.coverUrl, 'thumb-sm') },
    previewUrl: song.previewUrl ? `${getMusicPlaybackUrl(song.id)}?preview=1` : '',
    previewDuration: Math.min(60, Math.max(1, song.previewDuration || 60)),
    isFullPlayback: false,
    likedByMe: likeState.liked,
    likeCount: likeState.likeCount,
  }
}

export async function getFallbackDailyMusicRecommendation(userId?: string, _anonymousId?: string, now = new Date()) {
  const candidates = await prisma.musicSong.findMany({
    where: dailyMusicCandidateWhere,
    orderBy: { id: 'asc' },
    take: 500,
    select: songSelect,
  })
  if (!candidates.length) return null

  const recommendDate = getShanghaiDateKey(now)
  const selected = candidates[globalDailyRecommendationIndex(recommendDate, candidates.length)]
  return selected ? serializeSong(selected, userId) : null
}

export async function getDailyMusicRecommendation(userId?: string, anonymousId?: string, now = new Date()) {
  // The original UserDailyMusicRecommendation table stored a different row
  // per user/anonymous identity. That cannot satisfy the product rule that
  // every visitor sees one shared daily song, so the legacy rows are left
  // untouched and the live recommendation is now a date-only deterministic
  // selection from the published catalogue.
  return getFallbackDailyMusicRecommendation(userId, anonymousId, now)
}
