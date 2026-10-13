import { hasAdminPermission } from '@/lib/admin-permissions'
import { requireRequestAdmin, rejectInvalidRequestOrigin, enforceApiRateLimit } from '@/lib/security'
import { updateTopicLotteryShipment } from '@/lib/topic-activity-v2-lottery-fulfillment'
import { topicLotteryErrorResponse } from '@/lib/topic-activity-v2-lottery-http'
import { readTopicV2Body, topicV2IdPattern, topicV2Json } from '@/lib/topic-activity-v2-http'

export const dynamic = 'force-dynamic'
type Context = { params: Promise<{ activityId: string; winnerId: string }> }
const actions = new Set(['SHIP', 'DELIVER', 'EXCEPTION', 'DELETE_PII'])

function hasOnlyKeys(value: Record<string, unknown>, allowed: readonly string[]) {
  const keys = new Set(allowed)
  return Object.keys(value).every((key) => keys.has(key))
}

export async function POST(request: Request, context: Context) {
  const origin = rejectInvalidRequestOrigin(request)
  if (origin) return origin
  const guard = await requireRequestAdmin(request, 'activity_manage')
  if (!guard.user) return guard.response
  let canShip: boolean
  try {
    canShip = await hasAdminPermission(guard.user, 'activity_lottery_shipping')
  } catch (error) {
    return topicLotteryErrorResponse(error)
  }
  if (!canShip) return topicV2Json({ code: 'FORBIDDEN', message: '当前管理员未获得此权限' }, 403)
  const limited = await enforceApiRateLimit(
    request,
    guard.user.id,
    { endpoint: '/api/admin/activities/v2/lottery/shipment', ip: { limit: 60, windowSeconds: 3600 }, user: { limit: 30, windowSeconds: 3600 } },
    '物流状态更新过于频繁，请稍后重试',
  )
  if (limited) return limited
  const { activityId, winnerId } = await context.params
  const body = await readTopicV2Body(request)
  const carrier = body?.carrier
  const trackingNumber = body?.trackingNumber
  const carrierValue = typeof carrier === 'string' ? carrier : undefined
  const trackingNumberValue = typeof trackingNumber === 'string' ? trackingNumber : undefined
  if (!topicV2IdPattern.test(activityId) || !topicV2IdPattern.test(winnerId) || !body
    || !hasOnlyKeys(body, ['action', 'carrier', 'trackingNumber']) || typeof body.action !== 'string' || !actions.has(body.action)
    || (carrier !== undefined && (carrierValue === undefined || carrierValue.length > 200))
    || (trackingNumber !== undefined && (trackingNumberValue === undefined || trackingNumberValue.length > 200))) {
    return topicV2Json({ code: 'INVALID_SHIPMENT', message: '物流操作格式无效' }, 400)
  }
  try {
    return topicV2Json(await updateTopicLotteryShipment({
      activityId,
      winnerId,
      actorId: guard.user.id,
      action: body.action as 'SHIP' | 'DELIVER' | 'EXCEPTION' | 'DELETE_PII',
      ...(carrierValue === undefined ? {} : { carrier: carrierValue }),
      ...(trackingNumberValue === undefined ? {} : { trackingNumber: trackingNumberValue }),
    }))
  } catch (error) {
    return topicLotteryErrorResponse(error)
  }
}
