import { NextResponse } from 'next/server'
import { feedbackInclude, serializeFeedback } from '@/lib/feedback'
import { prisma } from '@/lib/prisma'
import { requireUser } from '@/lib/security'

export const dynamic = 'force-dynamic'

export async function GET(_request: Request, { params }: { params: Promise<{ feedbackId: string }> }) {
  const guard = await requireUser()
  if (!guard.user) return guard.response

  const { feedbackId } = await params
  const feedback = await prisma.feedback.findFirst({
    where: { id: feedbackId, userId: guard.user.id },
    include: feedbackInclude,
  })

  if (!feedback) {
    return NextResponse.json({ message: '反馈不存在，或你无权查看' }, { status: 404 })
  }

  await prisma.$transaction([
    prisma.feedback.update({
      where: { id: feedback.id },
      data: { userUnread: false },
    }),
    prisma.feedbackReply.updateMany({
      where: { feedbackId: feedback.id, authorRole: 'ADMIN', isReadByUser: false },
      data: { isReadByUser: true },
    }),
    prisma.notification.updateMany({
      where: {
        recipientId: guard.user.id,
        isRead: false,
        link: { startsWith: `/feedback/${feedback.id}` },
      },
      data: { isRead: true, readAt: new Date() },
    }),
  ])
  if (feedback.userUnread) {
    feedback.userUnread = false
    feedback.FeedbackReply = feedback.FeedbackReply.map((reply) =>
      reply.authorRole === 'ADMIN' ? { ...reply, isReadByUser: true } : reply,
    )
  }

  return NextResponse.json({ feedback: serializeFeedback(feedback, { includeContact: true }) })
}
