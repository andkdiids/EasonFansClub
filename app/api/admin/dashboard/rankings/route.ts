import { NextResponse } from 'next/server'

import { DashboardDateRangeError, getDashboardRankings, parseDashboardRankingPeriod } from '@/lib/admin-dashboard-rankings'
import { requireAdmin } from '@/lib/security'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const guard = await requireAdmin('stats_view')
  if (!guard.user) return guard.response

  const params = new URL(request.url).searchParams
  // Invalid/missing preset values safely fall back to the established default.
  const period = parseDashboardRankingPeriod(params.get('period')) || 'this_week'
  const startDate = params.get('startDate') || params.get('start') || undefined
  const endDate = params.get('endDate') || params.get('end') || undefined

  try {
    const result = await getDashboardRankings({ period, startDate, endDate })
    return NextResponse.json({
      period: result.period,
      range: {
        start: result.range.start.toISOString(),
        end: result.range.endExclusive.toISOString(),
        endExclusive: result.range.endExclusive.toISOString(),
        startDate: result.range.startDateKey,
        endDate: result.range.endDateKey,
        label: result.range.label,
      },
      postRanking: result.postRanking,
      commentRanking: result.commentRanking,
      consultationRanking: result.consultationRanking,
    }, {
      headers: { 'Cache-Control': 'private, no-store, max-age=0' },
    })
  } catch (error) {
    if (error instanceof DashboardDateRangeError) {
      return NextResponse.json({ ok: false, code: error.code, message: error.message }, { status: error.status })
    }
    console.error('[admin.dashboard.rankings]', error)
    return NextResponse.json({ ok: false, code: 'RANKING_UNAVAILABLE', message: '排行榜数据暂时不可用，请稍后重试' }, { status: 500 })
  }
}
