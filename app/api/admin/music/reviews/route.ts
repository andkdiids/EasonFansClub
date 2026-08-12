import { NextResponse } from 'next/server'
import {
  albumReviewPublishedAt,
  parseAlbumReviewImages,
  parseAlbumReviewStatus,
} from '@/lib/album-reviews'
import { toPublicMediaUrl } from '@/lib/media-url'
import { prisma } from '@/lib/prisma'
import { requireAdmin, sanitizeText } from '@/lib/security'

export const dynamic = 'force-dynamic'

function publicReview(review: { coverUrl: string | null; images: unknown; [key: string]: unknown }) {
  return {
    ...review,
    coverUrl: toPublicMediaUrl(review.coverUrl),
    images: parseAlbumReviewImages(review.images).map((url) => toPublicMediaUrl(url) || url),
  }
}

export async function GET() {
  const guard = await requireAdmin('music_manage')
  if (!guard.user) return guard.response
  const reviews = await prisma.albumReview.findMany({
    orderBy: [{ updatedAt: 'desc' }],
    include: {
      MusicAlbum: { select: { id: true, name: true, releaseYear: true } },
      User: { select: { id: true, nickname: true } },
    },
    take: 200,
  })
  const albums = await prisma.musicAlbum.findMany({
    orderBy: [{ displayOrder: 'asc' }, { releaseYear: 'desc' }],
    select: { id: true, name: true, releaseYear: true, coverUrl: true },
  })
  return NextResponse.json({ reviews: reviews.map(publicReview), albums: albums.map((album) => ({ ...album, coverUrl: toPublicMediaUrl(album.coverUrl) })) })
}

export async function POST(request: Request) {
  const guard = await requireAdmin('music_manage')
  if (!guard.user) return guard.response
  const body = await request.json().catch(() => null)
  const title = sanitizeText(body?.title, 180)
  const albumId = sanitizeText(body?.albumId, 100)
  const content = sanitizeText(body?.content, 100_000)
  const images = parseAlbumReviewImages(body?.images)
  const status = parseAlbumReviewStatus(body?.status)
  if (!title || !albumId || !content) {
    return NextResponse.json({ message: '请填写标题、所属专辑和正文' }, { status: 400 })
  }
  const album = await prisma.musicAlbum.findUnique({
    where: { id: albumId },
    select: { id: true, coverUrl: true },
  })
  if (!album) return NextResponse.json({ message: '所属专辑不存在' }, { status: 400 })
  const review = await prisma.albumReview.create({
    data: {
      title,
      albumId,
      content,
      images,
      coverUrl: sanitizeText(body?.coverUrl, 1000) || images[0] || album.coverUrl || null,
      authorId: guard.user.id,
      status,
      publishedAt: albumReviewPublishedAt(status),
    },
  })
  return NextResponse.json({ review: publicReview(review), message: '专辑鉴赏已创建' }, { status: 201 })
}
