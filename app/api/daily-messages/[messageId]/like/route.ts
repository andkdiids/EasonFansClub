import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireUser } from '@/lib/security'

type RouteContext = { params: Promise<{ messageId: string }> }

export async function POST(_request: Request, context: RouteContext) {
  const guard = await requireUser()
  if (!guard.user) return guard.response

  const { messageId } = await context.params
  const result = await prisma.$transaction(async (tx) => {
    const message = await tx.dailyMessage.findFirst({
      where: { id: messageId, isDeleted: false },
      select: { id: true, userId: true },
    })
    if (!message) return null

    const existing = await tx.dailyMessageLike.findUnique({
      where: { messageId_userId: { messageId, userId: guard.user.id } },
    })

    if (existing) {
      await tx.dailyMessageLike.delete({ where: { id: existing.id } })
    } else {
      await tx.dailyMessageLike.create({ data: { messageId, userId: guard.user.id } })
      if (message.userId !== guard.user.id) {
        await tx.notification.create({
          data: {
            recipientId: message.userId,
            actorId: guard.user.id,
            type: 'LIKE',
            title: '你的每日留言收到点赞',
            content: `${guard.user.nickname} 点赞了你的挂号留言`,
            link: '/checkin',
          },
        })
      }
    }

    const likeCount = await tx.dailyMessageLike.count({ where: { messageId } })
    await tx.dailyMessage.update({ where: { id: messageId }, data: { likeCount } })
    return { isLiked: !existing, likeCount }
  })

  if (!result) return NextResponse.json({ message: '留言不存在' }, { status: 404 })
  return NextResponse.json(result)
}

export async function DELETE(_request: Request, context: RouteContext) {
  const guard = await requireUser()
  if (!guard.user) return guard.response

  const { messageId } = await context.params
  const result = await prisma.$transaction(async (tx) => {
    const message = await tx.dailyMessage.findFirst({
      where: { id: messageId, isDeleted: false },
      select: { id: true },
    })
    if (!message) return null

    await tx.dailyMessageLike.deleteMany({ where: { messageId, userId: guard.user.id } })
    const likeCount = await tx.dailyMessageLike.count({ where: { messageId } })
    await tx.dailyMessage.update({ where: { id: messageId }, data: { likeCount } })
    return { isLiked: false, likeCount }
  })

  if (!result) return NextResponse.json({ message: '留言不存在' }, { status: 404 })
  return NextResponse.json(result)
}
