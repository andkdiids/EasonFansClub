import { timingSafeEqual } from 'node:crypto'
import { NextResponse } from 'next/server'
import { getShanghaiDateKey, parseBeijingDate } from '@/lib/checkin'
import { runDailyBirthdayRewards } from '@/lib/birthday'

type DailyJobSecretState = 'unconfigured' | 'missing' | 'invalid' | 'valid'

function getDailyJobSecretState(request: Request): DailyJobSecretState {
  const configured = process.env.DAILY_JOB_SECRET?.trim()
  const provided = request.headers.get('x-daily-job-secret')?.trim()
  if (!configured) return 'unconfigured'
  if (!provided) return 'missing'

  const expectedBuffer = Buffer.from(configured)
  const providedBuffer = Buffer.from(provided)
  if (expectedBuffer.length !== providedBuffer.length) return 'invalid'
  return timingSafeEqual(expectedBuffer, providedBuffer) ? 'valid' : 'invalid'
}

export async function POST(request: Request) {
  const secretState = getDailyJobSecretState(request)
  if (secretState === 'unconfigured') {
    return NextResponse.json({ message: '每日任务未配置' }, { status: 503 })
  }
  if (secretState !== 'valid') {
    return NextResponse.json({ ok: false, code: 'FORBIDDEN', message: '无权执行每日任务' }, { status: 403 })
  }

  const body = await request.json().catch(() => ({})) as { dateKey?: unknown }
  const dateKey = typeof body.dateKey === 'string' && body.dateKey ? body.dateKey : getShanghaiDateKey()
  const date = parseBeijingDate(dateKey)
  const today = parseBeijingDate(getShanghaiDateKey())
  if (!date || !today || date > today) {
    return NextResponse.json({ message: '日期参数无效' }, { status: 400 })
  }

  const startedAt = Date.now()
  try {
    const result = await runDailyBirthdayRewards(dateKey)
    console.info('[daily-job.birthday.completed]', {
      event: 'daily_job.completed',
      jobKey: 'birthday-rewards',
      dateKey,
      executed: result.executed,
      status: result.status,
      durationMs: Date.now() - startedAt,
    })
    return NextResponse.json({
      ok: true,
      jobKey: 'birthday-rewards',
      dateKey,
      executed: result.executed,
      status: result.status,
    }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    console.error('[daily-job.birthday.failed]', {
      jobKey: 'birthday-rewards',
      dateKey,
      durationMs: Date.now() - startedAt,
      error: error instanceof Error ? { name: error.name, message: error.message } : String(error),
    })
    return NextResponse.json({ message: '生日任务执行失败' }, { status: 500 })
  }
}
