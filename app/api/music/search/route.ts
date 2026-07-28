import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { sanitizeText } from '@/lib/security'

export async function GET(request: Request) {
  const query = sanitizeText(new URL(request.url).searchParams.get('q'), 100)
  if (!query) return NextResponse.json({ albums: [], songs: [] })
  const year = Number(query)
  const yearFilter = Number.isInteger(year) && year >= 1900 && year <= 2100 ? { releaseYear: year } : null
  const [albums, songs] = await Promise.all([
    prisma.musicAlbum.findMany({ where: { status: 'PUBLISHED', OR: [{ name: { contains: query } }, ...(yearFilter ? [yearFilter] : [])] }, orderBy: [{ displayOrder: 'asc' }, { releaseYear: 'desc' }], take: 12, select: { id: true, name: true, releaseYear: true, coverUrl: true } }),
    prisma.musicSong.findMany({ where: { MusicAlbum: { status: 'PUBLISHED' }, OR: [{ title: { contains: query } }, { lyricist: { contains: query } }, { composer: { contains: query } }, { MusicAlbum: { name: { contains: query } } }, ...(yearFilter ? [yearFilter] : [])] }, orderBy: [{ releaseYear: 'desc' }, { trackNumber: 'asc' }], take: 30, select: { id: true, title: true, releaseYear: true, lyricist: true, composer: true, MusicAlbum: { select: { name: true } } } }),
  ])
  return NextResponse.json({
    albums,
    songs: songs.map(({ MusicAlbum, ...song }) => ({ ...song, album: MusicAlbum })),
  })
}
