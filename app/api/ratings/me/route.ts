import { NextResponse } from 'next/server'
import { requireUser } from '@/lib/security'
import { getMyRatings } from '@/lib/rating-service'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const guard = await requireUser()
  if (!guard.user) return guard.response
  const params = new URL(request.url).searchParams
  const rawTarget = params.get('target')
  const target = rawTarget === 'song' || rawTarget === 'album' ? rawTarget : undefined
  const page = Math.max(Number(params.get('page') || 1) || 1, 1)
  return NextResponse.json(await getMyRatings({ userId: guard.user.id, target, page }), { headers: { 'Cache-Control': 'private, no-store', Vary: 'Cookie' } })
}
