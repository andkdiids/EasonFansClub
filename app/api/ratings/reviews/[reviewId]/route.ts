import { NextResponse } from 'next/server'
import { deleteRatingReview, RatingServiceError } from '@/lib/rating-service'
import { hasAdminPermission } from '@/lib/admin-permissions'
import { rejectInvalidRequestOrigin, requireRequestUser } from '@/lib/security'

type Context = { params: Promise<{ reviewId: string }> }

export async function DELETE(request: Request, { params }: Context) {
  const originError = rejectInvalidRequestOrigin(request)
  if (originError) return originError
  const guard = await requireRequestUser(request)
  if (!guard.user) return guard.response
  const user = guard.user
  const { reviewId } = await params
  try {
    const canModerate = await hasAdminPermission(user, 'rating_manage')
    const result = await deleteRatingReview({ reviewId, userId: user.id, canModerate })
    return NextResponse.json(result)
  } catch (error) {
    if (error instanceof RatingServiceError) return NextResponse.json({ code: error.code, message: error.message }, { status: error.status })
    console.error('[ratings.review.delete]', error)
    return NextResponse.json({ message: '删除评价失败，请稍后重试' }, { status: 503 })
  }
}
