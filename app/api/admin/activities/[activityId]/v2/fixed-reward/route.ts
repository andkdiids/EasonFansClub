import { requireRequestAdmin, rejectInvalidRequestOrigin } from '@/lib/security'
import { prisma } from '@/lib/prisma'
import { claimTopicActivityV2FixedReward } from '@/lib/topic-activity-v2'
import { readTopicV2Body, topicV2ErrorResponse, topicV2IdPattern, topicV2Json } from '@/lib/topic-activity-v2-http'

export const dynamic = 'force-dynamic'
type Context = { params: Promise<{ activityId: string }> }
export async function GET(request: Request, context: Context) {
  const guard = await requireRequestAdmin(request, 'activity_manage')
  if (!guard.user) return guard.response
  const { activityId } = await context.params
  if (!topicV2IdPattern.test(activityId)) return topicV2Json({ message: '活动不存在' }, 404)
  return topicV2Json({ claims: await prisma.topicActivityRewardGrant.findMany({ where: { activityId, origin: 'FIXED' }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 100,
    select: { id: true, userId: true, points: true, status: true, createdAt: true, rewardSnapshot: true, errorMessage: true, User: { select: { nickname: true, uid: true } } } }) })
}
export async function POST(request: Request, context: Context) {
  const origin = rejectInvalidRequestOrigin(request)
  if (origin) return origin
  const guard = await requireRequestAdmin(request, 'activity_manage')
  if (!guard.user) return guard.response
  const { activityId } = await context.params
  const body = await readTopicV2Body(request)
  if (!topicV2IdPattern.test(activityId) || !body || typeof body.userId !== 'string' || !topicV2IdPattern.test(body.userId) || (body.status !== 'APPROVED' && body.status !== 'REJECTED')) return topicV2Json({ message: '审核参数无效' }, 400)
  try { return topicV2Json(await claimTopicActivityV2FixedReward({ activityId, userId: body.userId, reviewerId: guard.user.id, decision: body.status })) }
  catch (error) { return topicV2ErrorResponse(error) }
}
