import { NextResponse } from 'next/server'
import { getEasMusicAlbumLikeState, getEasMusicSongLikeStates } from '@/lib/easmusic-likes'
import { toPublicMediaUrl } from '@/lib/media-url'
import { prisma } from '@/lib/prisma'
import { resolveRequestAuth } from '@/lib/security'

export const dynamic = 'force-dynamic'

type Context = { params: Promise<{ albumId: string }> }

export async function GET(request: Request, { params }: Context) {
  const { albumId } = await params
  const album = await prisma.musicAlbum.findFirst({
    where: { id: albumId, status: 'PUBLISHED' },
    select: {
      id: true, name: true, artist: true, releaseYear: true, coverUrl: true, description: true,
      language: true, era: true, albumType: true, releaseDate: true, company: true, story: true,
      isFeatured: true,
      MusicSong: {
        orderBy: [{ trackNumber: 'asc' }, { createdAt: 'asc' }],
        select: {
          id: true, title: true, artist: true, trackNumber: true, releaseYear: true, duration: true,
          coverUrl: true, composer: true, lyricist: true, arranger: true, producer: true,
          story: true, lyrics: true, language: true, tags: true, era: true, trackType: true,
          concertVersion: true, mood: true, description: true, previewUrl: true, previewDuration: true,
        },
      },
    },
  })
  if (!album) return NextResponse.json({ message: '专辑不存在或暂未公开' }, { status: 404 })
  const auth = await resolveRequestAuth(request)
  if (auth.response) return auth.response
  const [albumLike, songLikes] = await Promise.all([
    getEasMusicAlbumLikeState(album.id, auth.user?.id),
    getEasMusicSongLikeStates(album.MusicSong.map((song) => song.id), auth.user?.id),
  ])
  return NextResponse.json({ album: {
    ...album,
    coverUrl: toPublicMediaUrl(album.coverUrl),
    liked: albumLike.liked,
    likeCount: albumLike.likeCount,
    songs: album.MusicSong.map((song) => {
      const { previewUrl, ...metadata } = song
      return {
        ...metadata,
        coverUrl: toPublicMediaUrl(song.coverUrl || album.coverUrl),
        hasPreview: Boolean(toPublicMediaUrl(previewUrl)),
        ...(songLikes.get(song.id) || { liked: false, likeCount: 0 }),
      }
    }),
  } }, { headers: { 'Cache-Control': auth.user ? 'private, no-store' : 'public, max-age=30, s-maxage=60', Vary: 'Cookie, Authorization' } })
}
