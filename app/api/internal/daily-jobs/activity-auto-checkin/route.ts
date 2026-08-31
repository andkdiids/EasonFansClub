import { timingSafeEqual } from 'node:crypto'
import { NextResponse } from 'next/server'
import { autoCheckInEndedActivityRegistrations } from '@/lib/activity-registration'
import { drawDueActivityLotteries } from '@/lib/activity-lottery'

export const dynamic = 'force-dynamic'

function hasValidDailyJobSecret(request: Request) {
  const configured = process.env.DAILY_JOB_SECRET?.trim()
  const provided = request.headers.get('x-daily-job-secret')?.trim()
  if (!configured || !provided) return false
  const expected = Buffer.from(configured)
  const actual = Buffer.from(provided)
  return expected.length === actual.length && timingSafeEqual(expected, actual)
}

export async function POST(request: Request) {
  if (!process.env.DAILY_JOB_SECRET?.trim()) {
    return NextResponse.json({ ok: false, code: 'JOB_NOT_CONFIGURED', message: '活动自动核销任务未配置' }, { status: 503 })
  }
  if (!hasValidDailyJobSecret(request)) {
    return NextResponse.json({ ok: false, code: 'FORBIDDEN', message: '无权执行活动自动核销任务' }, { status: 403 })
  }

  const body = await request.json().catch(() => ({})) as { activityId?: unknown; batchSize?: unknown }
  const activityId = typeof body.activityId === 'string' && body.activityId.trim() ? body.activityId.trim() : undefined
  const requestedBatchSize = typeof body.batchSize === 'number' ? body.batchSize : undefined
  const batchSize = requestedBatchSize === undefined ? undefined : Math.min(Math.max(Math.trunc(requestedBatchSize), 1), 500)
  const startedAt = Date.now()
  try {
    const [checkInResult, lotteryResult] = await Promise.all([
      autoCheckInEndedActivityRegistrations({ activityId, batchSize }),
      drawDueActivityLotteries({ activityId, batchSize: batchSize ? Math.min(batchSize, 200) : undefined }),
    ])
    const result = { ...checkInResult, lottery: lotteryResult }
    console.info('[daily-job.activity-auto-checkin.completed]', {
      event: 'daily_job.completed',
      jobKey: 'activity-auto-checkin',
      ...result,
      durationMs: Date.now() - startedAt,
    })
    return NextResponse.json({ ok: true, jobKey: 'activity-auto-checkin', ...result }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    console.error('[daily-job.activity-auto-checkin.failed]', {
      event: 'daily_job.failed',
      jobKey: 'activity-auto-checkin',
      durationMs: Date.now() - startedAt,
      error: error instanceof Error ? { name: error.name, message: error.message } : String(error),
    })
    return NextResponse.json({ ok: false, code: 'JOB_FAILED', message: '活动自动核销任务执行失败' }, { status: 500 })
  }
}
