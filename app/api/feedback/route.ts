import { NextResponse } from 'next/server'
import { createHash } from 'node:crypto'
import { Prisma } from '@prisma/client'
import { FEEDBACK_DESCRIPTION_MIN_LENGTH, FEEDBACK_MAX_ATTACHMENTS, feedbackInclude, feedbackListSelect, parseFeedbackAttachments, parseFeedbackStatusFilter, parseFeedbackType, serializeFeedback, serializeFeedbackListItem } from '@/lib/feedback'
import { prisma } from '@/lib/prisma'
import { emitRealtimeToAdmins } from '@/lib/realtime'
import { safeDb } from '@/lib/db-timeout'
import { formatBeijingMonthDayTime } from '@/lib/beijing-time'
import { getClientIp, rateLimit, requireUser, sanitizeText } from '@/lib/security'
import { BANNED_WORD_MESSAGE, CONTENT_CONTAINS_BANNED_WORD, checkBannedWords } from '@/lib/content-moderation'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const guard = await requireUser()
  if (!guard.user) return guard.response
  const { searchParams } = new URL(request.url)
  const statusFilter = parseFeedbackStatusFilter(searchParams.get('status'))

  const feedbacks = await safeDb('Feedback.findMany user', prisma.feedback.findMany({
    where: { userId: guard.user.id, ...(statusFilter ? { status: { in: statusFilter } } : {}) },
    orderBy: [{ lastReplyAt: 'desc' }, { createdAt: 'desc' }],
    take: 50,
    select: feedbackListSelect,
  }), [], 8000)

  return NextResponse.json({ feedbacks: feedbacks.map((feedback) => serializeFeedbackListItem(feedback)) })
}

export async function POST(request: Request) {
  const guard = await requireUser()
  if (!guard.user) return guard.response

  const idempotencyKey = request.headers.get('Idempotency-Key')?.trim() || ''
  if (idempotencyKey.length < 16 || idempotencyKey.length > 128) return NextResponse.json({ message: '提交标识无效，请刷新后重试' }, { status: 400 })
  const idempotencyKeyHash = createHash('sha256').update(`${guard.user.id}:${idempotencyKey}`).digest('hex')
  const replay = await prisma.feedback.findUnique({ where: { idempotencyKeyHash }, include: feedbackInclude })
  if (replay) return NextResponse.json({ feedback: serializeFeedback(replay, { includeContact: true }), message: '反馈已提交', replayed: true })

  const limited = await rateLimit(getClientIp(request), 'feedback:create', 10, 60 * 60)
  if (limited) return limited

  const body = await request.json().catch(() => null)
  const rawTitle = typeof body?.title === 'string' ? body.title : ''
  const rawContent = typeof (body?.description ?? body?.content) === 'string' ? String(body?.description ?? body?.content) : ''
  const rawContact = typeof body?.contact === 'string' ? body.contact : ''
  if (rawTitle.length > 80) return NextResponse.json({ message: '反馈标题最多 80 个字' }, { status: 400 })
  if (rawContent.length > 3000) return NextResponse.json({ message: '反馈描述最多 3000 个字' }, { status: 400 })
  if (rawContact.length > 120) return NextResponse.json({ message: '联系方式最多 120 个字' }, { status: 400 })
  const title = sanitizeText(body?.title, 80)
  const content = sanitizeText(body?.description ?? body?.content, 3000)
  const contact = sanitizeText(body?.contact, 120)
  const type = parseFeedbackType(body?.type ?? body?.category)
  const attachments = parseFeedbackAttachments(body?.attachments)
  if ((await checkBannedWords(`${title}\n${content}`)).blocked) return NextResponse.json({ error: CONTENT_CONTAINS_BANNED_WORD, message: BANNED_WORD_MESSAGE }, { status: 400 })

  if (!title) return NextResponse.json({ message: '请填写反馈标题', errors: { title: '请填写反馈标题' } }, { status: 400 })
  if (!type) return NextResponse.json({ message: '请选择反馈分类', errors: { type: '请选择反馈分类' } }, { status: 400 })
  if (!content || content.trim().length < FEEDBACK_DESCRIPTION_MIN_LENGTH) return NextResponse.json({ message: `反馈描述至少需要 ${FEEDBACK_DESCRIPTION_MIN_LENGTH} 个字`, errors: { description: `反馈描述至少需要 ${FEEDBACK_DESCRIPTION_MIN_LENGTH} 个字` } }, { status: 400 })
  if (attachments.length > FEEDBACK_MAX_ATTACHMENTS) return NextResponse.json({ message: `最多只能上传 ${FEEDBACK_MAX_ATTACHMENTS} 张图片` }, { status: 400 })

  const now = new Date()
  let feedback
  try {
    feedback = await prisma.$transaction(async (tx) => {
    const created = await tx.feedback.create({
      data: {
        userId: guard.user.id,
        title,
        type,
        content,
        contact: contact || null,
        status: 'OPEN',
        adminUnread: true,
        userUnread: false,
        lastReplyAt: now,
        lastUserReplyAt: now,
        idempotencyKeyHash,
      },
      select: { id: true },
    })

    const message = await tx.feedbackReply.create({
      data: {
        feedbackId: created.id,
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
        data: attachments.map((item) => ({ ...item, feedbackId: created.id, replyId: message.id })),
      })
    }

    const administrators = await tx.user.findMany({
      where: { role: { in: ['ADMIN', 'SUPER_ADMIN'] }, status: 'ACTIVE', isDeleted: false },
      select: { id: true },
    })
    if (administrators.length) {
      await tx.notification.createMany({
        data: administrators.map((administrator) => ({
          recipientId: administrator.id,
          actorId: guard.user.id,
          type: 'ADMIN' as const,
          title: '收到新的用户反馈',
          content: `用户昵称：${guard.user.nickname}\n反馈标题：${title}\n提交时间：${formatBeijingMonthDayTime(now)}`,
          link: '/admin/feedback',
          key: `feedback-new:${created.id}`,
        })),
        skipDuplicates: true,
      })
    }

    return tx.feedback.findUniqueOrThrow({
      where: { id: created.id },
      include: feedbackInclude,
    })
    })
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      feedback = await prisma.feedback.findUnique({ where: { idempotencyKeyHash }, include: feedbackInclude })
      if (feedback) return NextResponse.json({ feedback: serializeFeedback(feedback, { includeContact: true }), message: '反馈已提交', replayed: true })
    }
    throw error
  }

  void emitRealtimeToAdmins('feedback', { feedbackId: feedback.id })
  return NextResponse.json({ feedback: serializeFeedback(feedback, { includeContact: true }), message: '反馈已提交' }, { status: 201 })
}
