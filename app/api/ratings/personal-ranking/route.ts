import { NextResponse } from 'next/server'
import { getPersonalRanking, parsePersonalRankingType } from '@/lib/personal-ranking'
import { requireUser } from '@/lib/security'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const guard = await requireUser()
  if (!guard.user) return guard.response
  const type = parsePersonalRankingType(new URL(request.url).searchParams.get('type'))
  const ranking = await getPersonalRanking(guard.user.id, type)
  return NextResponse.json(ranking, { headers: { 'Cache-Control': 'private, no-store' } })
}
