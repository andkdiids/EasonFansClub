import { requireRequestAdmin, rejectInvalidRequestOrigin } from '@/lib/security'
import { prisma } from '@/lib/prisma'
import { createManyNotifications } from '@/lib/notification-write'
import { safeNotificationWrite } from '@/lib/notification-transaction'
import { reviewTopicActivityV2Submission } from '@/lib/topic-activity-v2'
import { readTopicV2Body, topicV2ErrorResponse, topicV2IdPattern, topicV2Json } from '@/lib/topic-activity-v2-http'

export const dynamic = 'force-dynamic'
type Context = { params: Promise<{ activityId: string; submissionId: string }> }
export async function GET(request: Request, context: Context) {
  const guard = await requireRequestAdmin(request, 'activity_manage')
  if (!guard.user) return guard.response
  const { activityId, submissionId } = await context.params
  if (![activityId, submissionId].every((id) => topicV2IdPattern.test(id))) return topicV2Json({ message: '提交记录不存在' }, 404)
  const submission = await prisma.topicActivitySubmission.findFirst({ where: { id: submissionId, activityId },
    select: { id: true, status: true, rewardSnapshot: true, ReviewLog: { orderBy: [{ reviewedAt: 'desc' }, { id: 'desc' }], take: 100,
      select: { id: true, fromStatus: true, toStatus: true, reason: true, reviewedAt: true, ReviewedBy: { select: { nickname: true, uid: true } } } } } })
  return submission ? topicV2Json({ submission, history: submission.ReviewLog }) : topicV2Json({ message: '提交记录不存在' }, 404)
}
export async function PATCH(request: Request, context: Context) {
  const origin = rejectInvalidRequestOrigin(request)
  if (origin) return origin
  const guard = await requireRequestAdmin(request, 'activity_manage')
  if (!guard.user) return guard.response
  const { activityId, submissionId } = await context.params
  const body = await readTopicV2Body(request)
  if (![activityId, submissionId].every((id) => topicV2IdPattern.test(id)) || !body || (body.status !== 'APPROVED' && body.status !== 'REJECTED')
    || (body.rejectReason !== undefined && body.rejectReason !== null && typeof body.rejectReason !== 'string')) return topicV2Json({ message: '请选择通过或拒绝' }, 400)
  try {
    const result = await reviewTopicActivityV2Submission({ activityId, submissionId, reviewerId: guard.user.id, status: body.status,
      rejectReason: typeof body.rejectReason === 'string' ? body.rejectReason.trim().slice(0, 2000) : null })
    if (result.changed) await safeNotificationWrite(() => createManyNotifications({ data: [{
      recipientId: result.submission.userId, actorId: null, type: 'SYSTEM',
      title: body.status === 'APPROVED' ? '活动任务审核通过' : '活动任务未通过审核',
      content: body.status === 'APPROVED' ? '任务已通过，奖励请在活动中查看。' : result.submission.rejectReason || '请查看任务要求后重新提交。',
      link: `/activities/${activityId}?focus=${result.submission.commentId || ''}`,
      key: `topic-v2-review:${submissionId}:${body.status}:${result.submission.reviewedAt?.getTime() || 0}`,
    }], skipDuplicates: true }), { operation: 'topic-v2-review-notification', userId: result.submission.userId, notificationType: 'SYSTEM' })
    return topicV2Json(result)
  }
  catch (error) { return topicV2ErrorResponse(error) }
}
