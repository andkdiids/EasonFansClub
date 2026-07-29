import { NextResponse } from 'next/server'
import {
  albumReviewPublishedAt,
  parseAlbumReviewImages,
  parseAlbumReviewStatus,
} from '@/lib/album-reviews'
import { prisma } from '@/lib/prisma'
import { requireAdmin, sanitizeText } from '@/lib/security'

type Context = { params: Promise<{ reviewId: string }> }

export async function PATCH(request: Request, { params }: Context) {
  const guard = await requireAdmin('music_manage')
  if (!guard.user) return guard.response
  const { reviewId } = await params
  const current = await prisma.albumReview.findUnique({ where: { id: reviewId } })
  if (!current) return NextResponse.json({ message: '专辑鉴赏不存在' }, { status: 404 })
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
  const review = await prisma.albumReview.update({
    where: { id: reviewId },
    data: {
      title,
      albumId,
      content,
      images,
      coverUrl: sanitizeText(body?.coverUrl, 1000) || images[0] || album.coverUrl || null,
      status,
      publishedAt: albumReviewPublishedAt(status, current.publishedAt),
    },
  })
  return NextResponse.json({ review, message: '专辑鉴赏已保存' })
}

export async function DELETE(_: Request, { params }: Context) {
  const guard = await requireAdmin('music_manage')
  if (!guard.user) return guard.response
  const { reviewId } = await params
  await prisma.albumReview.delete({ where: { id: reviewId } }).catch(() => null)
  return NextResponse.json({ id: reviewId })
}
