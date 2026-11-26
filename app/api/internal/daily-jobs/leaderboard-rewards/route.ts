import { timingSafeEqual } from 'node:crypto'
import { NextResponse } from 'next/server'
import { getLeaderboardRewardsConfig } from '@/lib/leaderboard-rewards-settings'
import { runLeaderboardSettlement } from '@/lib/leaderboard-rewards-settlement'
import type { SettlementKind } from '@/lib/leaderboard-rewards-period'

export const dynamic = 'force-dynamic'

function hasValidDailyJobSecret(request: Request) {
  const configured = process.env.DAILY_JOB_SECRET?.trim()
  const provided = request.headers.get('x-daily-job-secret')?.trim()
  if (!configured || !provided) return false
  const expected = Buffer.from(configured)
  const actual = Buffer.from(provided)
  return expected.length === actual.length && timingSafeEqual(expected, actual)
}

/**
 * Cron entry for automatic leaderboard rewards.
 *
 * `kind` selects weekly (Monday 06:00) or monthly (1st 06:00). The settlement
 * engine resolves the PREVIOUS full period from the wall clock and refuses any
 * period that starts before the configured go-live instant, so this endpoint
 * can never backfill history even if invoked repeatedly.
 */
export async function POST(request: Request) {
  if (!process.env.DAILY_JOB_SECRET?.trim()) {
    return NextResponse.json({ ok: false, code: 'JOB_NOT_CONFIGURED', message: '排行榜结算任务未配置' }, { status: 503 })
  }
  if (!hasValidDailyJobSecret(request)) {
    return NextResponse.json({ ok: false, code: 'FORBIDDEN', message: '无权执行排行榜结算任务' }, { status: 403 })
  }

  const body = await request.json().catch(() => ({})) as { kind?: unknown }
  const kind: SettlementKind = body.kind === 'monthly' ? 'monthly' : 'weekly'
  const startedAt = Date.now()
  try {
    const config = await getLeaderboardRewardsConfig()
    if (!config.enabled) {
      return NextResponse.json({ ok: true, jobKey: 'leaderboard-rewards', kind, status: 'SKIPPED', reason: 'DISABLED' }, { headers: { 'Cache-Control': 'no-store' } })
    }
    const now = new Date()
    const result = await runLeaderboardSettlement({ kind, config, now })
    console.info('[daily-job.leaderboard-rewards.completed]', {
      event: 'daily_job.completed', jobKey: 'leaderboard-rewards', kind, ...result, durationMs: Date.now() - startedAt,
    })
    return NextResponse.json({ ok: true, jobKey: 'leaderboard-rewards', ...result }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    console.error('[daily-job.leaderboard-rewards.failed]', {
      event: 'daily_job.failed', jobKey: 'leaderboard-rewards', kind,
      durationMs: Date.now() - startedAt,
      error: error instanceof Error ? { name: error.name, message: error.message } : String(error),
    })
    return NextResponse.json({ ok: false, code: 'JOB_FAILED', message: '排行榜结算任务执行失败' }, { status: 500 })
  }
}
