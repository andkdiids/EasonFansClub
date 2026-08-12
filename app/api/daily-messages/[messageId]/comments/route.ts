import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { emitRealtime } from '@/lib/realtime'
import { getPublicUserDisplayName, loadFriendRemarkMap, resolveFriendDisplayName } from '@/lib/friend-remarks'
import { containsSensitiveContent, requireUser, sanitizeText } from '@/lib/security'
import { formatBeijingDate } from '@/lib/checkin'

type RouteContext = { params: Promise<{ messageId: string }> }

const COMMENT_PAGE_SIZE = 80

export async function GET(_request: Request, context: RouteContext) {
  const viewer = await getCurrentUser()
  const { messageId } = await context.params
  const comments = await prisma.dailyMessageComment.findMany({
    where: { messageId, isDeleted: false },
    orderBy: { createdAt: 'asc' },
    take: COMMENT_PAGE_SIZE,
    include: {
      User: { select: { id: true, uid: true, nickname: true, avatarUrl: true, level: true, Profile: { select: { displayName: true, avatarUrl: true } } } },
    },
  })

  const remarkMap = await loadFriendRemarkMap(viewer?.id, comments.map((comment) => comment.User.id))
  return NextResponse.json({ comments: comments.map((comment) => ({
    ...comment,
    User: comment.User.Profile ? {
      ...comment.User,
      Profile: {
        ...comment.User.Profile,
        displayName: resolveFriendDisplayName({
          viewerId: viewer?.id,
          targetUserId: comment.User.id,
          fallbackName: getPublicUserDisplayName(comment.User),
          remarkMap,
        }),
      },
    } : comment.User,
  })) }, { headers: viewer ? { 'Cache-Control': 'private, no-store, max-age=0', Vary: 'Cookie' } : { Vary: 'Cookie' } })
}

export async function POST(request: Request, context: RouteContext) {
  const guard = await requireUser()
  if (!guard.user) return guard.response

  const { messageId } = await context.params
  const body = await request.json().catch(() => null)
  const content = sanitizeText(body?.content, 300)
  const parentId = sanitizeText(body?.parentId, 80)

  if (!content) {
    return NextResponse.json({ message: '评论内容不能为空' }, { status: 400 })
  }
  if (await containsSensitiveContent(content)) {
    return NextResponse.json({ message: '内容包含违禁词，无法发布' }, { status: 400 })
  }

  let parentComment: { id: string; authorId: string; messageId: string } | null = null
  if (parentId) {
    parentComment = await prisma.dailyMessageComment.findFirst({
      where: { id: parentId, messageId, isDeleted: false },
      select: { id: true, authorId: true, messageId: true },
    })
    if (!parentComment) {
      return NextResponse.json({ message: '不能回复不存在或已删除的评论' }, { status: 400 })
    }
  }

  let notifiedUserId: string | null = null
  const comment = await prisma.$transaction(async (tx) => {
    const dailyMessage = await tx.dailyMessage.findUnique({
      where: { id: messageId },
      select: { userId: true, date: true },
    })
    if (!dailyMessage) throw new Error('message not found')

    const created = await tx.dailyMessageComment.create({
      data: {
        messageId,
        authorId: guard.user.id,
        content,
        parentId: parentId || null,
      },
      include: { User: { select: { id: true, uid: true, nickname: true, avatarUrl: true, level: true, Profile: { select: { displayName: true, avatarUrl: true } } } } },
    })

    await tx.dailyMessage.update({
      where: { id: messageId },
      data: { commentCount: { increment: 1 } },
    })

    const recipientId = parentComment?.authorId || dailyMessage.userId
    if (recipientId !== guard.user.id) {
      notifiedUserId = recipientId
      await tx.notification.create({
        data: {
          recipientId,
          actorId: guard.user.id,
          type: 'REPLY',
          title: parentComment ? '有人回复了你的评论' : '你的每日留言有新评论',
          content: parentComment
            ? `${guard.user.nickname} 回复了你的评论`
            : `${guard.user.nickname} 评论了你的挂号留言`,
          link: `/checkin?date=${formatBeijingDate(dailyMessage.date)}&message=${messageId}&focus=${created.id}`,
        },
      })
    }

    return created
  })

  if (notifiedUserId) emitRealtime(notifiedUserId, 'notification')
  return NextResponse.json({ comment }, { status: 201 })
}
