import { NextResponse } from 'next/server'
import { rejectInvalidRequestOrigin, requireRequestAdmin } from '@/lib/security'
import { createManyNotifications } from '@/lib/notification-write'
import { safeNotificationWrite } from '@/lib/notification-transaction'
import { triggerBadgeEvaluation } from '@/lib/badge-rule-engine'
import { reviewTopicActivityFormSubmission } from '@/lib/topic-activity'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

export async function PATCH(request: Request, context: { params: Promise<{ submissionId: string }> }) {
  const invalidOrigin = rejectInvalidRequestOrigin(request)
  if (invalidOrigin) return invalidOrigin
  const guard = await requireRequestAdmin(request, 'activity_manage')
  if (!guard.user) return guard.response
  const { submissionId } = await context.params
  const body = await request.json().catch(() => null) as { status?: unknown; rejectReason?: unknown } | null
  if (body?.status !== 'APPROVED' && body?.status !== 'REJECTED') return NextResponse.json({ message: '请选择通过或拒绝' }, { status: 400 })
  const rejectReason = typeof body.rejectReason === 'string' ? body.rejectReason.trim().slice(0, 2_000) : null
  try {
    const result = await reviewTopicActivityFormSubmission({ submissionId, reviewerId: guard.user.id, status: body.status, rejectReason })
    if (result.changed) {
      const activity = await prisma.activity.findUnique({ where: { id: result.submission.activityId }, select: { title: true } })
      const approved = body.status === 'APPROVED'
      await safeNotificationWrite(() => createManyNotifications({
        data: [{
          recipientId: result.submission.userId,
          actorId: null,
          type: 'ACTIVITY',
          title: approved ? '话题活动表单已通过' : '话题活动表单未通过',
          content: approved ? `你提交的「${activity?.title || '话题活动'}」参与表单已通过审核` : `你提交的「${activity?.title || '话题活动'}」参与表单未通过审核${rejectReason ? `：${rejectReason}` : ''}`,
          link: `/activities/${result.submission.activityId}?submissionId=${encodeURIComponent(result.submission.id)}`,
          key: `topic-activity-form-review:${result.submission.id}:${body.status}`,
        }], skipDuplicates: true,
      }), { operation: 'topic-activity-form-review-notification', userId: result.submission.userId, notificationType: 'ACTIVITY' })
      if (approved && result.firstParticipationCreated) {
        await triggerBadgeEvaluation(result.submission.userId, 'TOPIC_ACTIVITY_PARTICIPATION_CREATED', result.submission.activityId)
          .catch((error) => console.error('[topic-activity-form.badge-evaluation.failed]', { activityId: result.submission.activityId, userId: result.submission.userId, error }))
      }
    }
    return NextResponse.json({
      submission: { id: result.submission.id, activityId: result.submission.activityId, status: result.submission.status, rejectReason: result.submission.rejectReason, reviewedAt: result.submission.reviewedAt?.toISOString() || null },
      participation: result.participation ? { approvedSubmissionCount: result.participation.approvedSubmissionCount, countedInActivity: result.participation.approvedSubmissionCount > 0, rewardStatus: result.participation.rewardStatus } : null,
      alreadyCounted: body.status === 'APPROVED' && !result.firstParticipationCreated && Boolean(result.participation && result.participation.approvedSubmissionCount > 0),
      changed: result.changed,
    }, { headers: { 'Cache-Control': 'private, no-store, max-age=0', Vary: 'Cookie, Authorization' } })
  } catch (error) {
    const code = error instanceof Error ? error.message : 'TOPIC_FORM_REVIEW_FAILED'
    const status = code === 'TOPIC_FORM_SUBMISSION_NOT_FOUND' ? 404 : 500
    if (status === 500) console.error('[topic-activity-form.review.failed]', { submissionId, reviewerId: guard.user.id, code })
    return NextResponse.json({ code, message: status === 404 ? '表单提交不存在' : '审核操作失败，请稍后重试' }, { status })
  }
}
