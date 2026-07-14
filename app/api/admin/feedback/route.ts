import { NextResponse } from 'next/server'
import type { Prisma } from '@prisma/client'
import { feedbackListSelect, feedbackTypes, feedbackVisibleStatuses, parseFeedbackStatusFilter, parseFeedbackType, serializeFeedbackListItem } from '@/lib/feedback'
import { prisma } from '@/lib/prisma'
import { requireAdmin, sanitizeText } from '@/lib/security'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const guard = await requireAdmin('feedback_manage')
  if (!guard.user) return guard.response

  const { searchParams } = new URL(request.url)
  const statusFilter = parseFeedbackStatusFilter(searchParams.get('status'))
  const type = parseFeedbackType(searchParams.get('type'))
  const q = sanitizeText(searchParams.get('q'), 60)
  const sort = searchParams.get('sort') === 'createdAt' ? 'createdAt' : 'updatedAt'
  const page = Math.max(1, Number(searchParams.get('page') || 1) || 1)
  const pageSize = Math.min(50, Math.max(10, Number(searchParams.get('pageSize') || 20) || 20))
  const searchWhere = q
    ? [
        { title: { contains: q, mode: 'insensitive' as const } },
        { user: { username: { contains: q, mode: 'insensitive' as const } } },
        { user: { nickname: { contains: q, mode: 'insensitive' as const } } },
        { user: { profile: { displayName: { contains: q, mode: 'insensitive' as const } } } },
        ...(/^\d+$/.test(q) ? [{ user: { uid: Number(q) } }] : []),
      ]
    : []

  const where: Prisma.FeedbackWhereInput = {
    ...(statusFilter ? { status: { in: statusFilter } } : {}),
    ...(type ? { type } : {}),
    ...(searchWhere.length ? { OR: searchWhere } : {}),
  }

  const [feedbacks, total] = await Promise.all([
    prisma.feedback.findMany({
      where,
      orderBy: [{ adminUnread: 'desc' }, { [sort]: 'desc' }],
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: feedbackListSelect,
    }),
    prisma.feedback.count({ where }),
  ])

  const counts = await prisma.feedback.groupBy({
    by: ['status'],
    _count: { status: true },
  })

  return NextResponse.json({
    feedbacks: feedbacks.map(serializeFeedbackListItem),
    statusOptions: feedbackVisibleStatuses,
    typeOptions: feedbackTypes,
    page,
    pageSize,
    total,
    hasMore: page * pageSize < total,
    counts: counts.reduce<Record<string, number>>((result, item) => {
      result[item.status] = item._count.status
      return result
    }, {}),
  })
}
