import { NextResponse } from 'next/server'
import { getEasMusicSongLikeState } from '@/lib/easmusic-likes'
import { toPublicMediaUrl } from '@/lib/media-url'
import { prisma } from '@/lib/prisma'
import { resolveRequestAuth } from '@/lib/security'

export const dynamic = 'force-dynamic'

type Context = { params: Promise<{ songId: string }> }

export async function GET(request: Request, { params }: Context) {
  const { songId } = await params
  const song = await prisma.musicSong.findFirst({
    where: { id: songId, MusicAlbum: { status: 'PUBLISHED' } },
    select: {
      id: true, title: true, artist: true, trackNumber: true, releaseYear: true, duration: true,
      coverUrl: true, composer: true, lyricist: true, arranger: true, producer: true, story: true,
      lyrics: true, language: true, tags: true, era: true, trackType: true, concertVersion: true,
      mood: true, description: true, previewUrl: true, previewDuration: true,
      MusicAlbum: { select: { id: true, name: true, artist: true, releaseYear: true, coverUrl: true, language: true } },
    },
  })
  if (!song) return NextResponse.json({ message: '歌曲不存在或暂未公开' }, { status: 404 })
  const auth = await resolveRequestAuth(request)
  if (auth.response) return auth.response
  const { previewUrl, ...metadata } = song
  const like = await getEasMusicSongLikeState(song.id, auth.user?.id)
  return NextResponse.json({ song: {
    ...metadata,
    coverUrl: toPublicMediaUrl(song.coverUrl || song.MusicAlbum.coverUrl),
    album: { ...song.MusicAlbum, coverUrl: toPublicMediaUrl(song.MusicAlbum.coverUrl) },
    hasPreview: Boolean(toPublicMediaUrl(previewUrl)),
    liked: like.liked,
    likeCount: like.likeCount,
  } }, { headers: { 'Cache-Control': auth.user ? 'private, no-store' : 'public, max-age=30, s-maxage=60', Vary: 'Cookie, Authorization' } })
}
