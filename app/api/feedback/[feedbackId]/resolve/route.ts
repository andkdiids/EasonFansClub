import { NextResponse } from 'next/server'
import { feedbackInclude, serializeFeedback } from '@/lib/feedback'
import { prisma } from '@/lib/prisma'
import { requireUser } from '@/lib/security'

export async function PATCH(_request: Request, { params }: { params: Promise<{ feedbackId: string }> }) {
  const guard = await requireUser()
  if (!guard.user) return guard.response

  const { feedbackId } = await params
  const feedback = await prisma.feedback.findFirst({
    where: { id: feedbackId, userId: guard.user.id },
    select: { id: true, status: true },
  })

  if (!feedback) return NextResponse.json({ message: '反馈不存在，或你无权操作' }, { status: 404 })
  if (feedback.status === 'CLOSED') return NextResponse.json({ message: '已关闭的反馈不能标记为已解决' }, { status: 400 })

  const updated = await prisma.feedback.update({
    where: { id: feedbackId },
    data: { status: 'RESOLVED', adminUnread: false, userUnread: false },
    include: feedbackInclude,
  })

  return NextResponse.json({ feedback: serializeFeedback(updated, { includeContact: true }), message: '已标记为已解决' })
}
