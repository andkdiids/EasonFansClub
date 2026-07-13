import { NextResponse } from 'next/server'
import { feedbackInclude, feedbackListSelect, parseFeedbackAttachments, parseFeedbackType, serializeFeedback, serializeFeedbackListItem } from '@/lib/feedback'
import { prisma } from '@/lib/prisma'
import { filterSensitiveWords, getClientIp, rateLimit, requireUser, sanitizeText } from '@/lib/security'

export const dynamic = 'force-dynamic'

export async function GET() {
  const guard = await requireUser()
  if (!guard.user) return guard.response

  const feedbacks = await prisma.feedback.findMany({
    where: { userId: guard.user.id },
    orderBy: [{ lastReplyAt: 'desc' }, { createdAt: 'desc' }],
    take: 50,
    select: feedbackListSelect,
  })

  return NextResponse.json({ feedbacks: feedbacks.map(serializeFeedbackListItem) })
}

export async function POST(request: Request) {
  const guard = await requireUser()
  if (!guard.user) return guard.response

  const limited = await rateLimit(getClientIp(request), 'feedback:create', 10, 60 * 60)
  if (limited) return limited

  const body = await request.json().catch(() => null)
  const title = sanitizeText(body?.title, 80)
  const content = await filterSensitiveWords(sanitizeText(body?.description ?? body?.content, 3000))
  const contact = sanitizeText(body?.contact, 120)
  const type = parseFeedbackType(body?.type ?? body?.category)
  const attachments = parseFeedbackAttachments(body?.attachments)

  if (!title) return NextResponse.json({ message: '请填写反馈标题' }, { status: 400 })
  if (!type) return NextResponse.json({ message: '请选择反馈分类' }, { status: 400 })
  if (!content || content.length < 8) return NextResponse.json({ message: '请填写更完整的反馈描述' }, { status: 400 })
  if (attachments.length > 5) return NextResponse.json({ message: '最多只能上传 5 张图片' }, { status: 400 })

  const feedback = await prisma.feedback.create({
    data: {
      userId: guard.user.id,
      title,
      type,
      content,
      contact: contact || null,
      status: 'OPEN',
      adminUnread: true,
      userUnread: false,
      lastReplyAt: new Date(),
      lastUserReplyAt: new Date(),
      attachments: attachments.length ? { createMany: { data: attachments } } : undefined,
    },
    include: feedbackInclude,
  })

  return NextResponse.json({ feedback: serializeFeedback(feedback, { includeContact: true }), message: '反馈已提交' }, { status: 201 })
}
