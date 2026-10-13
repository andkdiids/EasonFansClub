import { hasAdminPermission } from '@/lib/admin-permissions'
import { requireRequestAdmin, rejectInvalidRequestOrigin, enforceApiRateLimit } from '@/lib/security'
import { getAdminTopicLotteryView, saveTopicLotteryConfig } from '@/lib/topic-activity-v2-lottery'
import { topicLotteryErrorResponse } from '@/lib/topic-activity-v2-lottery-http'
import { readTopicV2Body, topicV2IdPattern, topicV2Json } from '@/lib/topic-activity-v2-http'

export const dynamic = 'force-dynamic'
type Context = { params: Promise<{ activityId: string }> }

const adminViewFields = ['config', 'configLocked', 'addressEncryptionReady', 'state', 'candidateCount', 'pendingSubmissionCount', 'draw', 'winners'] as const
const adminWinnerFields = ['id', 'nickname', 'uid', 'prizeName', 'wonAt', 'addressDeadline', 'addressSaved', 'shippingStatus', 'shippedAt'] as const
const adminDrawFields = ['id', 'state', 'frozenAt', 'drawnAt', 'candidateCount', 'winnerCount', 'errorCode', 'failedReason'] as const
const configFields = ['version', 'enabled', 'title', 'description', 'mode', 'drawAt', 'eligibilityDeadline', 'addressDeadline', 'publishWinners', 'retentionDays', 'sourceEntryIds', 'prizes'] as const
const configPrizeFields = ['id', 'name', 'description', 'imageUrl', 'quantity', 'sortOrder'] as const

function pickRecord(value: unknown, fields: readonly string[]) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value
  const input = value as Record<string, unknown>
  return Object.fromEntries(fields.filter((field) => Object.prototype.hasOwnProperty.call(input, field)).map((field) => [field, input[field]]))
}

function adminConfig(value: unknown) {
  const config = pickRecord(value, configFields)
  if (!config || typeof config !== 'object' || Array.isArray(config)) return config
  const input = config as Record<string, unknown>
  return { ...input, ...(Array.isArray(input.prizes) ? { prizes: input.prizes.map((prize) => pickRecord(prize, configPrizeFields)) } : {}) }
}

function adminView(value: unknown) {
  const view = pickRecord(value, adminViewFields)
  if (!view || typeof view !== 'object' || Array.isArray(view)) return view
  const input = view as Record<string, unknown>
  return {
    ...input,
    ...(Object.prototype.hasOwnProperty.call(input, 'config') ? { config: adminConfig(input.config) } : {}),
    ...(Object.prototype.hasOwnProperty.call(input, 'draw') ? { draw: pickRecord(input.draw, adminDrawFields) } : {}),
    ...(Array.isArray(input.winners) ? { winners: input.winners.map((winner) => pickRecord(winner, adminWinnerFields)) } : {}),
  }
}

function hasOnlyKeys(value: Record<string, unknown>, allowed: readonly string[]) {
  const keys = new Set(allowed)
  return Object.keys(value).every((key) => keys.has(key))
}

export async function GET(request: Request, context: Context) {
  const guard = await requireRequestAdmin(request, 'activity_manage')
  if (!guard.user) return guard.response
  const { activityId } = await context.params
  if (!topicV2IdPattern.test(activityId)) return topicV2Json({ message: '活动不存在' }, 404)
  try {
    const canShip = await hasAdminPermission(guard.user, 'activity_lottery_shipping')
    const view = await getAdminTopicLotteryView(activityId)
    return topicV2Json({ ...(adminView(view) as Record<string, unknown>), canShip })
  } catch (error) {
    return topicLotteryErrorResponse(error)
  }
}

export async function PATCH(request: Request, context: Context) {
  const origin = rejectInvalidRequestOrigin(request)
  if (origin) return origin
  const guard = await requireRequestAdmin(request, 'activity_manage')
  if (!guard.user) return guard.response
  const limited = await enforceApiRateLimit(
    request,
    guard.user.id,
    { endpoint: '/api/admin/activities/v2/lottery/config', ip: { limit: 60, windowSeconds: 3600 }, user: { limit: 30, windowSeconds: 3600 } },
    '抽奖配置保存过于频繁，请稍后重试',
  )
  if (limited) return limited
  const { activityId } = await context.params
  const body = await readTopicV2Body(request)
  if (!topicV2IdPattern.test(activityId) || !body || !hasOnlyKeys(body, ['config']) || !Object.prototype.hasOwnProperty.call(body, 'config')) {
    return topicV2Json({ code: 'INVALID_LOTTERY_CONFIG', message: '抽奖配置格式无效' }, 400)
  }
  try {
    return topicV2Json({ config: await saveTopicLotteryConfig(activityId, guard.user.id, body.config) })
  } catch (error) {
    return topicLotteryErrorResponse(error)
  }
}
