import { NextResponse } from 'next/server'
import { parseBulkSetlist } from '@/lib/music-live'
import { prisma } from '@/lib/prisma'
import { requireAdmin, sanitizeText } from '@/lib/security'

export async function POST(request: Request) {
  const guard = await requireAdmin('music_manage')
  if (!guard.user) return guard.response
  const body = await request.json().catch(() => null)
  const names = parseBulkSetlist(sanitizeText(body?.text, 20_000)).slice(0, 200)
  if (!names.length) return NextResponse.json({ items: [] })
  const uniqueNames = [...new Set(names)]
  const songs = await prisma.musicSong.findMany({
    where: { title: { in: uniqueNames } },
    select: { id: true, title: true, releaseYear: true, MusicAlbum: { select: { name: true } } },
  })
  const items = names.map((name) => {
    const matches = songs.filter((song) => song.title === name).map(({ MusicAlbum, ...song }) => ({ ...song, album: MusicAlbum.name }))
    return { displayName: name, songId: matches.length === 1 ? matches[0].id : null, candidates: matches }
  })
  return NextResponse.json({ items })
}
