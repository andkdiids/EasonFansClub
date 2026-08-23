import { NextResponse } from 'next/server'
import { getPersonalRankingPublicComments, PersonalRankingError } from '@/lib/personal-ranking'
import { parseRatingReviewSort, parseRatingTarget } from '@/lib/rating-types'
import { sanitizeText } from '@/lib/security'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams
  const target = parseRatingTarget(params.get('type'))
  const targetId = sanitizeText(params.get('targetId'), 100)
  const page = Math.max(Number(params.get('page') || 1) || 1, 1)
  if (!targetId) return NextResponse.json({ message: '评价对象无效' }, { status: 400 })
  try {
    const result = await getPersonalRankingPublicComments(target, targetId, parseRatingReviewSort(params.get('sort')), page)
    return NextResponse.json(result, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    if (error instanceof PersonalRankingError) return NextResponse.json({ code: error.code, message: error.message }, { status: error.status })
    console.error('[ratings.public-comments]', error)
    return NextResponse.json({ message: '评价服务暂时不可用，请稍后重试' }, { status: 503 })
  }
}
