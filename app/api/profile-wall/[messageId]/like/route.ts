import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

export async function POST(_request: Request, { params }: { params: Promise<{ messageId: string }> }) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ message: '请先登录' }, { status: 401 })
  const { messageId } = await params

  const message = await prisma.profileWallMessage.findFirst({
    where: { id: messageId, deletedAt: null },
    select: { id: true, senderId: true, User_ProfileWallMessage_receiverIdToUser: { select: { uid: true } } },
  })
  if (!message) return NextResponse.json({ message: '该留言已被删除或无法查看' }, { status: 404 })

  const result = await prisma.$transaction(async (tx) => {
    const existing = await tx.profileWallLike.findUnique({
      where: { messageId_userId: { messageId, userId: user.id } },
      select: { id: true },
    })
    if (existing) {
      await tx.profileWallLike.delete({ where: { id: existing.id } })
    } else {
      await tx.profileWallLike.create({ data: { messageId, userId: user.id } })
      if (message.senderId !== user.id) {
        await tx.notification.create({
          data: {
            recipientId: message.senderId,
            actorId: user.id,
            type: 'LIKE',
            title: '有人赞了你的留言',
            content: `${user.nickname} 赞了你的留言`,
            link: `/user/${String(message.User_ProfileWallMessage_receiverIdToUser.uid).padStart(5, '0')}/wall?focus=${messageId}`,
          },
        })
      }
    }
    const likeCount = await tx.profileWallLike.count({ where: { messageId } })
    await tx.profileWallMessage.update({ where: { id: messageId }, data: { likeCount } })
    return { liked: !existing, likeCount }
  })

  return NextResponse.json(result)
}
