import { NextResponse } from 'next/server'
import { readAlbumReviewImages } from '@/lib/album-reviews'
import { getPublicUserDisplayName } from '@/lib/friend-remarks'
import { toPublicMediaUrl } from '@/lib/media-url'
import { prisma } from '@/lib/prisma'
import { resolveRequestAuth } from '@/lib/security'

export const dynamic = 'force-dynamic'

type Context = { params: Promise<{ reviewId: string }> }

export async function GET(request: Request, { params }: Context) {
  const { reviewId } = await params
  const review = await prisma.albumReview.findFirst({
    where: { id: reviewId, status: 'PUBLISHED' },
    select: {
      id: true, title: true, coverUrl: true, content: true, images: true, likeCount: true, favoriteCount: true,
      publishedAt: true, createdAt: true,
      MusicAlbum: { select: { id: true, name: true, releaseYear: true, language: true, coverUrl: true, _count: { select: { MusicSong: true } } } },
      User: { select: { id: true, uid: true, nickname: true, usernameModerationStatus: true, nicknameModerationStatus: true, nicknameViolationDisplay: true, Profile: { select: { displayName: true, displayNameModerationStatus: true } } } },
    },
  })
  if (!review) return NextResponse.json({ message: '专辑鉴赏不存在或暂未公开' }, { status: 404 })
  const auth = await resolveRequestAuth(request)
  if (auth.response) return auth.response
  const [liked, favorited] = auth.user ? await Promise.all([
    prisma.albumReviewLike.findUnique({ where: { reviewId_userId: { reviewId, userId: auth.user.id } }, select: { id: true } }),
    prisma.albumReviewFavorite.findUnique({ where: { reviewId_userId: { reviewId, userId: auth.user.id } }, select: { id: true } }),
  ]) : [null, null]
  return NextResponse.json({ review: {
    id: review.id,
    title: review.title,
    coverUrl: toPublicMediaUrl(review.coverUrl || review.MusicAlbum.coverUrl),
    content: review.content,
    images: readAlbumReviewImages(review.images).map((url) => toPublicMediaUrl(url)).filter(Boolean),
    likeCount: review.likeCount,
    favoriteCount: review.favoriteCount,
    publishedAt: (review.publishedAt || review.createdAt).toISOString(),
    album: { id: review.MusicAlbum.id, name: review.MusicAlbum.name, releaseYear: review.MusicAlbum.releaseYear, language: review.MusicAlbum.language, coverUrl: toPublicMediaUrl(review.MusicAlbum.coverUrl), songCount: review.MusicAlbum._count.MusicSong },
    author: { uid: review.User.uid, nickname: getPublicUserDisplayName(review.User) },
    liked: Boolean(liked),
    favorited: Boolean(favorited),
  } }, { headers: { 'Cache-Control': auth.user ? 'private, no-store' : 'public, max-age=30, s-maxage=60', Vary: 'Cookie, Authorization' } })
}
