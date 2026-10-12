import { requireRequestUser } from '@/lib/security'
import { getTopicV2Attempt } from '@/lib/topic-activity-v2-interactive'
import { topicV2ErrorResponse, topicV2Json } from '@/lib/topic-activity-v2-http'

export const dynamic = 'force-dynamic'
export async function GET(request: Request, context: { params: Promise<{ activityId: string; attemptId: string }> }) {
  const guard = await requireRequestUser(request)
  if (!guard.user) return guard.response
  const { activityId, attemptId } = await context.params
  try { return topicV2Json({ attempt: await getTopicV2Attempt(activityId, attemptId, guard.user.id) }) }
  catch (error) { return topicV2ErrorResponse(error) }
}
