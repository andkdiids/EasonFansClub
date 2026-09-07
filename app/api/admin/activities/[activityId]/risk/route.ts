import { NextResponse } from 'next/server'
import { getActivityRiskReport, toPublicActivityRiskReport } from '@/lib/activity-risk'
import { requireAdmin } from '@/lib/security'

export const dynamic = 'force-dynamic'

const activityIdPattern = /^[A-Za-z0-9_-]{8,128}$/
const privateHeaders = { 'Cache-Control': 'private, no-store, max-age=0', Vary: 'Cookie' }

export async function GET(_request: Request, { params }: { params: Promise<{ activityId: string }> }) {
  const guard = await requireAdmin('activity_manage')
  if (!guard.user) return guard.response
  const { activityId } = await params
  if (!activityIdPattern.test(activityId)) return NextResponse.json({ ok: false, message: '活动不存在' }, { status: 404, headers: privateHeaders })
  try {
    const report = await getActivityRiskReport(activityId)
    if (!report) return NextResponse.json({ ok: false, message: '活动不存在' }, { status: 404, headers: privateHeaders })
    return NextResponse.json({ ok: true, ...toPublicActivityRiskReport(report) }, { headers: privateHeaders })
  } catch (error) {
    console.error('[admin.activities.risk]', error instanceof Error ? error.message : error)
    return NextResponse.json({ ok: false, message: '异常报名分析失败，请稍后重试' }, { status: 500, headers: privateHeaders })
  }
}
