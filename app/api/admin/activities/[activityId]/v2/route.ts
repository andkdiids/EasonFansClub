import { requireRequestAdmin, rejectInvalidRequestOrigin } from '@/lib/security'
import { getTopicActivityV2View, getTopicActivityV2Statistics, saveTopicActivityV2Program } from '@/lib/topic-activity-v2'
import { readTopicV2Body, topicV2ErrorResponse, topicV2IdPattern, topicV2Json } from '@/lib/topic-activity-v2-http'

export const dynamic = 'force-dynamic'
type Context = { params: Promise<{ activityId: string }> }

export async function GET(request: Request, context: Context) {
  const guard = await requireRequestAdmin(request, 'activity_manage')
  if (!guard.user) return guard.response
  const { activityId } = await context.params
  if (!topicV2IdPattern.test(activityId)) return topicV2Json({ message: '活动不存在' }, 404)
  try {
    return topicV2Json({ ...await getTopicActivityV2View(activityId, guard.user.id, true), statistics: await getTopicActivityV2Statistics(activityId) })
  } catch (error) { return topicV2ErrorResponse(error) }
}

export async function PATCH(request: Request, context: Context) {
  const origin = rejectInvalidRequestOrigin(request)
  if (origin) return origin
  const guard = await requireRequestAdmin(request, 'activity_manage')
  if (!guard.user) return guard.response
  const { activityId } = await context.params
  if (!topicV2IdPattern.test(activityId)) return topicV2Json({ message: '活动不存在' }, 404)
  const body = await readTopicV2Body(request)
  if (!body) return topicV2Json({ code: 'INVALID_BODY', message: '活动配置格式无效' }, 400)
  try { return topicV2Json({ program: await saveTopicActivityV2Program(activityId, guard.user.id, body.program ?? body) }) }
  catch (error) { return topicV2ErrorResponse(error) }
}
