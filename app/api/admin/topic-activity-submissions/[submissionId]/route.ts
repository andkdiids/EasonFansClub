import { NextResponse } from 'next/server'
import { rejectInvalidRequestOrigin, requireRequestAdmin } from '@/lib/security'
import { createManyNotifications } from '@/lib/notification-write'
import { safeNotificationWrite } from '@/lib/notification-transaction'
import { triggerBadgeEvaluation } from '@/lib/badge-rule-engine'
import { reviewTopicActivitySubmission } from '@/lib/topic-activity'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

const idPattern = /^[A-Za-z0-9_-]{8,128}$/

export async function PATCH(request: Request, context: { params: Promise<{ submissionId: string }> }) {
  const invalidOrigin = rejectInvalidRequestOrigin(request)
  if (invalidOrigin) return invalidOrigin
  const guard = await requireRequestAdmin(request, 'activity_manage')
  if (!guard.user) return guard.response
  const { submissionId } = await context.params
  if (!idPattern.test(submissionId)) return NextResponse.json({ message: '参与评论不存在' }, { status: 404 })
  const body = await request.json().catch(() => null) as { status?: unknown; rejectReason?: unknown } | null
  if (body?.status !== 'APPROVED' && body?.status !== 'REJECTED') return NextResponse.json({ message: '请选择通过或拒绝' }, { status: 400 })
  const rejectReason = typeof body.rejectReason === 'string' ? body.rejectReason.trim().slice(0, 2_000) : null
  try {
    const result = await reviewTopicActivitySubmission({ submissionId, reviewerId: guard.user.id, status: body.status, rejectReason })
    if (result.changed) {
      const activity = await prisma.activity.findUnique({ where: { id: result.submission.activityId }, select: { title: true, activityPostId: true } })
      const approved = body.status === 'APPROVED'
      await safeNotificationWrite(() => createManyNotifications({
        data: [{
          recipientId: result.submission.userId,
          actorId: guard.user.id,
          type: 'ACTIVITY',
          title: approved ? '话题活动评论已通过' : '话题活动评论未通过',
          content: approved ? `你在「${activity?.title || '话题活动'}」中的一条参与评论已通过审核` : `你在「${activity?.title || '话题活动'}」中的一条参与评论未通过审核${rejectReason ? `：${rejectReason}` : ''}`,
          link: activity?.activityPostId ? `/posts/${activity.activityPostId}?focus=${result.submission.commentId || ''}` : '/activities',
          key: `topic-activity-review:${result.submission.id}:${body.status}`,
        }],
        skipDuplicates: true,
      }), { operation: 'topic-activity-review-notification', userId: result.submission.userId, notificationType: 'ACTIVITY' })
      if (approved && result.firstParticipationCreated) {
        await triggerBadgeEvaluation(result.submission.userId, 'TOPIC_ACTIVITY_PARTICIPATION_CREATED', result.submission.activityId)
          .catch((error) => console.error('[topic-activity.badge-evaluation.failed]', { activityId: result.submission.activityId, userId: result.submission.userId, error }))
      }
    }
    return NextResponse.json({
      submission: { id: result.submission.id, activityId: result.submission.activityId, userId: result.submission.userId, commentId: result.submission.commentId, status: result.submission.status, rejectReason: result.submission.rejectReason, reviewedAt: result.submission.reviewedAt?.toISOString() || null },
      participation: result.participation ? { approvedSubmissionCount: result.participation.approvedSubmissionCount, countedInActivity: result.participation.approvedSubmissionCount > 0, rewardStatus: result.participation.rewardStatus, rewardEligibleAt: result.participation.rewardEligibleAt?.toISOString() || null, rewardGrantedAt: result.participation.rewardGrantedAt?.toISOString() || null } : null,
      alreadyCounted: Boolean(result.participation && result.participation.approvedSubmissionCount > 0),
      changed: result.changed,
    }, { headers: { 'Cache-Control': 'private, no-store, max-age=0', Vary: 'Cookie, Authorization' } })
  } catch (error) {
    const code = error instanceof Error ? error.message : 'TOPIC_REVIEW_FAILED'
    const status = code === 'TOPIC_SUBMISSION_NOT_FOUND' ? 404 : code === 'TOPIC_SUBMISSION_COMMENT_UNAVAILABLE' || code === 'TOPIC_SUBMISSION_WITHDRAWN' ? 409 : code === 'TOPIC_SUBMISSION_RELATION_INVALID' ? 403 : 500
    if (status === 500) console.error('[topic-activity.review.failed]', { submissionId, reviewerId: guard.user.id, code })
    return NextResponse.json({ code, message: status === 500 ? '审核操作失败，请稍后重试' : code === 'TOPIC_SUBMISSION_COMMENT_UNAVAILABLE' ? '原评论已删除，不能通过审核' : '参与评论不可用' }, { status })
  }
}
