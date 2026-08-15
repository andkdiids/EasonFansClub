import { NextResponse } from 'next/server'
import { toggleRatingReviewLike, RatingServiceError } from '@/lib/rating-service'
import { rejectInvalidRequestOrigin, requireUser } from '@/lib/security'

type Context = { params: Promise<{ reviewId: string }> }

export async function POST(request: Request, { params }: Context) {
  const originError = rejectInvalidRequestOrigin(request)
  if (originError) return originError
  const guard = await requireUser()
  if (!guard.user) return guard.response
  const { reviewId } = await params
  try {
    return NextResponse.json(await toggleRatingReviewLike({ reviewId, userId: guard.user.id }))
  } catch (error) {
    if (error instanceof RatingServiceError) return NextResponse.json({ code: error.code, message: error.message }, { status: error.status })
    console.error('[ratings.review.like]', error)
    return NextResponse.json({ message: '点赞操作失败，请稍后重试' }, { status: 503 })
  }
}
