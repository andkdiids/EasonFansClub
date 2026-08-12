import { NextResponse } from 'next/server'
import { feedbackInclude, serializeFeedback } from '@/lib/feedback'
import { prisma } from '@/lib/prisma'
import { emitRealtime } from '@/lib/realtime'
import { requireAdmin } from '@/lib/security'

export async function PATCH(_request: Request, { params }: { params: Promise<{ feedbackId: string }> }) {
  const guard = await requireAdmin('feedback_manage')
  if (!guard.user) return guard.response

  const { feedbackId } = await params
  const feedback = await prisma.feedback.findUnique({
    where: { id: feedbackId },
    select: { id: true, userId: true, status: true },
  })

  if (!feedback) return NextResponse.json({ message: '反馈不存在' }, { status: 404 })
  if (feedback.status === 'RESOLVED' || feedback.status === 'CLOSED') {
    return NextResponse.json({ message: '该反馈已完成' }, { status: 400 })
  }

  const updated = await prisma.feedback.update({
    where: { id: feedbackId },
    data: { status: 'RESOLVED', adminUnread: false, userUnread: false, closedAt: new Date() },
    include: feedbackInclude,
  })

  emitRealtime(feedback.userId, 'feedback', { feedbackId })
  return NextResponse.json({ feedback: serializeFeedback(updated, { includeContact: true }), message: '已标记为已完成' })
}
