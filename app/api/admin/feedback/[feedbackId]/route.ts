import { NextResponse } from 'next/server'
import { feedbackInclude, parseFeedbackStatus, serializeFeedback } from '@/lib/feedback'
import { prisma } from '@/lib/prisma'
import { requireAdmin } from '@/lib/security'

export const dynamic = 'force-dynamic'

export async function GET(_request: Request, { params }: { params: Promise<{ feedbackId: string }> }) {
  const guard = await requireAdmin('feedback_manage')
  if (!guard.user) return guard.response

  const { feedbackId } = await params
  const feedback = await prisma.feedback.findUnique({
    where: { id: feedbackId },
    include: feedbackInclude,
  })

  if (!feedback) return NextResponse.json({ message: '反馈不存在' }, { status: 404 })

  if (feedback.adminUnread) {
    await prisma.$transaction([
      prisma.feedback.update({ where: { id: feedback.id }, data: { adminUnread: false } }),
      prisma.feedbackReply.updateMany({
        where: { feedbackId: feedback.id, authorRole: 'USER', isReadByAdmin: false },
        data: { isReadByAdmin: true },
      }),
    ])
    feedback.adminUnread = false
    feedback.replies = feedback.replies.map((reply) =>
      reply.authorRole === 'USER' ? { ...reply, isReadByAdmin: true } : reply,
    )
  }

  return NextResponse.json({ feedback: serializeFeedback(feedback, { includeContact: true }) })
}

export async function PATCH(request: Request, { params }: { params: Promise<{ feedbackId: string }> }) {
  const guard = await requireAdmin('feedback_manage')
  if (!guard.user) return guard.response

  const { feedbackId } = await params
  const body = await request.json().catch(() => null)
  const status = parseFeedbackStatus(body?.status)

  if (!status) return NextResponse.json({ message: '请选择有效的反馈状态' }, { status: 400 })

  const feedback = await prisma.feedback.findUnique({ where: { id: feedbackId }, select: { id: true } })
  if (!feedback) return NextResponse.json({ message: '反馈不存在' }, { status: 404 })

  const updated = await prisma.feedback.update({
    where: { id: feedbackId },
    data: {
      status,
      ...(status === 'CLOSED' ? { closedAt: new Date() } : { closedAt: null }),
    },
    include: feedbackInclude,
  })

  return NextResponse.json({ feedback: serializeFeedback(updated, { includeContact: true }), message: '反馈状态已更新' })
}
