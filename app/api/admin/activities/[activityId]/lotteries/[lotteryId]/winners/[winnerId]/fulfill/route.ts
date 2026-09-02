import { revalidatePath } from 'next/cache'
import { NextResponse } from 'next/server'
import { ActivityLotteryFulfillmentError, fulfillActivityLotteryPrize } from '@/lib/activity-lottery-fulfillment'
import { requireAdmin, rejectInvalidRequestOrigin } from '@/lib/security'

export const dynamic = 'force-dynamic'

const idPattern = /^[A-Za-z0-9_-]{8,191}$/
const privateHeaders = { 'Cache-Control': 'private, no-store, max-age=0', Vary: 'Cookie' }

export async function POST(request: Request, { params }: { params: Promise<{ activityId: string; lotteryId: string; winnerId: string }> }) {
  const invalidOrigin = rejectInvalidRequestOrigin(request)
  if (invalidOrigin) return invalidOrigin
  const guard = await requireAdmin('activity_manage')
  if (!guard.user) return guard.response
  const { activityId, lotteryId, winnerId } = await params
  if (!idPattern.test(activityId) || !idPattern.test(lotteryId) || !idPattern.test(winnerId)) return NextResponse.json({ ok: false, message: '中奖记录不存在' }, { status: 404, headers: privateHeaders })
  try {
    const result = await fulfillActivityLotteryPrize(winnerId, { actorId: guard.user.id, expectedActivityId: activityId, expectedLotteryId: lotteryId })
    revalidatePath(`/activities/${activityId}`)
    return NextResponse.json({ ok: true, ...result }, { headers: privateHeaders })
  } catch (error) {
    if (error instanceof ActivityLotteryFulfillmentError) return NextResponse.json({ ok: false, code: error.code, message: error.message }, { status: error.status, headers: privateHeaders })
    console.error('[admin.activities.lotteries.fulfill]', error instanceof Error ? error.message : error)
    return NextResponse.json({ ok: false, message: '虚拟奖品发放失败，请稍后重试' }, { status: 500, headers: privateHeaders })
  }
}
