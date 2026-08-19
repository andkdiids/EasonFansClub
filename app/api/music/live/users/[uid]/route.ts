import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import { getPublicUserDisplayName, loadFriendRemarkMap, resolveFriendDisplayName } from '@/lib/friend-remarks'
import { normalizedCityKey } from '@/lib/music-personal-live'
import { myLivePhotoOrderBy, myLivePhotoSelect, serializeMyLivePhotos } from '@/lib/my-live-photo-data'
import { publicImageUrl } from '@/lib/images'
import { prisma } from '@/lib/prisma'
import { parseUidParam } from '@/lib/uid'

export const dynamic = 'force-dynamic'

type Context = { params: Promise<{ uid: string }> }

export async function GET(_request: Request, { params }: Context) {
  const viewer = await getCurrentUser()
  const { uid } = await params
  const numericUid = parseUidParam(uid)
  if (numericUid === null || numericUid <= 0) return NextResponse.json({ message: '用户不存在' }, { status: 404 })
  const user = await prisma.user.findFirst({
    where: { uid: numericUid, status: 'ACTIVE', isDeleted: false, Profile: { isNot: null } },
    select: {
      id: true,
      uid: true,
      nickname: true,
      usernameModerationStatus: true,
      nicknameModerationStatus: true,
      nicknameViolationDisplay: true,
      Profile: { select: { displayName: true, displayNameModerationStatus: true, avatarUrl: true } },
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
          MyLivePhoto: { orderBy: myLivePhotoOrderBy, select: myLivePhotoSelect },
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
  const remarkMap = await loadFriendRemarkMap(viewer?.id, [user.id])
  const displayName = resolveFriendDisplayName({
    viewerId: viewer?.id,
    targetUserId: user.id,
    fallbackName: getPublicUserDisplayName(user),
    remarkMap,
  })
  const tours = new Set(user.UserMusicConcert.map((record) => record.MusicConcert.MusicTour.id))
  const cities = new Set(user.UserMusicConcert.map((record) => normalizedCityKey(record.MusicConcert.city)).filter(Boolean))
  return NextResponse.json({
    user: { uid: user.uid, displayName, avatarUrl: publicImageUrl(user.Profile.avatarUrl) },
    stats: { concertCount: user.UserMusicConcert.length, tourCount: tours.size, cityCount: cities.size },
    records: user.UserMusicConcert.map((record) => ({
      concertId: record.MusicConcert.id,
      concertDate: record.MusicConcert.concertDate,
      title: record.MusicConcert.title,
      city: record.MusicConcert.city,
      venue: record.MusicConcert.venue,
      sessionNumber: record.MusicConcert.sessionNumber,
      mood: record.mood,
      photos: serializeMyLivePhotos(record.MyLivePhoto),
      tour: record.MusicConcert.MusicTour,
    })),
  }, { headers: viewer ? { 'Cache-Control': 'private, no-store, max-age=0', Vary: 'Cookie' } : { 'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=120', Vary: 'Cookie' } })
}
