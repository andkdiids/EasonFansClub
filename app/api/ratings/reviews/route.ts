import { NextResponse } from 'next/server'
import { createRatingReview, RatingServiceError } from '@/lib/rating-service'
import { rejectInvalidRequestOrigin, requireUser, sanitizeText } from '@/lib/security'
import { BANNED_WORD_MESSAGE, CONTENT_CONTAINS_BANNED_WORD, checkBannedWords } from '@/lib/content-moderation'
import { getReplyLengthMetrics, replyTooLongPayload } from '@/lib/reply-length'

export async function POST(request: Request) {
  const originError = rejectInvalidRequestOrigin(request)
  if (originError) return originError
  const guard = await requireUser()
  if (!guard.user) return guard.response
  const body = await request.json().catch(() => null)
  const target = body?.target === 'album' ? 'album' : 'song'
  const targetId = sanitizeText(body?.targetId, 100)
  const contentLength = getReplyLengthMetrics(body?.content)
  if (contentLength.exceededBy > 0) return NextResponse.json({ ok: false, ...replyTooLongPayload(contentLength, '评价') }, { status: 400 })
  const content = contentLength.content
  if (!targetId || !content) return NextResponse.json({ message: '请填写评价内容' }, { status: 400 })
  if ((await checkBannedWords(content)).blocked) return NextResponse.json({ error: CONTENT_CONTAINS_BANNED_WORD, message: BANNED_WORD_MESSAGE }, { status: 400 })
  try {
    const result = await createRatingReview({ target, targetId, userId: guard.user.id, content })
    return NextResponse.json({ ...result, review: { ...result.review, createdAt: result.review.createdAt.toISOString() } }, { status: 201 })
  } catch (error) {
    if (error instanceof RatingServiceError) return NextResponse.json({ code: error.code, message: error.message, ...(error.details || {}) }, { status: error.status })
    console.error('[ratings.review.create]', error)
    return NextResponse.json({ message: '评价服务暂时不可用，请稍后重试' }, { status: 503 })
  }
}
