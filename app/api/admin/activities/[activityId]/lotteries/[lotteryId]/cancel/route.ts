import { revalidatePath } from 'next/cache'
import { NextResponse } from 'next/server'
import { ActivityLotteryError, cancelActivityLottery } from '@/lib/activity-lottery'
import { requireAdmin, rejectInvalidRequestOrigin } from '@/lib/security'

export const dynamic = 'force-dynamic'

const idPattern = /^[A-Za-z0-9_-]{8,191}$/
const privateHeaders = { 'Cache-Control': 'private, no-store, max-age=0', Vary: 'Cookie' }

export async function POST(request: Request, { params }: { params: Promise<{ activityId: string; lotteryId: string }> }) {
  const invalidOrigin = rejectInvalidRequestOrigin(request)
  if (invalidOrigin) return invalidOrigin
  const guard = await requireAdmin('activity_manage')
  if (!guard.user) return guard.response
  const { activityId, lotteryId } = await params
  if (!idPattern.test(activityId) || !idPattern.test(lotteryId)) return NextResponse.json({ ok: false, message: '抽奖不存在' }, { status: 404, headers: privateHeaders })
  try {
    const result = await cancelActivityLottery(activityId, lotteryId, guard.user.id)
    revalidatePath(`/activities/${activityId}`)
    return NextResponse.json({ ok: true, ...result }, { headers: privateHeaders })
  } catch (error) {
    if (error instanceof ActivityLotteryError) return NextResponse.json({ ok: false, code: error.code, message: error.message }, { status: error.status, headers: privateHeaders })
    console.error('[admin.activities.lotteries.cancel]', error instanceof Error ? error.message : error)
    return NextResponse.json({ ok: false, message: '取消抽奖失败，请稍后重试' }, { status: 500, headers: privateHeaders })
  }
}
