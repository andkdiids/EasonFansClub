import { requireRequestUser, rejectInvalidRequestOrigin, enforceApiRateLimit } from '@/lib/security'
import { getTopicLotteryAddress, saveTopicLotteryAddress } from '@/lib/topic-activity-v2-lottery-fulfillment'
import { topicLotteryErrorResponse } from '@/lib/topic-activity-v2-lottery-http'
import { readTopicV2Body, topicV2IdPattern, topicV2Json } from '@/lib/topic-activity-v2-http'

export const dynamic = 'force-dynamic'

type Context = { params: Promise<{ activityId: string; winnerId: string }> }

function hasOnlyKeys(value: Record<string, unknown>, allowed: readonly string[]) {
  const keys = new Set(allowed)
  return Object.keys(value).every((key) => keys.has(key))
}

function isAddressValue(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

export async function GET(request: Request, context: Context) {
  const guard = await requireRequestUser(request)
  if (!guard.user) return guard.response
  const { activityId, winnerId } = await context.params
  if (!topicV2IdPattern.test(activityId) || !topicV2IdPattern.test(winnerId)) {
    return topicV2Json({ message: '中奖记录不存在' }, 404)
  }
  try {
    return topicV2Json(await getTopicLotteryAddress(activityId, winnerId, guard.user.id))
  } catch (error) {
    return topicLotteryErrorResponse(error)
  }
}

export async function PUT(request: Request, context: Context) {
  const origin = rejectInvalidRequestOrigin(request)
  if (origin) return origin
  const guard = await requireRequestUser(request)
  if (!guard.user) return guard.response
  const limited = await enforceApiRateLimit(
    request,
    guard.user.id,
    { endpoint: '/api/activities/v2/lottery/address', ip: { limit: 60, windowSeconds: 3600 }, user: { limit: 20, windowSeconds: 3600 } },
    '收件地址提交过于频繁，请稍后重试',
  )
  if (limited) return limited
  const { activityId, winnerId } = await context.params
  const body = await readTopicV2Body(request)
  if (!topicV2IdPattern.test(activityId) || !topicV2IdPattern.test(winnerId)
    || !body || !hasOnlyKeys(body, ['address', 'consent'])
    || !isAddressValue(body.address) || body.consent !== true) {
    return topicV2Json({ code: 'INVALID_ADDRESS', message: '收件地址格式无效，且必须明确同意保存' }, 400)
  }
  try {
    return topicV2Json(await saveTopicLotteryAddress({ activityId, winnerId, userId: guard.user.id, address: body.address, consent: true }))
  } catch (error) {
    return topicLotteryErrorResponse(error)
  }
}
