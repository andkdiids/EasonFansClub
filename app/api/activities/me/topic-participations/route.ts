import { NextResponse } from 'next/server'
import { activitySelect, serializeActivityRow } from '@/lib/activity-data'
import { prisma } from '@/lib/prisma'
import { requireRequestUser } from '@/lib/security'
import { resolveTopicSubmissionStatus } from '@/lib/topic-activity'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const guard = await requireRequestUser(request)
  if (!guard.user) return guard.response
  const params = new URL(request.url).searchParams
  const page = Math.max(1, Number.parseInt(params.get('page') || '1', 10) || 1)
  const pageSize = Math.min(50, Math.max(1, Number.parseInt(params.get('pageSize') || '20', 10) || 20))
  const skip = (page - 1) * pageSize

  const [totalRows, groups] = await Promise.all([
    prisma.$queryRaw<Array<{ total: bigint | number }>>`SELECT COUNT(*) AS total FROM (SELECT \`activityId\` FROM \`TopicActivitySubmission\` WHERE \`userId\` = ${guard.user.id} UNION SELECT \`activityId\` FROM \`TopicActivityFormSubmission\` WHERE \`userId\` = ${guard.user.id} UNION SELECT \`activityId\` FROM \`TopicActivityParticipation\` WHERE \`userId\` = ${guard.user.id} UNION SELECT \`activityId\` FROM \`TopicActivityPollVote\` WHERE \`userId\` = ${guard.user.id} UNION SELECT \`activityId\` FROM \`TopicActivityTestAttempt\` WHERE \`userId\` = ${guard.user.id} UNION SELECT \`activityId\` FROM \`TopicActivityRewardGrant\` WHERE \`userId\` = ${guard.user.id}) AS myActivities`,
    prisma.$queryRaw<Array<{ activityId: string }>>`SELECT combined.\`activityId\` FROM (SELECT \`activityId\`, MAX(\`submittedAt\`) AS latest FROM \`TopicActivitySubmission\` WHERE \`userId\` = ${guard.user.id} GROUP BY \`activityId\` UNION ALL SELECT \`activityId\`, MAX(\`submittedAt\`) AS latest FROM \`TopicActivityFormSubmission\` WHERE \`userId\` = ${guard.user.id} GROUP BY \`activityId\` UNION ALL SELECT \`activityId\`, MAX(\`updatedAt\`) AS latest FROM \`TopicActivityParticipation\` WHERE \`userId\` = ${guard.user.id} GROUP BY \`activityId\` UNION ALL SELECT \`activityId\`, MAX(\`createdAt\`) AS latest FROM \`TopicActivityPollVote\` WHERE \`userId\` = ${guard.user.id} GROUP BY \`activityId\` UNION ALL SELECT \`activityId\`, MAX(\`completedAt\`) AS latest FROM \`TopicActivityTestAttempt\` WHERE \`userId\` = ${guard.user.id} GROUP BY \`activityId\` UNION ALL SELECT \`activityId\`, MAX(\`updatedAt\`) AS latest FROM \`TopicActivityRewardGrant\` WHERE \`userId\` = ${guard.user.id} GROUP BY \`activityId\`) AS combined GROUP BY combined.\`activityId\` ORDER BY MAX(combined.latest) DESC, combined.\`activityId\` ASC LIMIT ${pageSize} OFFSET ${skip}`,
  ])
  const total = Number(totalRows[0]?.total || 0)
  const activityIds = groups.map((row) => row.activityId)
  if (!activityIds.length) return NextResponse.json({ participations: [], page, pageSize, total, hasMore: false }, { headers: { 'Cache-Control': 'private, no-store, max-age=0', Vary: 'Cookie, Authorization' } })

  const [activities, statuses, formCounts, participationRows, pollCounts, testCounts, rewardCounts] = await Promise.all([
    prisma.activity.findMany({ where: { id: { in: activityIds }, status: { in: ['PUBLISHED', 'CANCELLED'] } }, select: activitySelect }),
    prisma.topicActivitySubmission.groupBy({ by: ['activityId', 'status'], where: { userId: guard.user.id, activityId: { in: activityIds }, commentDeletedAt: null, Comment: { is: { parentId: null, isDeleted: false } } }, _count: { _all: true } }),
    prisma.topicActivityFormSubmission.groupBy({ by: ['activityId'], where: { userId: guard.user.id, activityId: { in: activityIds } }, _count: { _all: true } }),
    prisma.topicActivityParticipation.findMany({ where: { userId: guard.user.id, activityId: { in: activityIds } }, select: { activityId: true, approvedSubmissionCount: true, rewardStatus: true, rewardEligibleAt: true, rewardGrantedAt: true } }),
    prisma.topicActivityPollVote.groupBy({ by: ['activityId'], where: { userId: guard.user.id, activityId: { in: activityIds } }, _count: { _all: true } }),
    prisma.topicActivityTestAttempt.groupBy({ by: ['activityId'], where: { userId: guard.user.id, activityId: { in: activityIds } }, _count: { _all: true } }),
    prisma.topicActivityRewardGrant.groupBy({ by: ['activityId', 'status'], where: { userId: guard.user.id, activityId: { in: activityIds } }, _count: { _all: true } }),
  ])
  const activityById = new Map(activities.map((row) => [row.id, serializeActivityRow(row)]))
  const counts = new Map<string, { total: number; pending: number; approved: number; rejected: number }>()
  for (const row of statuses) {
    const value = counts.get(row.activityId) || { total: 0, pending: 0, approved: 0, rejected: 0 }
    value.total += row._count._all
    if (row.status === 'PENDING') value.pending += row._count._all
    if (row.status === 'APPROVED') value.approved += row._count._all
    if (row.status === 'REJECTED') value.rejected += row._count._all
    counts.set(row.activityId, value)
  }
  const participationByActivity = new Map(participationRows.map((row) => [row.activityId, row]))
  const formsByActivity = new Map(formCounts.map((row) => [row.activityId, row._count._all]))
  const pollsByActivity = new Map(pollCounts.map((row) => [row.activityId, row._count._all]))
  const testsByActivity = new Map(testCounts.map((row) => [row.activityId, row._count._all]))
  const rewardsByActivity = new Map<string, { total: number; pending: number; processing: number; granted: number; failed: number; cancelled: number }>()
  for (const row of rewardCounts) {
    const value = rewardsByActivity.get(row.activityId) || { total: 0, pending: 0, processing: 0, granted: 0, failed: 0, cancelled: 0 }
    value.total += row._count._all
    if (row.status === 'PENDING') value.pending += row._count._all
    if (row.status === 'PROCESSING') value.processing += row._count._all
    if (row.status === 'GRANTED') value.granted += row._count._all
    if (row.status === 'FAILED') value.failed += row._count._all
    if (row.status === 'CANCELLED') value.cancelled += row._count._all
    rewardsByActivity.set(row.activityId, value)
  }
  const participations = activityIds.flatMap((activityId) => {
    const activity = activityById.get(activityId)
    if (!activity) return []
    const reviewCounts = counts.get(activityId) || { total: 0, pending: 0, approved: 0, rejected: 0 }
    const participation = participationByActivity.get(activityId)
    const rewards = rewardsByActivity.get(activityId) || { total: 0, pending: 0, processing: 0, granted: 0, failed: 0, cancelled: 0 }
    const rewardStatus = participation?.rewardStatus
      || (rewards.granted > 0 ? (rewards.pending + rewards.processing + rewards.failed > 0 ? 'PARTIAL' : 'GRANTED')
        : rewards.pending + rewards.processing + rewards.failed > 0 ? 'PENDING'
          : rewards.total > 0 && rewards.cancelled === rewards.total ? 'CANCELLED'
            : activity.status === 'CANCELLED' ? 'CANCELLED' : 'NOT_ELIGIBLE')
    return [{
      activity,
      submissionCount: reviewCounts.total,
      formSubmissionCount: formsByActivity.get(activityId) || 0,
      approvedSubmissionCount: reviewCounts.approved,
      pendingSubmissionCount: reviewCounts.pending,
      rejectedSubmissionCount: reviewCounts.rejected,
      status: resolveTopicSubmissionStatus(reviewCounts),
      countedInActivity: reviewCounts.approved > 0 && activity.status !== 'CANCELLED',
      rewardStatus,
      rewardEligibleAt: participation?.rewardEligibleAt?.toISOString() || null,
      rewardGrantedAt: participation?.rewardGrantedAt?.toISOString() || null,
      pollVoteCount: pollsByActivity.get(activityId) || 0,
      testAttemptCount: testsByActivity.get(activityId) || 0,
      rewardGrantCount: rewards.total,
      pendingRewardGrantCount: rewards.pending + rewards.processing + rewards.failed,
      grantedRewardGrantCount: rewards.granted,
    }]
  })
  return NextResponse.json({ participations, page, pageSize, total, hasMore: skip + activityIds.length < total }, { headers: { 'Cache-Control': 'private, no-store, max-age=0', Vary: 'Cookie, Authorization' } })
}
