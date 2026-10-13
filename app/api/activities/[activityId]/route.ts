import { NextResponse } from 'next/server'
import { activitySelect, serializeActivityRow } from '@/lib/activity-data'
import { getActivityRegistrationState } from '@/lib/activity-registration'
import { activityRegistrationSelect, getActivityRegistrationQuestions, serializeActivityRegistration } from '@/lib/activity-registration'
import { prisma } from '@/lib/prisma'
import { getPublicActivityLotteries } from '@/lib/activity-lottery'
import { resolveRequestAuth } from '@/lib/security'
import { hasAdminPermission } from '@/lib/admin-permissions'
import { resolveTopicSubmissionStatus } from '@/lib/topic-activity'

export const dynamic = 'force-dynamic'

const activityIdPattern = /^[A-Za-z0-9_-]{8,128}$/

export async function GET(request: Request, { params }: { params: Promise<{ activityId: string }> }) {
  const auth = await resolveRequestAuth(request)
  if (auth.response) return auth.response
  const viewer = auth.user
  const { activityId } = await params
  if (!activityIdPattern.test(activityId)) return NextResponse.json({ message: '活动不存在' }, { status: 404 })
  const activity = await prisma.activity.findFirst({
    where: { id: activityId, status: { in: ['PUBLISHED', 'CANCELLED'] } },
    select: activitySelect,
  })
  if (!activity) return NextResponse.json({ message: '活动不存在' }, { status: 404 })

  const view = serializeActivityRow(activity)
  const canManageTopicForms = Boolean(viewer && view.type === 'TOPIC_ACTIVITY' && await hasAdminPermission(viewer, 'activity_manage'))
  const [registration, questions] = await Promise.all([
    viewer
      ? prisma.activityRegistration.findUnique({ where: { activityId_userId: { activityId, userId: viewer.id } }, select: activityRegistrationSelect })
      : Promise.resolve(null),
    getActivityRegistrationQuestions(prisma, activityId),
  ])
  const [topicStatusGroups, formSubmissionCount, topicParticipation] = view.type === 'TOPIC_ACTIVITY' && viewer
    ? await Promise.all([
        prisma.topicActivitySubmission.groupBy({ by: ['status'], where: { activityId, userId: viewer.id, commentDeletedAt: null, Comment: { is: { parentId: null, isDeleted: false } } }, _count: { _all: true } }),
        prisma.topicActivityFormSubmission.count({ where: { activityId, userId: viewer.id } }),
        prisma.topicActivityParticipation.findUnique({ where: { activityId_userId: { activityId, userId: viewer.id } }, select: { approvedSubmissionCount: true, rewardStatus: true, rewardEligibleAt: true, rewardGrantedAt: true } }),
      ])
    : [[], 0, null] as const
  const topicCounts = { total: 0, pending: 0, approved: 0, rejected: 0 }
  for (const row of topicStatusGroups) {
    topicCounts.total += row._count._all
    if (row.status === 'PENDING') topicCounts.pending += row._count._all
    if (row.status === 'APPROVED') topicCounts.approved += row._count._all
    if (row.status === 'REJECTED') topicCounts.rejected += row._count._all
  }
  const availability = getActivityRegistrationState(view, view.signupCount)
  const lotteries = await getPublicActivityLotteries(activityId, viewer?.id)
  const activityCancelled = view.status === 'CANCELLED'
  // Activity cancellation stops new actions, but it must not hide the user's
  // preserved registration history (especially a completed check-in).
  const isRegistered = registration?.status === 'ACTIVE'
  const isCancelled = registration?.status === 'CANCELLED'
  const activityMaterialAvailable = !view.linkedMaterial || (view.linkedMaterial.status === 'PUBLISHED' && view.linkedMaterial.stockRemaining > 0)
  return NextResponse.json({
    activity: view,
    canManageTopicForms,
    questions,
    registration: registration ? serializeActivityRegistration(registration) : null,
    registrationCount: view.signupCount,
    isRegistered,
    registrationStatus: registration?.status || null,
    registrationState: availability.state,
    canRegister: availability.canRegister && Boolean(viewer) && !activityCancelled && !isRegistered && !isCancelled && activityMaterialAvailable,
    lotteries,
    topicParticipation: view.type === 'TOPIC_ACTIVITY' ? {
      status: resolveTopicSubmissionStatus(topicCounts),
      submissionCount: topicCounts.total,
      formSubmissionCount,
      approvedSubmissionCount: topicCounts.approved,
      pendingSubmissionCount: topicCounts.pending,
      rejectedSubmissionCount: topicCounts.rejected,
      countedInActivity: topicCounts.approved > 0 && view.status !== 'CANCELLED',
      rewardStatus: topicCounts.approved > 0 || topicParticipation?.rewardGrantedAt ? topicParticipation?.rewardStatus || 'NOT_ELIGIBLE' : view.status === 'CANCELLED' ? 'CANCELLED' : 'NOT_ELIGIBLE',
      rewardEligibleAt: topicParticipation?.rewardEligibleAt?.toISOString() || null,
      rewardGrantedAt: topicParticipation?.rewardGrantedAt?.toISOString() || null,
    } : null,
  }, { headers: { 'Cache-Control': 'private, no-store, max-age=0', Vary: 'Cookie, Authorization' } })
}
