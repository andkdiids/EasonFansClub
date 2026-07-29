import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { rejectInvalidRequestOrigin, requireUser, sanitizeText } from '@/lib/security'

type Context = { params: Promise<{ reviewId: string }> }

export async function POST(request: Request, { params }: Context) {
  const originError = rejectInvalidRequestOrigin(request)
  if (originError) return originError
  const guard = await requireUser()
  if (!guard.user) return guard.response
  const { reviewId } = await params
  const action = sanitizeText((await request.json().catch(() => null))?.action, 20)
  if (action !== 'like' && action !== 'favorite') {
    return NextResponse.json({ message: '互动类型无效' }, { status: 400 })
  }
  const review = await prisma.albumReview.findFirst({
    where: { id: reviewId, status: 'PUBLISHED' },
    select: { id: true },
  })
  if (!review) return NextResponse.json({ message: '专辑鉴赏不存在或未发布' }, { status: 404 })

  const result = await prisma.$transaction(async (tx) => {
    if (action === 'like') {
      const existing = await tx.albumReviewLike.findUnique({
        where: { reviewId_userId: { reviewId, userId: guard.user.id } },
      })
      if (existing) await tx.albumReviewLike.delete({ where: { id: existing.id } })
      else await tx.albumReviewLike.create({ data: { reviewId, userId: guard.user.id } })
    } else {
      const existing = await tx.albumReviewFavorite.findUnique({
        where: { reviewId_userId: { reviewId, userId: guard.user.id } },
      })
      if (existing) await tx.albumReviewFavorite.delete({ where: { id: existing.id } })
      else await tx.albumReviewFavorite.create({ data: { reviewId, userId: guard.user.id } })
    }
    const [liked, favorited, likeCount, favoriteCount] = await Promise.all([
      tx.albumReviewLike.findUnique({ where: { reviewId_userId: { reviewId, userId: guard.user.id } } }),
      tx.albumReviewFavorite.findUnique({ where: { reviewId_userId: { reviewId, userId: guard.user.id } } }),
      tx.albumReviewLike.count({ where: { reviewId } }),
      tx.albumReviewFavorite.count({ where: { reviewId } }),
    ])
    await tx.albumReview.update({ where: { id: reviewId }, data: { likeCount, favoriteCount } })
    return { liked: Boolean(liked), favorited: Boolean(favorited), likeCount, favoriteCount }
  })
  return NextResponse.json(result)
}
