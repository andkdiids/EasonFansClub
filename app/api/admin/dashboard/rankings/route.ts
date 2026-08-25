import { NextResponse } from 'next/server'

import { getDashboardRankings, parseDashboardRankingPeriod } from '@/lib/admin-dashboard-rankings'
import { requireAdmin } from '@/lib/security'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const guard = await requireAdmin('stats_view')
  if (!guard.user) return guard.response

  const rawPeriod = new URL(request.url).searchParams.get('period')
  const period = parseDashboardRankingPeriod(rawPeriod)
  if (!period) {
    return NextResponse.json({ ok: false, code: 'INVALID_PERIOD', message: '排行榜周期必须是 week 或 month' }, { status: 400 })
  }

  try {
    const result = await getDashboardRankings(period)
    return NextResponse.json({
      period: result.period,
      range: {
        start: result.range.start.toISOString(),
        end: result.range.end.toISOString(),
      },
      postRanking: result.postRanking,
      commentRanking: result.commentRanking,
      consultationRanking: result.consultationRanking,
    }, {
      headers: { 'Cache-Control': 'private, no-store, max-age=0' },
    })
  } catch (error) {
    console.error('[admin.dashboard.rankings]', error)
    return NextResponse.json({ ok: false, code: 'RANKING_UNAVAILABLE', message: '排行榜数据暂时不可用，请稍后重试' }, { status: 500 })
  }
}
