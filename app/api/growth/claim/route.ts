import { NextResponse } from 'next/server'
import { getGrowthOverview, claimGrowthTask, claimWeeklyMilestone } from '@/lib/growth-tasks/service'
import { getGrowthTask, type GrowthTaskCode } from '@/lib/growth-tasks/registry'
import { requireUser } from '@/lib/security'

function errorStatus(error: unknown) {
  return error instanceof Error && ['GROWTH_TASK_NOT_COMPLETED', 'WEEKLY_MILESTONE_NOT_REACHED'].includes(error.message) ? 409 : 400
}
export async function POST(request: Request) {
  const guard = await requireUser()
  if (!guard.user) return guard.response
  const body = await request.json().catch(() => null) as Record<string, unknown> | null
  const taskCode = typeof body?.taskCode === 'string' ? body.taskCode as GrowthTaskCode : null
  const milestone = Number(body?.milestone)
  try {
    if (taskCode) {
      if (!getGrowthTask(taskCode)) return NextResponse.json({ ok: false, message: '成长项目不存在' }, { status: 400 })
      await claimGrowthTask(guard.user.id, taskCode)
    } else if (Number.isInteger(milestone)) {
      await claimWeeklyMilestone(guard.user.id, milestone)
    } else {
      return NextResponse.json({ ok: false, message: '领取参数无效' }, { status: 400 })
    }
    return NextResponse.json(await getGrowthOverview(guard.user.id), { headers: { 'Cache-Control': 'private, no-store' } })
  } catch (error) {
    console.error('[growth.claim]', error)
    return NextResponse.json({ ok: false, message: '当前还不能领取这份奖励' }, { status: errorStatus(error) })
  }
}
