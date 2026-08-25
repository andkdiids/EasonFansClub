import { NextResponse } from 'next/server'
import { feedbackInclude, serializeFeedback } from '@/lib/feedback'
import { prisma } from '@/lib/prisma'
import { safeNotificationWrite } from '@/lib/notification-transaction'
import { emitRealtime } from '@/lib/realtime'
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

  const [feedbackUpdate, replyUpdate] = await prisma.$transaction([
    prisma.feedback.updateMany({
      where: { id: feedback.id, userId: guard.user.id, userUnread: true },
      data: { userUnread: false },
    }),
    prisma.feedbackReply.updateMany({
      where: { feedbackId: feedback.id, authorRole: 'ADMIN', isReadByUser: false },
      data: { isReadByUser: true },
    }),
  ])
  const notificationUpdate = await safeNotificationWrite(
    () => prisma.notification.updateMany({
      where: {
        recipientId: guard.user.id,
        isRead: false,
        link: { startsWith: `/feedback/${feedback.id}` },
      },
      data: { isRead: true, readAt: new Date() },
    }),
    { operation: 'feedback-detail-mark-notifications-read', userId: guard.user.id, notificationType: 'FEEDBACK' },
  )
  if (feedback.userUnread || replyUpdate.count > 0) {
    feedback.userUnread = false
    feedback.FeedbackReply = feedback.FeedbackReply.map((reply) =>
      reply.authorRole === 'ADMIN' ? { ...reply, isReadByUser: true } : reply,
    )
  }

  if (feedbackUpdate.count > 0 || replyUpdate.count > 0 || (notificationUpdate?.count || 0) > 0) {
    emitRealtime(guard.user.id, 'feedback', { feedbackId })
  }

  return NextResponse.json({ feedback: serializeFeedback(feedback, { includeContact: true }) })
}
