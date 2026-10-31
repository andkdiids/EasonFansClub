import { NextResponse } from 'next/server'
import { getPublicUserDisplayName } from '@/lib/friend-remarks'
import { toPublicMediaUrl } from '@/lib/media-url'
import { prisma } from '@/lib/prisma'
import { resolveRequestAuth } from '@/lib/security'

export const dynamic = 'force-dynamic'

function positiveInt(value: string | null, fallback: number, max: number) {
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed > 0 ? Math.min(parsed, max) : fallback
}

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams
  const page = positiveInt(params.get('page'), 1, 10_000)
  const pageSize = positiveInt(params.get('pageSize'), 20, 40)
  const [total, reviews] = await Promise.all([
    prisma.albumReview.count({ where: { status: 'PUBLISHED' } }),
    prisma.albumReview.findMany({
      where: { status: 'PUBLISHED' },
      orderBy: [{ publishedAt: 'desc' }, { createdAt: 'desc' }],
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: {
        id: true, title: true, coverUrl: true, likeCount: true, favoriteCount: true, publishedAt: true, createdAt: true,
        MusicAlbum: { select: { id: true, name: true, releaseYear: true, coverUrl: true } },
        User: { select: { id: true, uid: true, nickname: true, usernameModerationStatus: true, nicknameModerationStatus: true, nicknameViolationDisplay: true, Profile: { select: { displayName: true, displayNameModerationStatus: true } } } },
      },
    }),
  ])
  const auth = await resolveRequestAuth(request)
  if (auth.response) return auth.response
  const ids = reviews.map((review) => review.id)
  const [likes, favorites] = auth.user && ids.length ? await Promise.all([
    prisma.albumReviewLike.findMany({ where: { userId: auth.user.id, reviewId: { in: ids } }, select: { reviewId: true } }),
    prisma.albumReviewFavorite.findMany({ where: { userId: auth.user.id, reviewId: { in: ids } }, select: { reviewId: true } }),
  ]) : [[], []]
  const liked = new Set(likes.map((row) => row.reviewId))
  const favorited = new Set(favorites.map((row) => row.reviewId))
  return NextResponse.json({
    page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)),
    reviews: reviews.map((review) => ({
      id: review.id,
      title: review.title,
      coverUrl: toPublicMediaUrl(review.coverUrl || review.MusicAlbum.coverUrl),
      likeCount: review.likeCount,
      favoriteCount: review.favoriteCount,
      publishedAt: (review.publishedAt || review.createdAt).toISOString(),
      album: { ...review.MusicAlbum, coverUrl: toPublicMediaUrl(review.MusicAlbum.coverUrl) },
      author: { uid: review.User.uid, nickname: getPublicUserDisplayName(review.User) },
      liked: liked.has(review.id),
      favorited: favorited.has(review.id),
    })),
  }, { headers: { 'Cache-Control': auth.user ? 'private, no-store' : 'public, max-age=30, s-maxage=60', Vary: 'Cookie, Authorization' } })
}
