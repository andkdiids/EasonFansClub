import { NextResponse } from 'next/server'

import { getModerationScanJob, startModerationScan } from '@/lib/content-moderation-job'
import { requireAdmin } from '@/lib/security'

export async function POST() {
  const guard = await requireAdmin('banned_word_manage')
  if (!guard.user) return guard.response
  const job = await startModerationScan()
  return NextResponse.json({ job, message: '扫描中...' }, { status: 202 })
}

export async function GET(request: Request) {
  const guard = await requireAdmin('banned_word_manage')
  if (!guard.user) return guard.response
  const id = new URL(request.url).searchParams.get('jobId') || ''
  const job = await getModerationScanJob(id)
  if (!job) return NextResponse.json({ error: 'SCAN_JOB_NOT_FOUND', message: '扫描任务不存在或已过期。' }, { status: 404 })
  return NextResponse.json({ job }, { headers: { 'Cache-Control': 'no-store' } })
}
