import { consumeRateLimit, requireUser, sanitizeText } from '@/lib/security'
import { guessSongError, guessSongOk, handleGuessSongError } from '@/lib/guess-song-api'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(request: Request) {
  const guard = await requireUser()
  if (!guard.user) return guessSongError('请先登录', guard.response.status)
  const limit = await consumeRateLimit(guard.user.id, 'guess-song-search', 60, 60)
  if (limit.limited) return guessSongError('搜索请求过于频繁，请稍后再试', 429)

  const query = sanitizeText(new URL(request.url).searchParams.get('q'), 80)
  if (!query) return guessSongOk({ candidates: [] })

  try {
    const songs = await prisma.musicSong.findMany({
      where: {
        title: { contains: query },
        MusicAlbum: { status: 'PUBLISHED' },
      },
      select: {
        title: true,
        artist: true,
        MusicAlbum: { select: { name: true } },
      },
      orderBy: [{ releaseYear: 'desc' }, { trackNumber: 'asc' }],
      take: 12,
    })
    return guessSongOk({
      candidates: songs.map((song) => ({
        title: song.title,
        artist: song.artist,
        albumTitle: song.MusicAlbum.name,
      })),
    })
  } catch (error) {
    return handleGuessSongError(error, 'search')
  }
}
