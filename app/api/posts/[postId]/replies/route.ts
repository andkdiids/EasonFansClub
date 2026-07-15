import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import { awardExperience } from '@/lib/growth'
import { POINTS } from '@/lib/points'
import { prisma } from '@/lib/prisma'
import { filterSensitiveWords, sanitizeText } from '@/lib/security'

type Params = { params: Promise<{ postId: string }> }

export async function POST(request: Request, { params }: Params) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ message: '请先登录后再回复' }, { status: 401 })

  const { postId } = await params
  const body = await request.json().catch(() => null)
  const content = await filterSensitiveWords(sanitizeText(body?.content, 5000))
  const parentId = sanitizeText(body?.parentId, 80)

  if (content.length < 2) {
    return NextResponse.json({ message: '回复内容至少需要 2 个字符', errors: { content: '回复太短了' } }, { status: 400 })
  }

  const post = await prisma.post.findFirst({
    where: { id: postId, isDeleted: false, status: 'PUBLISHED' },
    select: { id: true, authorId: true },
  })
  if (!post) return NextResponse.json({ message: '帖子不存在' }, { status: 404 })

  let parentReply: { id: string; authorId: string; parentId: string | null; author: { nickname: string; profile: { displayName: string | null } | null } } | null = null
  if (parentId) {
    parentReply = await prisma.reply.findFirst({
      where: { id: parentId, postId, isDeleted: false },
      select: {
        id: true,
        authorId: true,
        parentId: true,
        author: { select: { nickname: true, profile: { select: { displayName: true } } } },
      },
    })
    if (!parentReply) {
      return NextResponse.json({ message: '不能回复不存在或已删除的评论' }, { status: 400 })
    }
  }

  const reply = await prisma.$transaction(async (tx) => {
    const currentUser = await tx.user.findFirstOrThrow({
      where: { id: user.id, status: 'ACTIVE', isDeleted: false, profile: { isNot: null } },
      select: { points: true },
    })
    const nextPoints = currentUser.points + POINTS.replyCreate

    const createdReply = await tx.reply.create({
      data: {
        postId,
        authorId: user.id,
        content,
        parentId: parentId || null,
      },
      include: {
        author: {
          select: {
            id: true,
            uid: true,
            nickname: true,
            level: true,
            avatarUrl: true,
            profile: { select: { displayName: true, avatarUrl: true } },
          },
        },
      },
    })

    await tx.post.update({
      where: { id: postId },
      data: { replyCount: { increment: 1 } },
    })

    await tx.user.update({
      where: { id: user.id },
      data: { points: nextPoints },
    })

    await awardExperience(tx, {
      userId: user.id,
      amount: POINTS.replyCreate,
      type: 'COMMENT',
      description: '回复帖子',
    })

    await tx.pointLog.create({
      data: {
        userId: user.id,
        action: 'REPLY_CREATE',
        points: POINTS.replyCreate,
        before: currentUser.points,
        after: nextPoints,
        postId,
        replyId: createdReply.id,
        reason: '回复帖子',
      },
    })

    const recipientId = parentReply?.authorId || post.authorId
    if (recipientId !== user.id) {
      await tx.notification.create({
        data: {
          recipientId,
          actorId: user.id,
          type: 'REPLY',
          title: parentReply ? '有人回复了你的评论' : '你的帖子有新回复',
          content: parentReply
            ? `${user.nickname} 回复了你的评论`
            : `${user.nickname} 回复了你的帖子`,
          link: `/posts/${postId}`,
        },
      })
    }

    return createdReply
  })

  return NextResponse.json({ reply }, { status: 201 })
}
