import { requireRequestUser, rejectInvalidRequestOrigin } from '@/lib/security'
import { claimTopicActivityV2FixedReward } from '@/lib/topic-activity-v2'
import { topicV2ErrorResponse, topicV2IdPattern, topicV2Json } from '@/lib/topic-activity-v2-http'

export const dynamic = 'force-dynamic'
export async function POST(request: Request, context: { params: Promise<{ activityId: string }> }) {
  const origin = rejectInvalidRequestOrigin(request)
  if (origin) return origin
  const guard = await requireRequestUser(request)
  if (!guard.user) return guard.response
  const { activityId } = await context.params
  if (!topicV2IdPattern.test(activityId)) return topicV2Json({ message: '活动不存在' }, 404)
  try { return topicV2Json(await claimTopicActivityV2FixedReward({ activityId, userId: guard.user.id })) }
  catch (error) { return topicV2ErrorResponse(error) }
}
