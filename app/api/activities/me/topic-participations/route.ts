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
    prisma.$queryRaw<Array<{ total: bigint | number }>>`SELECT COUNT(*) AS total FROM (SELECT \`activityId\` FROM \`TopicActivitySubmission\` WHERE \`userId\` = ${guard.user.id} UNION SELECT \`activityId\` FROM \`TopicActivityFormSubmission\` WHERE \`userId\` = ${guard.user.id}) AS myActivities`,
    prisma.$queryRaw<Array<{ activityId: string }>>`SELECT combined.\`activityId\` FROM (SELECT \`activityId\`, MAX(\`submittedAt\`) AS latest FROM \`TopicActivitySubmission\` WHERE \`userId\` = ${guard.user.id} GROUP BY \`activityId\` UNION ALL SELECT \`activityId\`, MAX(\`submittedAt\`) AS latest FROM \`TopicActivityFormSubmission\` WHERE \`userId\` = ${guard.user.id} GROUP BY \`activityId\`) AS combined GROUP BY combined.\`activityId\` ORDER BY MAX(combined.latest) DESC LIMIT ${pageSize} OFFSET ${skip}`,
  ])
  const total = Number(totalRows[0]?.total || 0)
  const activityIds = groups.map((row) => row.activityId)
  if (!activityIds.length) return NextResponse.json({ participations: [], page, pageSize, total, hasMore: false }, { headers: { 'Cache-Control': 'private, no-store, max-age=0', Vary: 'Cookie, Authorization' } })

  const [activities, statuses, formStatuses, participationRows] = await Promise.all([
    prisma.activity.findMany({ where: { id: { in: activityIds } }, select: activitySelect }),
    prisma.topicActivitySubmission.groupBy({ by: ['activityId', 'status'], where: { userId: guard.user.id, activityId: { in: activityIds }, commentDeletedAt: null }, _count: { _all: true } }),
    prisma.topicActivityFormSubmission.groupBy({ by: ['activityId', 'status'], where: { userId: guard.user.id, activityId: { in: activityIds } }, _count: { _all: true } }),
    prisma.topicActivityParticipation.findMany({ where: { userId: guard.user.id, activityId: { in: activityIds } }, select: { activityId: true, approvedSubmissionCount: true, rewardStatus: true, rewardEligibleAt: true, rewardGrantedAt: true } }),
  ])
  const activityById = new Map(activities.map((row) => [row.id, serializeActivityRow(row)]))
  const counts = new Map<string, { total: number; pending: number; approved: number; rejected: number }>()
  for (const row of [...statuses, ...formStatuses]) {
    const value = counts.get(row.activityId) || { total: 0, pending: 0, approved: 0, rejected: 0 }
    value.total += row._count._all
    if (row.status === 'PENDING') value.pending += row._count._all
    if (row.status === 'APPROVED') value.approved += row._count._all
    if (row.status === 'REJECTED') value.rejected += row._count._all
    counts.set(row.activityId, value)
  }
  const participationByActivity = new Map(participationRows.map((row) => [row.activityId, row]))
  const participations = activityIds.flatMap((activityId) => {
    const activity = activityById.get(activityId)
    if (!activity) return []
    const reviewCounts = counts.get(activityId) || { total: 0, pending: 0, approved: 0, rejected: 0 }
    const participation = participationByActivity.get(activityId)
    return [{
      activity,
      submissionCount: reviewCounts.total,
      approvedSubmissionCount: reviewCounts.approved,
      pendingSubmissionCount: reviewCounts.pending,
      rejectedSubmissionCount: reviewCounts.rejected,
      status: resolveTopicSubmissionStatus(reviewCounts),
      countedInActivity: Boolean(participation?.approvedSubmissionCount),
      rewardStatus: participation?.rewardStatus || 'NOT_ELIGIBLE',
      rewardEligibleAt: participation?.rewardEligibleAt?.toISOString() || null,
      rewardGrantedAt: participation?.rewardGrantedAt?.toISOString() || null,
    }]
  })
  return NextResponse.json({ participations, page, pageSize, total, hasMore: skip + activityIds.length < total }, { headers: { 'Cache-Control': 'private, no-store, max-age=0', Vary: 'Cookie, Authorization' } })
}
