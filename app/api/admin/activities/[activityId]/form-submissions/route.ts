import { NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
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
  const replyStatus = params.get('replyStatus')?.toUpperCase() || 'ALL'
  const userId = params.get('userId') || undefined
  const page = Math.max(1, Number.parseInt(params.get('page') || '1', 10) || 1)
  const pageSize = Math.min(50, Math.max(1, Number.parseInt(params.get('pageSize') || '20', 10) || 20))
  const activity = await prisma.activity.findFirst({ where: { id: activityId, type: 'TOPIC_ACTIVITY' }, select: { id: true } })
  if (!activity) return NextResponse.json({ message: '话题活动不存在' }, { status: 404 })
  const scope = { activityId, ...(userId ? { userId } : {}) }
  const where: Prisma.TopicActivityFormSubmissionWhereInput = { ...scope, ...(replyStatus === 'REPLIED' ? { Replies: { some: {} } } : replyStatus === 'UNREPLIED' ? { Replies: { none: {} } } : {}) }
  const [total, rows, formSubmissions, repliedForms, commentSubmissionCount, approvedUserRows] = await Promise.all([
    prisma.topicActivityFormSubmission.count({ where }),
    prisma.topicActivityFormSubmission.findMany({ where, include: relations, orderBy: [{ submittedAt: 'desc' }, { id: 'desc' }], take: pageSize, skip: (page - 1) * pageSize }),
    prisma.topicActivityFormSubmission.count({ where: scope }),
    prisma.topicActivityFormSubmission.count({ where: { ...scope, Replies: { some: {} } } }),
    prisma.topicActivitySubmission.count({ where: { activityId } }),
    prisma.topicActivitySubmission.groupBy({ by: ['userId'], where: { activityId, status: 'APPROVED', commentDeletedAt: null, Comment: { is: { parentId: null, isDeleted: false } } } }),
  ])
  return NextResponse.json({
    submissions: await Promise.all(rows.map(serializeTopicActivityFormSubmission)), page, pageSize, total, hasMore: page * pageSize < total,
    counts: { commentSubmissions: commentSubmissionCount, formSubmissions, repliedForms, unrepliedForms: formSubmissions - repliedForms, approvedUsers: approvedUserRows.length },
  }, { headers: { 'Cache-Control': 'private, no-store, max-age=0', Vary: 'Cookie, Authorization' } })
}
