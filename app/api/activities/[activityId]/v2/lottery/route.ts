import { resolveRequestAuth } from '@/lib/security'
import { getTopicLotteryView } from '@/lib/topic-activity-v2-lottery'
import { topicLotteryErrorResponse } from '@/lib/topic-activity-v2-lottery-http'
import { topicV2IdPattern, topicV2Json } from '@/lib/topic-activity-v2-http'

export const dynamic = 'force-dynamic'

const publicViewFields = ['enabled', 'config', 'state', 'candidateCount', 'myStatus', 'myEligibility', 'myWinner', 'winners'] as const
const publicWinnerFields = ['nickname', 'uid', 'prizeName'] as const
const publicWinnerSummaryFields = ['id', 'prize', 'wonAt', 'addressDeadline', 'shippingStatus', 'addressSaved', 'claimUrl'] as const
const publicPrizeFields = ['name', 'imageUrl', 'description'] as const
const configFields = ['version', 'enabled', 'title', 'description', 'mode', 'drawAt', 'eligibilityDeadline', 'addressDeadline', 'publishWinners', 'retentionDays', 'sourceEntryIds', 'prizes'] as const
const configPrizeFields = ['id', 'name', 'description', 'imageUrl', 'quantity', 'sortOrder'] as const

function pickRecord(value: unknown, fields: readonly string[]) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value
  const input = value as Record<string, unknown>
  return Object.fromEntries(fields.filter((field) => Object.prototype.hasOwnProperty.call(input, field)).map((field) => [field, input[field]]))
}

function publicConfig(value: unknown) {
  const config = pickRecord(value, configFields)
  if (!config || typeof config !== 'object' || Array.isArray(config)) return config
  const input = config as Record<string, unknown>
  return { ...input, ...(Array.isArray(input.prizes) ? { prizes: input.prizes.map((prize) => pickRecord(prize, configPrizeFields)) } : {}) }
}

function publicView(value: unknown) {
  const view = pickRecord(value, publicViewFields)
  if (!view || typeof view !== 'object' || Array.isArray(view)) return view
  const input = view as Record<string, unknown>
  const myWinner = pickRecord(input.myWinner, publicWinnerSummaryFields)
  const safeWinner = myWinner && typeof myWinner === 'object' && !Array.isArray(myWinner)
    ? { ...(myWinner as Record<string, unknown>), ...('prize' in (myWinner as Record<string, unknown>) ? { prize: pickRecord((myWinner as Record<string, unknown>).prize, publicPrizeFields) } : {}) }
    : myWinner
  return {
    ...input,
    ...(Object.prototype.hasOwnProperty.call(input, 'config') ? { config: publicConfig(input.config) } : {}),
    ...(Object.prototype.hasOwnProperty.call(input, 'myEligibility') ? { myEligibility: pickRecord(input.myEligibility, ['count']) } : {}),
    ...(Object.prototype.hasOwnProperty.call(input, 'myWinner') ? { myWinner: safeWinner } : {}),
    ...(Array.isArray(input.winners) ? { winners: input.winners.map((winner) => pickRecord(winner, publicWinnerFields)) } : {}),
  }
}

export async function GET(request: Request, context: { params: Promise<{ activityId: string }> }) {
  const auth = await resolveRequestAuth(request)
  if (auth.response) return auth.response
  const { activityId } = await context.params
  if (!topicV2IdPattern.test(activityId)) return topicV2Json({ message: '活动不存在' }, 404)
  try {
    const view = await getTopicLotteryView(activityId, auth.user?.id)
    return topicV2Json(publicView(view))
  } catch (error) {
    return topicLotteryErrorResponse(error)
  }
}
