import { NextResponse } from 'next/server'
import { getRecentUserBadges } from '@/lib/badge-service'
import { requireUser } from '@/lib/security'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const guard = await requireUser()
  if (!guard.user) return guard.response
  const rawLimit = Number(new URL(request.url).searchParams.get('limit') || 5)
  const limit = Number.isSafeInteger(rawLimit) ? Math.min(5, Math.max(1, rawLimit)) : 5
  return NextResponse.json({ badges: await getRecentUserBadges(guard.user.id, guard.user.id, limit) }, { headers: { 'Cache-Control': 'private, no-store' } })
}
