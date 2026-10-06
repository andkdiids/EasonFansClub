import { NextResponse } from 'next/server'
import { requireRequestAdmin } from '@/lib/security'
import { serializeTopicActivityFormSubmission } from '@/lib/topic-activity-form-view'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'
const relations = {
  User: { select: { id: true, nickname: true, avatarUrl: true } },
  ImageAssets: { select: { id: true, storageKey: true, mimeType: true, width: true, height: true, size: true } },
  Replies: { orderBy: [{ createdAt: 'asc' as const }, { id: 'asc' as const }], include: { Sender: { select: { id: true, nickname: true } }, ImageAssets: { select: { id: true, storageKey: true, mimeType: true, width: true, height: true, size: true } } } },
}

export async function GET(request: Request, context: { params: Promise<{ activityId: string }> }) {
  const guard = await requireRequestAdmin(request, 'activity_manage')
  if (!guard.user) return guard.response
  const { activityId } = await context.params
  const params = new URL(request.url).searchParams
  const statusValue = params.get('status')?.toUpperCase() || ''
  const status = ['PENDING', 'APPROVED', 'REJECTED', 'WITHDRAWN'].includes(statusValue) ? statusValue as 'PENDING' | 'APPROVED' | 'REJECTED' | 'WITHDRAWN' : undefined
  const page = Math.max(1, Number.parseInt(params.get('page') || '1', 10) || 1)
  const pageSize = Math.min(50, Math.max(1, Number.parseInt(params.get('pageSize') || '20', 10) || 20))
  const activity = await prisma.activity.findFirst({ where: { id: activityId, type: 'TOPIC_ACTIVITY' }, select: { id: true } })
  if (!activity) return NextResponse.json({ message: '话题活动不存在' }, { status: 404 })
  const where = { activityId, ...(status ? { status } : {}) }
  const [total, rows, statusCounts, commentSubmissionCount, approvedUsers] = await Promise.all([
    prisma.topicActivityFormSubmission.count({ where }),
    prisma.topicActivityFormSubmission.findMany({ where, include: relations, orderBy: [{ submittedAt: 'desc' }, { id: 'desc' }], take: pageSize, skip: (page - 1) * pageSize }),
    prisma.topicActivityFormSubmission.groupBy({ by: ['status'], where: { activityId }, _count: { _all: true } }),
    prisma.topicActivitySubmission.count({ where: { activityId } }),
    prisma.topicActivityParticipation.count({ where: { activityId, approvedSubmissionCount: { gt: 0 } } }),
  ])
  const counts = { pending: 0, approved: 0, rejected: 0, withdrawn: 0 }
  for (const row of statusCounts) counts[row.status.toLowerCase() as keyof typeof counts] = row._count._all
  return NextResponse.json({
    submissions: await Promise.all(rows.map(serializeTopicActivityFormSubmission)), page, pageSize, total, hasMore: page * pageSize < total,
    counts: { commentSubmissions: commentSubmissionCount, formSubmissions: counts.pending + counts.approved + counts.rejected + counts.withdrawn, pendingForms: counts.pending, approvedForms: counts.approved, rejectedForms: counts.rejected, withdrawnForms: counts.withdrawn, approvedUsers },
  }, { headers: { 'Cache-Control': 'private, no-store, max-age=0', Vary: 'Cookie, Authorization' } })
}
