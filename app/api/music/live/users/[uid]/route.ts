import { NextResponse } from 'next/server'
import { normalizedCityKey } from '@/lib/music-personal-live'
import { prisma } from '@/lib/prisma'
import { parseUidParam } from '@/lib/uid'

export const dynamic = 'force-dynamic'

type Context = { params: Promise<{ uid: string }> }

export async function GET(_request: Request, { params }: Context) {
  const { uid } = await params
  const numericUid = parseUidParam(uid)
  if (numericUid === null || numericUid <= 0) return NextResponse.json({ message: '用户不存在' }, { status: 404 })
  const user = await prisma.user.findFirst({
    where: { uid: numericUid, status: 'ACTIVE', isDeleted: false, Profile: { isNot: null } },
    select: {
      uid: true,
      nickname: true,
      Profile: { select: { displayName: true, avatarUrl: true } },
      UserMusicConcert: {
        where: {
          isPublic: true,
          MusicConcert: { status: 'PUBLISHED', MusicTour: { status: 'PUBLISHED' } },
        },
        orderBy: [{ MusicConcert: { concertDate: 'desc' } }, { createdAt: 'desc' }],
        take: 100,
        select: {
          mood: true,
          isPublic: true,
          MusicConcert: {
            select: {
              id: true, title: true, concertDate: true, city: true, venue: true, sessionNumber: true,
              MusicTour: { select: { id: true, name: true } },
            },
          },
        },
      },
    },
  })
  if (!user || !user.Profile) return NextResponse.json({ message: '用户不存在' }, { status: 404 })
  const tours = new Set(user.UserMusicConcert.map((record) => record.MusicConcert.MusicTour.id))
  const cities = new Set(user.UserMusicConcert.map((record) => normalizedCityKey(record.MusicConcert.city)).filter(Boolean))
  return NextResponse.json({
    user: { uid: user.uid, displayName: user.Profile.displayName || user.nickname, avatarUrl: user.Profile.avatarUrl },
    stats: { concertCount: user.UserMusicConcert.length, tourCount: tours.size, cityCount: cities.size },
    records: user.UserMusicConcert.map((record) => ({
      concertId: record.MusicConcert.id,
      concertDate: record.MusicConcert.concertDate,
      title: record.MusicConcert.title,
      city: record.MusicConcert.city,
      venue: record.MusicConcert.venue,
      sessionNumber: record.MusicConcert.sessionNumber,
      mood: record.mood,
      tour: record.MusicConcert.MusicTour,
    })),
  }, { headers: { 'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=120' } })
}
