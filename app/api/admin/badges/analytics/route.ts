import { NextResponse } from 'next/server'
import { getBadgeAnalytics, type BadgeAnalyticsRange } from '@/lib/badge-phase5'
import { requireAdmin } from '@/lib/security'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const guard = await requireAdmin('achievement_manage')
  if (!guard.user) return guard.response
  const params = new URL(request.url).searchParams
  const range = params.get('range') === 'all' ? 'all' : '30d'
  const page = Math.max(1, Number.parseInt(params.get('page') || '1', 10) || 1)
  const pageSize = Math.min(50, Math.max(1, Number.parseInt(params.get('pageSize') || '20', 10) || 20))
  const result = await getBadgeAnalytics(range as BadgeAnalyticsRange, page, pageSize)
  return NextResponse.json(result, { headers: { 'Cache-Control': 'private, max-age=30' } })
}
