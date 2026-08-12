import { NextResponse } from 'next/server'
import { toPublicMediaUrl } from '@/lib/media-url'
import { prisma } from '@/lib/prisma'
import { requireAdmin } from '@/lib/security'

export const dynamic = 'force-dynamic'

export async function GET() {
  const guard = await requireAdmin('music_manage')
  if (!guard.user) return guard.response

  const albums = await prisma.musicAlbum.findMany({
    orderBy: [{ releaseYear: 'desc' }, { createdAt: 'desc' }],
    include: { MusicSong: { orderBy: [{ trackNumber: 'asc' }, { createdAt: 'asc' }] } },
  })

  return NextResponse.json({
    albums: albums.map(({ MusicSong, ...album }) => ({
      ...album,
      coverUrl: toPublicMediaUrl(album.coverUrl),
      songs: MusicSong.map((song) => ({
        ...song,
        coverUrl: toPublicMediaUrl(song.coverUrl),
        previewUrl: toPublicMediaUrl(song.previewUrl),
      })),
    })),
  })
}
