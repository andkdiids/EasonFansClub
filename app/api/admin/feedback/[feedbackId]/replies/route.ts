import { NextResponse } from 'next/server'
import { feedbackInclude, parseFeedbackAttachments, serializeFeedback } from '@/lib/feedback'
import { prisma } from '@/lib/prisma'
import { emitRealtime } from '@/lib/realtime'
import { requireAdmin } from '@/lib/security'
import { BANNED_WORD_MESSAGE, CONTENT_CONTAINS_BANNED_WORD, checkBannedWords } from '@/lib/content-moderation'
import { safeNotificationWrite } from '@/lib/notification-transaction'
import { createNotification } from '@/lib/notification-write'
import { getReplyLengthMetrics, replyTooLongPayload } from '@/lib/reply-length'

export async function POST(request: Request, { params }: { params: Promise<{ feedbackId: string }> }) {
  const guard = await requireAdmin('feedback_manage')
  if (!guard.user) return guard.response

  const { feedbackId } = await params
  const body = await request.json().catch(() => null)
  const contentLength = getReplyLengthMetrics(body?.content)
  if (contentLength.exceededBy > 0) return NextResponse.json({ ok: false, ...replyTooLongPayload(contentLength) }, { status: 400 })
  const content = contentLength.content
  const attachments = parseFeedbackAttachments(body?.attachments)

  if (!content && attachments.length === 0) {
    return NextResponse.json({ message: '请填写回复内容或上传图片' }, { status: 400 })
  }
  if ((await checkBannedWords(content)).blocked) {
    return NextResponse.json({ error: CONTENT_CONTAINS_BANNED_WORD, message: BANNED_WORD_MESSAGE }, { status: 400 })
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
  const transactionResult = await prisma.$transaction(async (tx) => {
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

    const updated = await tx.feedback.update({
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
    return { updated, replyId: reply.id }
  }, { timeout: 15_000, maxWait: 5_000 })

  const { updated, replyId } = transactionResult
  await safeNotificationWrite(
    () => createNotification({
      data: {
        type: 'FEEDBACK',
        title: '你的反馈收到回复',
        content: '管理员回复了你的反馈。',
        link: `/feedback/${feedback.id}?focus=${replyId}`,
        recipientId: feedback.userId,
        actorId: guard.user.id,
        key: `feedback-reply:${feedback.id}:${replyId}`,
      },
    }),
    { operation: 'admin-feedback-reply', userId: feedback.userId, notificationType: 'FEEDBACK' },
  )
  emitRealtime(feedback.userId, 'feedback', { feedbackId })
  return NextResponse.json({ feedback: serializeFeedback(updated, { includeContact: true, forAdmin: true }), message: '回复已发送' })
}
