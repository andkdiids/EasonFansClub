import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireUser } from '@/lib/security'

type RouteContext = { params: Promise<{ replyId: string }> }

export async function POST(_request: Request, context: RouteContext) {
  const guard = await requireUser()
  if (!guard.user) return guard.response

  const { replyId } = await context.params
  const result = await prisma.$transaction(async (tx) => {
    const reply = await tx.reply.findFirst({
      where: { id: replyId, isDeleted: false },
      select: { id: true, authorId: true, postId: true },
    })
    if (!reply) return null

    const existing = await tx.replyLike.findUnique({
      where: { replyId_userId: { replyId, userId: guard.user.id } },
    })

    if (existing) {
      await tx.replyLike.delete({ where: { id: existing.id } })
    } else {
      await tx.replyLike.create({ data: { replyId, userId: guard.user.id } })
      if (reply.authorId !== guard.user.id) {
        await tx.notification.create({
          data: {
            recipientId: reply.authorId,
            actorId: guard.user.id,
            type: 'LIKE',
            title: '你的回复收到点赞',
            content: `${guard.user.nickname} 点赞了你的回复`,
            link: `/posts/${reply.postId}?focus=${reply.id}`,
          },
        })
      }
    }

    const likeCount = await tx.replyLike.count({ where: { replyId } })
    await tx.reply.update({ where: { id: replyId }, data: { likeCount } })
    return { isLiked: !existing, likeCount }
  })

  if (!result) return NextResponse.json({ message: '回复不存在' }, { status: 404 })
  return NextResponse.json(result)
}

export async function DELETE(_request: Request, context: RouteContext) {
  const guard = await requireUser()
  if (!guard.user) return guard.response

  const { replyId } = await context.params
  const result = await prisma.$transaction(async (tx) => {
    const reply = await tx.reply.findFirst({
      where: { id: replyId, isDeleted: false },
      select: { id: true },
    })
    if (!reply) return null

    await tx.replyLike.deleteMany({ where: { replyId, userId: guard.user.id } })
    const likeCount = await tx.replyLike.count({ where: { replyId } })
    await tx.reply.update({ where: { id: replyId }, data: { likeCount } })
    return { isLiked: false, likeCount }
  })

  if (!result) return NextResponse.json({ message: '回复不存在' }, { status: 404 })
  return NextResponse.json(result)
}
