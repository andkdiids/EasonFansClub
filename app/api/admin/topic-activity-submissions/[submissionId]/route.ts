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
      const activity = await prisma.activity.findUnique({ where: { id: result.submission.activityId }, select: { title: true, activityPostId: true, rewardGrantMode: true, rewardGrantAt: true } })
      const approved = body.status === 'APPROVED'
      const rewardGrants = result.participation
        ? await prisma.topicActivityRewardGrant.findMany({ where: { participationId: result.participation.id }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], select: { kind: true, points: true, status: true, Badge: { select: { name: true } } } })
        : []
      const rewardLabel = (grant: typeof rewardGrants[number]) => grant.kind === 'POINTS' && grant.points
        ? `${grant.points} 挂号费`
        : grant.Badge?.name ? `「${grant.Badge.name}」勋章` : null
      const configuredRewards = rewardGrants.map(rewardLabel).filter((item): item is string => Boolean(item))
      const grantedRewards = rewardGrants.filter((grant) => grant.status === 'GRANTED').map(rewardLabel).filter((item): item is string => Boolean(item))
      const allRewardGrantsCompleted = rewardGrants.length > 0 && rewardGrants.every((grant) => grant.status === 'GRANTED')
      const approvalContent = !result.firstParticipationCreated
        ? `你在「${activity?.title || '话题活动'}」中的另一条参与评论已通过审核。本活动参与次数与奖励按首次有效通过记录计算，不会重复累计或发放。`
        : activity?.rewardGrantMode === 'SCHEDULED' && configuredRewards.length
            ? `你在「${activity.title || '话题活动'}」中的参与评论已通过审核。活动奖励：${configuredRewards.join('、')}。预计发放：${activity.rewardGrantAt ? new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(activity.rewardGrantAt) : '以活动页面安排为准'}。`
          : allRewardGrantsCompleted
            ? `你在「${activity?.title || '话题活动'}」中的参与评论已通过审核，已获得：${grantedRewards.join('、')}。`
            : rewardGrants.some((grant) => grant.status === 'FAILED')
              ? `你在「${activity?.title || '话题活动'}」中的参与评论已通过审核。${grantedRewards.length ? `已到账：${grantedRewards.join('、')}。` : ''}其余奖励发放遇到问题，管理员将核查。`
              : `你在「${activity?.title || '话题活动'}」中的一条参与评论已通过审核`
      await safeNotificationWrite(() => createManyNotifications({
        data: [{
          recipientId: result.submission.userId,
          actorId: null,
          type: 'ACTIVITY',
          title: approved ? '话题活动审核已通过' : '话题活动评论未通过',
          content: approved ? approvalContent : `你在「${activity?.title || '话题活动'}」中的一条参与评论未通过审核${rejectReason ? `：${rejectReason}` : ''}`,
          link: activity?.activityPostId ? `/posts/${activity.activityPostId}?focus=${result.submission.commentId || ''}` : '/activities',
          activityId: result.submission.activityId,
          key: `topic-activity-review:${result.submission.id}:${body.status}:${result.submission.reviewedAt?.getTime() || Date.now()}`,
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
      alreadyCounted: body.status === 'APPROVED' && !result.firstParticipationCreated && Boolean(result.participation && result.participation.approvedSubmissionCount > 0),
      changed: result.changed,
    }, { headers: { 'Cache-Control': 'private, no-store, max-age=0', Vary: 'Cookie, Authorization' } })
  } catch (error) {
    const code = error instanceof Error ? error.message : 'TOPIC_REVIEW_FAILED'
    const status = code === 'TOPIC_SUBMISSION_NOT_FOUND' ? 404 : code === 'FORM_REQUIRED_BEFORE_APPROVAL' || code === 'TOPIC_SUBMISSION_COMMENT_UNAVAILABLE' || code === 'TOPIC_SUBMISSION_WITHDRAWN' ? 409 : code === 'TOPIC_SUBMISSION_RELATION_INVALID' ? 403 : 500
    if (status === 500) console.error('[topic-activity.review.failed]', { submissionId, reviewerId: guard.user.id, code })
    return NextResponse.json({ code, message: code === 'FORM_REQUIRED_BEFORE_APPROVAL' ? '该用户尚未填写表单，请先完成表单再审核评论' : status === 500 ? '审核操作失败，请稍后重试' : code === 'TOPIC_SUBMISSION_COMMENT_UNAVAILABLE' ? '原评论已删除，不能通过审核' : '参与评论不可用' }, { status })
  }
}
