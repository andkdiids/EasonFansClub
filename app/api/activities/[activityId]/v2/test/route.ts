import { requireRequestUser, rejectInvalidRequestOrigin, enforceApiRateLimit } from '@/lib/security'
import { getTopicV2Test, submitTopicV2Test } from '@/lib/topic-activity-v2-interactive'
import { readTopicV2Body, topicV2ErrorResponse, topicV2Json } from '@/lib/topic-activity-v2-http'

export const dynamic = 'force-dynamic'
type Context = { params: Promise<{ activityId: string }> }
export async function GET(_request: Request, context: Context) {
  try { return topicV2Json(await getTopicV2Test((await context.params).activityId)) }
  catch (error) { return topicV2ErrorResponse(error) }
}
export async function POST(request: Request, context: Context) {
  const origin = rejectInvalidRequestOrigin(request)
  if (origin) return origin
  const guard = await requireRequestUser(request)
  if (!guard.user) return guard.response
  const limited = await enforceApiRateLimit(request, guard.user.id, { endpoint: '/api/activities/v2/test', ip: { limit: 100, windowSeconds: 3600 }, user: { limit: 20, windowSeconds: 3600 } }, '测试提交过于频繁')
  if (limited) return limited
  const body = await readTopicV2Body(request)
  if (!body || typeof body.requestKey !== 'string') return topicV2Json({ code: 'TEST_REQUEST_KEY_INVALID', message: '测试提交编号无效' }, 400)
  try { return topicV2Json(await submitTopicV2Test({ activityId: (await context.params).activityId, userId: guard.user.id, answers: body.answers, requestKey: body.requestKey })) }
  catch (error) { return topicV2ErrorResponse(error) }
}
