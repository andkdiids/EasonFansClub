import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { buildMusicLyricSnippet } from '@/lib/music-search'
import { sanitizeText } from '@/lib/security'

export async function GET(request: Request) {
  const query = sanitizeText(new URL(request.url).searchParams.get('q'), 100)
  if (!query) return NextResponse.json({ albums: [], songs: [] })
  const year = Number(query)
  const yearFilter = Number.isInteger(year) && year >= 1900 && year <= 2100 ? { releaseYear: year } : null
  const [albums, songs] = await Promise.all([
    prisma.musicAlbum.findMany({
      where: { status: 'PUBLISHED', OR: [{ name: { contains: query } }, { artist: { contains: query } }, { description: { contains: query } }, { story: { contains: query } }, ...(yearFilter ? [yearFilter] : [])] },
      orderBy: [{ displayOrder: 'asc' }, { releaseYear: 'desc' }, { createdAt: 'asc' }],
      take: 12,
      select: { id: true, name: true, artist: true, releaseYear: true, coverUrl: true },
    }),
    prisma.musicSong.findMany({
      where: {
        MusicAlbum: { status: 'PUBLISHED' },
        OR: [
          { title: { contains: query } },
          { lyrics: { contains: query } },
          { lyricist: { contains: query } },
          { composer: { contains: query } },
          { arranger: { contains: query } },
          { story: { contains: query } },
          { description: { contains: query } },
          { artist: { contains: query } },
          { MusicAlbum: { name: { contains: query } } },
          { MusicAlbum: { artist: { contains: query } } },
          ...(yearFilter ? [yearFilter] : []),
        ],
      },
      orderBy: [{ releaseYear: 'desc' }, { trackNumber: 'asc' }, { createdAt: 'asc' }],
      take: 30,
      select: { id: true, title: true, artist: true, releaseYear: true, lyricist: true, composer: true, arranger: true, lyrics: true, MusicAlbum: { select: { name: true, artist: true } } },
    }),
  ])
  return NextResponse.json({
    query,
    albums: albums.map((album) => ({ ...album, type: 'album' as const })),
    songs: songs.map(({ MusicAlbum, lyrics, ...song }) => ({
      ...song,
      type: 'song' as const,
      album: MusicAlbum,
      lyricSnippet: buildMusicLyricSnippet(lyrics, query),
    })),
  })
}
