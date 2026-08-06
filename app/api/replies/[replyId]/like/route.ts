import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireUser } from '@/lib/security'

type RouteContext = { params: Promise<{ replyId: string }> }

// 点赞用户列表：供 LikeAvatars 组件展开「全部点赞用户」时懒加载。
export async function GET(_request: Request, context: RouteContext) {
  const guard = await requireUser()
  if (!guard.user) return guard.response

  const { replyId } = await context.params
  const likes = await prisma.replyLike.findMany({
    where: { replyId, Reply: { isDeleted: false } },
    orderBy: { createdAt: 'desc' },
    take: 50,
    select: {
      User: {
        select: {
          uid: true,
          nickname: true,
          avatarUrl: true,
          Profile: { select: { displayName: true, avatarUrl: true } },
        },
      },
    },
  })
  return NextResponse.json({
    likers: likes.map((like) => ({
      uid: like.User.uid,
      nickname: like.User.nickname,
      displayName: like.User.Profile?.displayName || null,
      avatarUrl: like.User.Profile?.avatarUrl || like.User.avatarUrl || null,
    })),
  })
}

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
