import { timingSafeEqual } from 'node:crypto'
import { NextResponse } from 'next/server'
import { runScheduledPostPublicationJob } from '@/lib/post-publication'

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
    return NextResponse.json({ ok: false, message: '定时发布任务未配置' }, { status: 503 })
  }
  if (!hasValidDailyJobSecret(request)) {
    return NextResponse.json({ ok: false, code: 'FORBIDDEN', message: '无权执行定时发布任务' }, { status: 403 })
  }

  const startedAt = Date.now()
  try {
    const result = await runScheduledPostPublicationJob()
    const durationMs = Date.now() - startedAt
    if (result.eventsFailed > 0) {
      console.error('[daily-job.scheduled-post-publication.failed]', {
        event: 'daily_job.failed',
        jobKey: 'scheduled-post-publication',
        ...result,
        durationMs,
      })
      return NextResponse.json({ ok: false, jobKey: 'scheduled-post-publication', ...result }, { status: 500, headers: { 'Cache-Control': 'no-store' } })
    }

    console.info('[daily-job.scheduled-post-publication.completed]', {
      event: 'daily_job.completed',
      jobKey: 'scheduled-post-publication',
      ...result,
      durationMs,
    })
    return NextResponse.json({ ok: true, jobKey: 'scheduled-post-publication', ...result }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    console.error('[daily-job.scheduled-post-publication.failed]', {
      event: 'daily_job.failed',
      jobKey: 'scheduled-post-publication',
      durationMs: Date.now() - startedAt,
      error: error instanceof Error ? { name: error.name, message: error.message } : String(error),
    })
    return NextResponse.json({ ok: false, message: '定时发布任务执行失败' }, { status: 500, headers: { 'Cache-Control': 'no-store' } })
  }
}
