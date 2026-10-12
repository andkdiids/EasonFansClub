import { requireRequestUser } from '@/lib/security'
import { getTopicV2Attempts } from '@/lib/topic-activity-v2-interactive'
import { topicV2ErrorResponse, topicV2Json } from '@/lib/topic-activity-v2-http'

export const dynamic = 'force-dynamic'
export async function GET(request: Request, context: { params: Promise<{ activityId: string }> }) {
  const guard = await requireRequestUser(request)
  if (!guard.user) return guard.response
  try { return topicV2Json({ attempts: await getTopicV2Attempts((await context.params).activityId, guard.user.id) }) }
  catch (error) { return topicV2ErrorResponse(error) }
}
