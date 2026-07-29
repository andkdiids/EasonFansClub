import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

type Context = { params: Promise<{ concertId: string }> }

export async function GET(_request: Request, { params }: Context) {
  const { concertId } = await params
  const concert = await prisma.musicConcert.findFirst({
    where: { id: concertId, status: 'PUBLISHED', MusicTour: { status: 'PUBLISHED' } },
    select: {
      id: true, title: true, concertDate: true, city: true, countryOrRegion: true, venue: true, sessionNumber: true, posterUrl: true, description: true,
      MusicTour: { select: { id: true, name: true } },
      MusicConcertSetlistItem: {
        orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
        select: {
          id: true, displayName: true, section: true, position: true, versionName: true, note: true,
          isEncore: true, isRequest: true, isDebut: true, isGuest: true, isMedley: true, isSpecial: true,
          MusicSong: { select: { id: true, title: true, releaseYear: true, MusicAlbum: { select: { name: true } } } },
        },
      },
      MusicConcertHighlight: { orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }], select: { id: true, title: true, content: true, type: true, sortOrder: true } },
    },
  })
  if (!concert) return NextResponse.json({ message: '演唱会场次不存在' }, { status: 404 })
  const { MusicTour, MusicConcertSetlistItem, MusicConcertHighlight, ...data } = concert
  return NextResponse.json({
    concert: {
      ...data,
      tour: MusicTour,
      setlist: MusicConcertSetlistItem.map(({ MusicSong, ...item }) => ({ ...item, song: MusicSong ? { id: MusicSong.id, title: MusicSong.title, releaseYear: MusicSong.releaseYear, album: MusicSong.MusicAlbum.name } : null })),
      highlights: MusicConcertHighlight,
    },
  })
}
