import { NextResponse } from 'next/server'
import { getPublicActivityLotteries } from '@/lib/activity-lottery'
import { buildMobilePublicActivityWinnersPage } from '@/lib/mobile-public-activity-winners'
import { requireRequestUser } from '@/lib/security'

export const dynamic = 'force-dynamic'
const idPattern = /^[A-Za-z0-9_-]{8,128}$/

export async function GET(request: Request, { params }: { params: Promise<{ activityId: string }> }) {
  const guard = await requireRequestUser(request)
  if (!guard.user) return guard.response
  const { activityId } = await params
  const search = new URL(request.url).searchParams
  const lotteryId = search.get('lotteryId')?.trim() || ''
  if (!idPattern.test(activityId) || !idPattern.test(lotteryId)) return NextResponse.json({ message: '抽奖记录不存在' }, { status: 404 })

  try {
    const lottery = (await getPublicActivityLotteries(activityId, guard.user.id)).find((item) => item.id === lotteryId)
    if (!lottery) return NextResponse.json({ message: '抽奖记录不存在' }, { status: 404 })
    return NextResponse.json(buildMobilePublicActivityWinnersPage(lottery, search.get('page'), search.get('pageSize')), {
      headers: { 'Cache-Control': 'private, no-store, max-age=0', Vary: 'Cookie, Authorization' },
    })
  } catch (error) {
    console.error('[activities.lottery-winners.failed]', { activityId, lotteryId, error: error instanceof Error ? error.name : 'UNKNOWN' })
    return NextResponse.json({ message: '中奖名单暂时无法读取，请稍后重试' }, { status: 500, headers: { 'Cache-Control': 'private, no-store, max-age=0' } })
  }
}
