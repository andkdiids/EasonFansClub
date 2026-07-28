import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireAdmin, sanitizeText } from '@/lib/security'

export async function GET(request: Request) {
  const guard = await requireAdmin('music_manage')
  if (!guard.user) return guard.response
  const query = sanitizeText(new URL(request.url).searchParams.get('q'), 100)
  if (!query) return NextResponse.json({ songs: [] })
  const songs = await prisma.musicSong.findMany({
    where: { title: { contains: query } },
    orderBy: [{ title: 'asc' }, { releaseYear: 'asc' }, { trackNumber: 'asc' }],
    take: 20,
    select: { id: true, title: true, releaseYear: true, MusicAlbum: { select: { name: true } } },
  })
  return NextResponse.json({ songs: songs.map(({ MusicAlbum, ...song }) => ({ ...song, album: MusicAlbum.name })) })
}
