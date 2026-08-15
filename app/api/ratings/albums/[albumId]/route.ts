import { Prisma } from '@prisma/client'
import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import {
  createRatingWithOptionalReview,
  getAlbumRatingDetail,
  RatingServiceError,
} from '@/lib/rating-service'
import { parseRatingReviewSort, parseRatingScore } from '@/lib/rating-types'
import { rejectInvalidRequestOrigin, requireUser, sanitizeText } from '@/lib/security'
import { BANNED_WORD_MESSAGE, CONTENT_CONTAINS_BANNED_WORD, checkBannedWords } from '@/lib/content-moderation'

type Context = { params: Promise<{ albumId: string }> }

function errorResponse(error: unknown) {
  if (error instanceof RatingServiceError) return NextResponse.json({ code: error.code, message: error.message }, { status: error.status })
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') return NextResponse.json({ code: 'ALREADY_RATED', message: '你已经评价过这张专辑' }, { status: 409 })
  console.error('[ratings.album]', error)
  return NextResponse.json({ message: '评分服务暂时不可用，请稍后重试' }, { status: 503 })
}

export async function GET(request: Request, { params }: Context) {
  const { albumId } = await params
  const viewer = await getCurrentUser().catch(() => null)
  try {
    const detail = await getAlbumRatingDetail(albumId, viewer?.id || null, parseRatingReviewSort(new URL(request.url).searchParams.get('sort')))
    if (!detail) return NextResponse.json({ message: '专辑不存在或暂未公开' }, { status: 404 })
    return NextResponse.json(detail, { headers: { 'Cache-Control': viewer ? 'private, no-store' : 'public, max-age=15, s-maxage=30, stale-while-revalidate=60', Vary: 'Cookie' } })
  } catch (error) {
    return errorResponse(error)
  }
}

export async function POST(request: Request, { params }: Context) {
  const originError = rejectInvalidRequestOrigin(request)
  if (originError) return originError
  const guard = await requireUser()
  if (!guard.user) return guard.response
  const { albumId } = await params
  const body = await request.json().catch(() => null)
  const score = parseRatingScore(body?.score)
  if (score === null) return NextResponse.json({ code: 'INVALID_SCORE', message: '评分必须是 1 到 10 的整数' }, { status: 400 })
  const content = sanitizeText(body?.content, 1000)
  if (content && (await checkBannedWords(content)).blocked) return NextResponse.json({ error: CONTENT_CONTAINS_BANNED_WORD, message: BANNED_WORD_MESSAGE }, { status: 400 })
  try {
    const result = await createRatingWithOptionalReview({ target: 'album', targetId: albumId, userId: guard.user.id, score, content })
    return NextResponse.json({ ...result, rating: { ...result.rating, createdAt: result.rating.createdAt.toISOString() }, review: result.review ? { ...result.review, createdAt: result.review.createdAt.toISOString() } : null }, { status: 201 })
  } catch (error) {
    return errorResponse(error)
  }
}
