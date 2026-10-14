import { resolveRequestAuth } from '@/lib/security'
import { hasAdminPermission } from '@/lib/admin-permissions'
import { getTopicActivityV2View } from '@/lib/topic-activity-v2'
import { topicV2ErrorResponse, topicV2IdPattern, topicV2Json } from '@/lib/topic-activity-v2-http'

export const dynamic = 'force-dynamic'
export async function GET(request: Request, context: { params: Promise<{ activityId: string }> }) {
  const auth = await resolveRequestAuth(request)
  if (auth.response) return auth.response
  const { activityId } = await context.params
  if (!topicV2IdPattern.test(activityId)) return topicV2Json({ message: '活动不存在' }, 404)
  const admin = auth.user ? await hasAdminPermission(auth.user, 'activity_manage') : false
  try { return topicV2Json(await getTopicActivityV2View(activityId, auth.user?.id, admin)) }
  catch (error) { return topicV2ErrorResponse(error) }
}
