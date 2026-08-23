import { NextResponse } from 'next/server'
import { parsePersonalRankingType, searchPersonalRankingOptions } from '@/lib/personal-ranking'
import { requireUser, sanitizeText } from '@/lib/security'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const guard = await requireUser()
  if (!guard.user) return guard.response
  const params = new URL(request.url).searchParams
  const type = parsePersonalRankingType(params.get('type'))
  const query = sanitizeText(params.get('q'), 100)
  const page = Math.max(Number(params.get('page') || 1) || 1, 1)
  const result = await searchPersonalRankingOptions(guard.user.id, type, query, page)
  return NextResponse.json(result, { headers: { 'Cache-Control': 'private, no-store' } })
}
