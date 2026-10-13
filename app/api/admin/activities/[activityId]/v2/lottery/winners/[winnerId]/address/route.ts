import { hasAdminPermission } from '@/lib/admin-permissions'
import { requireRequestAdmin } from '@/lib/security'
import { getAdminTopicLotteryAddress } from '@/lib/topic-activity-v2-lottery-fulfillment'
import { topicLotteryErrorResponse } from '@/lib/topic-activity-v2-lottery-http'
import { topicV2IdPattern, topicV2Json } from '@/lib/topic-activity-v2-http'

export const dynamic = 'force-dynamic'
type Context = { params: Promise<{ activityId: string; winnerId: string }> }

export async function GET(request: Request, context: Context) {
  const guard = await requireRequestAdmin(request, 'activity_manage')
  if (!guard.user) return guard.response
  let canShip: boolean
  try {
    canShip = await hasAdminPermission(guard.user, 'activity_lottery_shipping')
  } catch (error) {
    return topicLotteryErrorResponse(error)
  }
  if (!canShip) return topicV2Json({ code: 'FORBIDDEN', message: '当前管理员未获得此权限' }, 403)
  const { activityId, winnerId } = await context.params
  if (!topicV2IdPattern.test(activityId) || !topicV2IdPattern.test(winnerId)) {
    return topicV2Json({ message: '中奖记录不存在' }, 404)
  }
  try {
    return topicV2Json(await getAdminTopicLotteryAddress(activityId, winnerId, guard.user.id))
  } catch (error) {
    return topicLotteryErrorResponse(error)
  }
}
