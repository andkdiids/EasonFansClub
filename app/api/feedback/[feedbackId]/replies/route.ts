import { NextResponse } from 'next/server'
import { feedbackInclude, parseFeedbackAttachments, serializeFeedback } from '@/lib/feedback'
import { prisma } from '@/lib/prisma'
import { emitRealtimeToAdmins } from '@/lib/realtime'
import { containsSensitiveContent, getClientIp, rateLimit, requireUser, sanitizeText } from '@/lib/security'

export async function POST(request: Request, { params }: { params: Promise<{ feedbackId: string }> }) {
  const guard = await requireUser()
  if (!guard.user) return guard.response
  const limited = await rateLimit(getClientIp(request), 'feedback:reply', 20, 60 * 60)
  if (limited) return limited

  const { feedbackId } = await params
  const body = await request.json().catch(() => null)
  const rawContent = typeof body?.content === 'string' ? body.content : ''
  if (rawContent.length > 2000) return NextResponse.json({ message: '回复内容最多 2000 个字' }, { status: 400 })
  const content = sanitizeText(body?.content, 2000)
  if (await containsSensitiveContent(content)) return NextResponse.json({ message: '内容包含违禁词，无法发布' }, { status: 400 })
  const attachments = parseFeedbackAttachments(body?.attachments)

  if (!content && attachments.length === 0) {
    return NextResponse.json({ message: '请填写回复内容或上传图片' }, { status: 400 })
  }

  const feedback = await prisma.feedback.findFirst({
    where: { id: feedbackId, userId: guard.user.id },
    select: { id: true, status: true },
  })

  if (!feedback) return NextResponse.json({ message: '反馈不存在，或你无权回复' }, { status: 404 })
  if (feedback.status === 'RESOLVED' || feedback.status === 'CLOSED') {
    return NextResponse.json({ message: '该反馈已完成，如需继续沟通请提交新的反馈' }, { status: 400 })
  }

  const now = new Date()
  const updated = await prisma.$transaction(async (tx) => {
    const reply = await tx.feedbackReply.create({
      data: {
        feedbackId,
        adminId: guard.user.id,
        authorRole: 'USER',
        content,
        isReadByAdmin: false,
        isReadByUser: true,
      },
      select: { id: true },
    })

    if (attachments.length) {
      await tx.feedbackAttachment.createMany({
        data: attachments.map((item) => ({ ...item, feedbackId, replyId: reply.id })),
      })
    }

    return tx.feedback.update({
      where: { id: feedbackId },
      data: {
        status: feedback.status === 'REPLIED' ? 'PROCESSING' : feedback.status,
        adminUnread: true,
        userUnread: false,
        lastReplyAt: now,
        lastUserReplyAt: now,
      },
      include: feedbackInclude,
    })
  })

  void emitRealtimeToAdmins('feedback', { feedbackId })
  return NextResponse.json({ feedback: serializeFeedback(updated, { includeContact: true }), message: '回复已发送' })
}
