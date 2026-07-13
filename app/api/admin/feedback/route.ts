import { NextResponse } from 'next/server'
import { feedbackListSelect, feedbackStatuses, feedbackTypes, parseFeedbackStatus, parseFeedbackType, serializeFeedbackListItem } from '@/lib/feedback'
import { prisma } from '@/lib/prisma'
import { requireAdmin, sanitizeText } from '@/lib/security'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const guard = await requireAdmin('feedback_manage')
  if (!guard.user) return guard.response

  const { searchParams } = new URL(request.url)
  const status = parseFeedbackStatus(searchParams.get('status'))
  const type = parseFeedbackType(searchParams.get('type'))
  const q = sanitizeText(searchParams.get('q'), 60)
  const sort = searchParams.get('sort') === 'createdAt' ? 'createdAt' : 'updatedAt'
  const searchWhere = q
    ? [
        { title: { contains: q, mode: 'insensitive' as const } },
        { user: { nickname: { contains: q, mode: 'insensitive' as const } } },
        ...(/^\d+$/.test(q) ? [{ user: { uid: Number(q) } }] : []),
      ]
    : []

  const feedbacks = await prisma.feedback.findMany({
    where: {
      ...(status ? { status } : {}),
      ...(type ? { type } : {}),
      ...(searchWhere.length ? { OR: searchWhere } : {}),
    },
    orderBy: [{ adminUnread: 'desc' }, { [sort]: 'desc' }],
    take: 100,
    select: feedbackListSelect,
  })

  const counts = await prisma.feedback.groupBy({
    by: ['status'],
    _count: { status: true },
  })

  return NextResponse.json({
    feedbacks: feedbacks.map(serializeFeedbackListItem),
    statusOptions: feedbackStatuses,
    typeOptions: feedbackTypes,
    counts: counts.reduce<Record<string, number>>((result, item) => {
      result[item.status] = item._count.status
      return result
    }, {}),
  })
}
