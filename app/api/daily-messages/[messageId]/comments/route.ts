import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { filterSensitiveWords, requireUser, sanitizeText } from '@/lib/security'

type RouteContext = { params: Promise<{ messageId: string }> }

const COMMENT_PAGE_SIZE = 50
const CHILD_COMMENT_PREVIEW_SIZE = 10

export async function GET(_request: Request, context: RouteContext) {
  const { messageId } = await context.params
  const comments = await prisma.dailyMessageComment.findMany({
    where: { messageId, isDeleted: false, parentId: null },
    orderBy: { createdAt: 'desc' },
    take: COMMENT_PAGE_SIZE,
    include: {
      author: { select: { id: true, uid: true, nickname: true, avatarUrl: true, level: true, profile: { select: { displayName: true, avatarUrl: true } } } },
      children: {
        where: { isDeleted: false },
        orderBy: { createdAt: 'asc' },
        take: CHILD_COMMENT_PREVIEW_SIZE,
        include: { author: { select: { id: true, uid: true, nickname: true, level: true, profile: { select: { displayName: true, avatarUrl: true } } } } },
      },
    },
  })

  return NextResponse.json({ comments })
}

export async function POST(request: Request, context: RouteContext) {
  const guard = await requireUser()
  if (!guard.user) return guard.response

  const { messageId } = await context.params
  const body = await request.json().catch(() => null)
  const content = await filterSensitiveWords(sanitizeText(body?.content, 300))
  const parentId = sanitizeText(body?.parentId, 80)

  if (!content) {
    return NextResponse.json({ message: '评论内容不能为空' }, { status: 400 })
  }

  const comment = await prisma.$transaction(async (tx) => {
    const dailyMessage = await tx.dailyMessage.findUnique({
      where: { id: messageId },
      select: { userId: true },
    })
    if (!dailyMessage) throw new Error('message not found')

    const created = await tx.dailyMessageComment.create({
      data: {
        messageId,
        authorId: guard.user.id,
        content,
        parentId: parentId || null,
      },
      include: { author: { select: { id: true, uid: true, nickname: true, avatarUrl: true, level: true, profile: { select: { displayName: true, avatarUrl: true } } } } },
    })

    await tx.dailyMessage.update({
      where: { id: messageId },
      data: { commentCount: { increment: 1 } },
    })

    if (dailyMessage.userId !== guard.user.id) {
      await tx.notification.create({
        data: {
          recipientId: dailyMessage.userId,
          actorId: guard.user.id,
          type: 'REPLY',
          title: '你的每日留言有新评论',
          content: `${guard.user.nickname} 评论了你的挂号留言`,
          link: '/checkin',
        },
      })
    }

    return created
  })

  return NextResponse.json({ comment }, { status: 201 })
}
