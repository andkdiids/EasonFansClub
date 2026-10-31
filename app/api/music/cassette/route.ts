import { NextResponse } from 'next/server'
import { toPublicMediaUrl } from '@/lib/media-url'
import { prisma } from '@/lib/prisma'
import { resolveRequestAuth } from '@/lib/security'

export const dynamic = 'force-dynamic'

/** Safe public sampler catalogue: preview capability only, never storage paths or audio URLs. */
export async function GET(request: Request) {
  const auth = await resolveRequestAuth(request)
  if (auth.response) return auth.response
  const songs = await prisma.musicSong.findMany({
    where: { previewUrl: { not: null }, MusicAlbum: { status: 'PUBLISHED' } },
    orderBy: [{ releaseYear: 'desc' }, { trackNumber: 'asc' }, { createdAt: 'asc' }],
    take: 200,
    select: {
      id: true, title: true, artist: true, releaseYear: true, trackNumber: true,
      duration: true, previewDuration: true, coverUrl: true,
      MusicAlbum: { select: { id: true, name: true, artist: true, releaseYear: true, coverUrl: true } },
    },
  })
  return NextResponse.json({ songs: songs.map((song) => ({
    id: song.id,
    title: song.title,
    artist: song.artist,
    releaseYear: song.releaseYear,
    trackNumber: song.trackNumber,
    duration: song.duration,
    previewDuration: Math.max(1, Math.min(60, song.previewDuration || 60)),
    coverUrl: toPublicMediaUrl(song.coverUrl || song.MusicAlbum.coverUrl),
    album: { ...song.MusicAlbum, coverUrl: toPublicMediaUrl(song.MusicAlbum.coverUrl) },
    hasPreview: true,
  })) }, { headers: { 'Cache-Control': auth.user ? 'private, no-store' : 'public, max-age=60, s-maxage=120', Vary: 'Cookie, Authorization' } })
}
