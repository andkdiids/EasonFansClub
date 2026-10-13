import { requireRequestAdmin, rejectInvalidRequestOrigin, enforceApiRateLimit } from '@/lib/security'
import { drawTopicLottery } from '@/lib/topic-activity-v2-lottery'
import { topicLotteryErrorResponse } from '@/lib/topic-activity-v2-lottery-http'
import { readTopicV2Body, topicV2IdPattern, topicV2Json } from '@/lib/topic-activity-v2-http'

export const dynamic = 'force-dynamic'
type Context = { params: Promise<{ activityId: string }> }

export async function POST(request: Request, context: Context) {
  const origin = rejectInvalidRequestOrigin(request)
  if (origin) return origin
  const guard = await requireRequestAdmin(request, 'activity_manage')
  if (!guard.user) return guard.response
  const limited = await enforceApiRateLimit(
    request,
    guard.user.id,
    { endpoint: '/api/admin/activities/v2/lottery/draw', ip: { limit: 20, windowSeconds: 3600 }, user: { limit: 10, windowSeconds: 3600 } },
    '开奖操作过于频繁，请稍后重试',
  )
  if (limited) return limited
  const { activityId } = await context.params
  const body = await readTopicV2Body(request)
  if (!topicV2IdPattern.test(activityId) || !body || Object.keys(body).length !== 0) {
    return topicV2Json({ code: 'INVALID_DRAW_REQUEST', message: '开奖请求必须为空对象' }, 400)
  }
  try {
    return topicV2Json(await drawTopicLottery({ activityId, actorId: guard.user.id, trigger: 'MANUAL' }))
  } catch (error) {
    return topicLotteryErrorResponse(error)
  }
}
