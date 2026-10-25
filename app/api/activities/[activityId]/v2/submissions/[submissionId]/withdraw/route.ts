import { requireRequestUser, rejectInvalidRequestOrigin, enforceApiRateLimit } from '@/lib/security'
import { withdrawTopicActivityV2Submission } from '@/lib/topic-activity-v2'
import { topicV2ErrorResponse, topicV2IdPattern, topicV2Json } from '@/lib/topic-activity-v2-http'

export const dynamic = 'force-dynamic'
type Context = { params: Promise<{ activityId: string; submissionId: string }> }

export async function POST(request: Request, context: Context) {
  const origin = rejectInvalidRequestOrigin(request)
  if (origin) return origin
  const guard = await requireRequestUser(request)
  if (!guard.user) return guard.response
  const limited = await enforceApiRateLimit(request, guard.user.id, {
    endpoint: '/api/activities/v2/submissions/withdraw',
    ip: { limit: 60, windowSeconds: 3600 }, user: { limit: 20, windowSeconds: 3600 },
  }, '操作过于频繁，请稍后重试')
  if (limited) return limited

  const { activityId, submissionId } = await context.params
  if (![activityId, submissionId].every((id) => topicV2IdPattern.test(id))) return topicV2Json({ code: 'TOPIC_V2_SUBMISSION_NOT_FOUND', message: '提交记录不存在' }, 404)
  try {
    const result = await withdrawTopicActivityV2Submission({ activityId, submissionId, userId: guard.user.id })
    return topicV2Json(result)
  } catch (error) {
    return topicV2ErrorResponse(error)
  }
}
