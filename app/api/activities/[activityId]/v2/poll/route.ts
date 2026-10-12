import { requireRequestUser, rejectInvalidRequestOrigin, resolveRequestAuth, enforceApiRateLimit } from '@/lib/security'
import { castTopicV2Vote, getTopicV2Poll } from '@/lib/topic-activity-v2-interactive'
import { readTopicV2Body, topicV2ErrorResponse, topicV2Json } from '@/lib/topic-activity-v2-http'

export const dynamic = 'force-dynamic'
type Context = { params: Promise<{ activityId: string }> }
export async function GET(request: Request, context: Context) {
  const auth = await resolveRequestAuth(request)
  if (auth.response) return auth.response
  try { return topicV2Json(await getTopicV2Poll((await context.params).activityId, auth.user?.id)) }
  catch (error) { return topicV2ErrorResponse(error) }
}
export async function POST(request: Request, context: Context) {
  const origin = rejectInvalidRequestOrigin(request)
  if (origin) return origin
  const guard = await requireRequestUser(request)
  if (!guard.user) return guard.response
  const limited = await enforceApiRateLimit(request, guard.user.id, { endpoint: '/api/activities/v2/poll', ip: { limit: 100, windowSeconds: 3600 }, user: { limit: 30, windowSeconds: 3600 } }, '投票操作过于频繁')
  if (limited) return limited
  const body = await readTopicV2Body(request)
  try { return topicV2Json(await castTopicV2Vote({ activityId: (await context.params).activityId, userId: guard.user.id, choices: body?.choices })) }
  catch (error) { return topicV2ErrorResponse(error) }
}
