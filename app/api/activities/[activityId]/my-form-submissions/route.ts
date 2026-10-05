import { NextResponse } from 'next/server'
import { requireRequestUser } from '@/lib/security'
import { serializeTopicActivityFormSubmission } from '@/lib/topic-activity-form-view'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'
const relations = {
  ImageAssets: { select: { id: true, storageKey: true, mimeType: true, width: true, height: true, size: true } },
  Replies: { orderBy: [{ createdAt: 'asc' as const }, { id: 'asc' as const }], include: { Sender: { select: { id: true, nickname: true } }, ImageAssets: { select: { id: true, storageKey: true, mimeType: true, width: true, height: true, size: true } } } },
}

export async function GET(request: Request, context: { params: Promise<{ activityId: string }> }) {
  const guard = await requireRequestUser(request)
  if (!guard.user) return guard.response
  const { activityId } = await context.params
  const search = new URL(request.url).searchParams
  const page = Math.max(1, Number.parseInt(search.get('page') || '1', 10) || 1)
  const pageSize = Math.min(50, Math.max(1, Number.parseInt(search.get('pageSize') || '20', 10) || 20))
  const where = { activityId, userId: guard.user.id }
  const [total, rows] = await Promise.all([
    prisma.topicActivityFormSubmission.count({ where }),
    prisma.topicActivityFormSubmission.findMany({ where, include: relations, orderBy: [{ submittedAt: 'desc' }, { id: 'desc' }], take: pageSize, skip: (page - 1) * pageSize }),
  ])
  return NextResponse.json({ submissions: await Promise.all(rows.map(serializeTopicActivityFormSubmission)), page, pageSize, total, hasMore: page * pageSize < total }, { headers: { 'Cache-Control': 'private, no-store, max-age=0', Vary: 'Cookie, Authorization' } })
}
