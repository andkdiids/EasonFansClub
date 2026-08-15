import { NextResponse } from 'next/server'
import { getRatingRanking } from '@/lib/rating-service'
import { parseRatingLanguage } from '@/lib/rating-types'
import { sanitizeText } from '@/lib/security'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const searchParams = new URL(request.url).searchParams
  const result = await getRatingRanking({
    target: 'album',
    language: parseRatingLanguage(searchParams.get('language')),
    query: sanitizeText(searchParams.get('q'), 100),
    page: Math.max(Number(searchParams.get('page') || 1) || 1, 1),
    pageSize: Math.min(Number(searchParams.get('pageSize') || 30) || 30, 50),
  })
  return NextResponse.json(result, {
    headers: { 'Cache-Control': 'public, max-age=15, s-maxage=30, stale-while-revalidate=60', Vary: 'Cookie' },
  })
}
