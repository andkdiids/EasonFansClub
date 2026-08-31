import { revalidatePath } from 'next/cache'
import { NextResponse } from 'next/server'
import { ActivityLotteryError, createActivityLottery, getAdminActivityLotteries } from '@/lib/activity-lottery'
import { requireAdmin, rejectInvalidRequestOrigin } from '@/lib/security'

export const dynamic = 'force-dynamic'

const activityIdPattern = /^[A-Za-z0-9_-]{8,128}$/
const privateHeaders = { 'Cache-Control': 'private, no-store, max-age=0', Vary: 'Cookie' }

export async function GET(_request: Request, { params }: { params: Promise<{ activityId: string }> }) {
  const guard = await requireAdmin('activity_manage')
  if (!guard.user) return guard.response
  const { activityId } = await params
  if (!activityIdPattern.test(activityId)) return NextResponse.json({ ok: false, message: '活动不存在' }, { status: 404, headers: privateHeaders })
  try {
    const result = await getAdminActivityLotteries(activityId)
    if (!result) return NextResponse.json({ ok: false, message: '活动不存在' }, { status: 404, headers: privateHeaders })
    return NextResponse.json(result, { headers: privateHeaders })
  } catch (error) {
    console.error('[admin.activities.lotteries.list]', error instanceof Error ? error.message : error)
    return NextResponse.json({ ok: false, message: '抽奖加载失败，请稍后重试' }, { status: 500, headers: privateHeaders })
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ activityId: string }> }) {
  const invalidOrigin = rejectInvalidRequestOrigin(request)
  if (invalidOrigin) return invalidOrigin
  const guard = await requireAdmin('activity_manage')
  if (!guard.user) return guard.response
  const { activityId } = await params
  if (!activityIdPattern.test(activityId)) return NextResponse.json({ ok: false, message: '活动不存在' }, { status: 404, headers: privateHeaders })
  const body = await request.json().catch(() => null)
  try {
    const lottery = await createActivityLottery(activityId, guard.user.id, body)
    revalidatePath(`/activities/${activityId}`)
    return NextResponse.json({ ok: true, lottery }, { headers: privateHeaders })
  } catch (error) {
    if (error instanceof ActivityLotteryError) return NextResponse.json({ ok: false, code: error.code, message: error.message }, { status: error.status, headers: privateHeaders })
    console.error('[admin.activities.lotteries.create]', error instanceof Error ? error.message : error)
    return NextResponse.json({ ok: false, message: '创建抽奖失败，请稍后重试' }, { status: 500, headers: privateHeaders })
  }
}
