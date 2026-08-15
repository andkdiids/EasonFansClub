import { NextResponse } from 'next/server'
import { deleteRatingReview, RatingServiceError } from '@/lib/rating-service'
import { requireAdmin } from '@/lib/security'

type Context = { params: Promise<{ reviewId: string }> }

export async function DELETE(_: Request, { params }: Context) {
  const guard = await requireAdmin('rating_manage')
  if (!guard.user) return guard.response
  const { reviewId } = await params
  try {
    return NextResponse.json(await deleteRatingReview({ reviewId, userId: guard.user.id, canModerate: true }))
  } catch (error) {
    if (error instanceof RatingServiceError) return NextResponse.json({ code: error.code, message: error.message }, { status: error.status })
    console.error('[admin.ratings.review.delete]', error)
    return NextResponse.json({ message: '删除评价失败，请稍后重试' }, { status: 503 })
  }
}
