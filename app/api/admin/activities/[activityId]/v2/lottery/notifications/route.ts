import { requireRequestAdmin, rejectInvalidRequestOrigin, enforceApiRateLimit } from '@/lib/security'
import { deliverTopicLotteryNotices } from '@/lib/topic-activity-v2-lottery-fulfillment'
import { topicLotteryErrorResponse } from '@/lib/topic-activity-v2-lottery-http'
import { readTopicV2Body, topicV2IdPattern, topicV2Json } from '@/lib/topic-activity-v2-http'

export const dynamic = 'force-dynamic'
type Context = { params: Promise<{ activityId: string }> }

function hasOnlyKeys(value: Record<string, unknown>, allowed: readonly string[]) {
  const keys = new Set(allowed)
  return Object.keys(value).every((key) => keys.has(key))
}

export async function POST(request: Request, context: Context) {
  const origin = rejectInvalidRequestOrigin(request)
  if (origin) return origin
  const guard = await requireRequestAdmin(request, 'activity_manage')
  if (!guard.user) return guard.response
  const limited = await enforceApiRateLimit(
    request,
    guard.user.id,
    { endpoint: '/api/admin/activities/v2/lottery/notifications', ip: { limit: 30, windowSeconds: 3600 }, user: { limit: 15, windowSeconds: 3600 } },
    '通知重试过于频繁，请稍后重试',
  )
  if (limited) return limited
  const { activityId } = await context.params
  const body = await readTopicV2Body(request)
  const batchSize = body?.batchSize
  const batchSizeValue = typeof batchSize === 'number' ? batchSize : undefined
  if (!topicV2IdPattern.test(activityId) || !body || !hasOnlyKeys(body, ['retry', 'batchSize']) || body.retry !== true
    || (batchSize !== undefined && (batchSizeValue === undefined || !Number.isInteger(batchSizeValue) || batchSizeValue < 1 || batchSizeValue > 100))) {
    return topicV2Json({ code: 'INVALID_NOTIFICATION_RETRY', message: '通知重试必须明确指定 retry' }, 400)
  }
  try {
    return topicV2Json(await deliverTopicLotteryNotices({ activityId, ...(batchSizeValue === undefined ? {} : { batchSize: batchSizeValue }) }))
  } catch (error) {
    return topicLotteryErrorResponse(error)
  }
}
