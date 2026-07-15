import { NextResponse } from 'next/server'
import { feedbackInclude, parseFeedbackAttachments, serializeFeedback } from '@/lib/feedback'
import { prisma } from '@/lib/prisma'
import { filterSensitiveWords, requireAdmin, sanitizeText } from '@/lib/security'

export async function POST(request: Request, { params }: { params: Promise<{ feedbackId: string }> }) {
  const guard = await requireAdmin('feedback_manage')
  if (!guard.user) return guard.response

  const { feedbackId } = await params
  const body = await request.json().catch(() => null)
  const rawContent = typeof body?.content === 'string' ? body.content : ''
  if (rawContent.length > 2000) return NextResponse.json({ message: '回复内容最多 2000 个字' }, { status: 400 })
  const content = await filterSensitiveWords(sanitizeText(body?.content, 2000))
  const attachments = parseFeedbackAttachments(body?.attachments)

  if (!content && attachments.length === 0) {
    return NextResponse.json({ message: '请填写回复内容或上传图片' }, { status: 400 })
  }

  const feedback = await prisma.feedback.findUnique({
    where: { id: feedbackId },
    select: { id: true, userId: true, title: true, status: true },
  })

  if (!feedback) return NextResponse.json({ message: '反馈不存在' }, { status: 404 })
  if (feedback.status === 'RESOLVED' || feedback.status === 'CLOSED') {
    return NextResponse.json({ message: '该反馈已完成，请先重新打开后再回复' }, { status: 400 })
  }

  const now = new Date()
  const updated = await prisma.$transaction(async (tx) => {
    const reply = await tx.feedbackReply.create({
      data: {
        feedbackId,
        adminId: guard.user.id,
        authorRole: 'ADMIN',
        content,
        isReadByAdmin: true,
        isReadByUser: false,
      },
      select: { id: true },
    })

    if (attachments.length) {
      await tx.feedbackAttachment.createMany({
        data: attachments.map((item) => ({ ...item, feedbackId, replyId: reply.id })),
      })
    }

    await tx.notification.create({
      data: {
        type: 'ADMIN',
        title: `管理员回复了你的反馈：${feedback.title}`,
        content: content.slice(0, 120) || '管理员上传了图片回复。',
        link: `/feedback/${feedback.id}`,
        recipientId: feedback.userId,
        actorId: guard.user.id,
      },
    })

    return tx.feedback.update({
      where: { id: feedbackId },
      data: {
        status: feedback.status === 'PROCESSING' ? 'PROCESSING' : 'REPLIED',
        adminUnread: false,
        userUnread: true,
        lastReplyAt: now,
        lastAdminReplyAt: now,
      },
      include: feedbackInclude,
    })
  })

  return NextResponse.json({ feedback: serializeFeedback(updated, { includeContact: true }), message: '回复已发送' })
}
