import { NextResponse } from 'next/server'
import { getPublicUserDisplayName, loadFriendRemarkMap, resolveFriendDisplayName } from '@/lib/friend-remarks'
import { publicImageUrl } from '@/lib/images'
import { prisma } from '@/lib/prisma'
import { emitRealtime } from '@/lib/realtime'
import { requireUser } from '@/lib/security'
import { syncLikeNotification } from '@/lib/like-notifications'

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
          id: true,
          uid: true,
          nickname: true,
          usernameModerationStatus: true,
          nicknameModerationStatus: true,
          nicknameViolationDisplay: true,
          avatarUrl: true,
          Profile: { select: { displayName: true, displayNameModerationStatus: true, avatarUrl: true } },
        },
      },
    },
  })
  const remarkMap = await loadFriendRemarkMap(guard.user.id, likes.map((like) => like.User.id))
  return NextResponse.json({
    likers: likes.map((like) => ({
      uid: like.User.uid,
      nickname: getPublicUserDisplayName(like.User),
      displayName: resolveFriendDisplayName({
        viewerId: guard.user.id,
        targetUserId: like.User.id,
        fallbackName: getPublicUserDisplayName(like.User),
        remarkMap,
      }),
      avatarUrl: publicImageUrl(like.User.Profile?.avatarUrl || like.User.avatarUrl),
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
    }

    const likeCount = await tx.replyLike.count({ where: { replyId } })
    await tx.reply.update({ where: { id: replyId }, data: { likeCount } })
    if (reply.authorId !== guard.user.id) {
      await syncLikeNotification(tx, {
        recipientId: reply.authorId,
        actorId: guard.user.id,
        actorName: guard.user.nickname,
        target: { kind: 'reply', id: reply.id, link: `/posts/${reply.postId}?focus=${reply.id}` },
      }, existing ? 'unlike' : 'like')
    }
    return {
      isLiked: !existing,
      likeCount,
      notifiedUserId: reply.authorId !== guard.user.id ? reply.authorId : null,
    }
  })

  if (!result) return NextResponse.json({ message: '回复不存在' }, { status: 404 })
  if (result.notifiedUserId) emitRealtime(result.notifiedUserId, 'notification')
  return NextResponse.json(result)
}

export async function DELETE(_request: Request, context: RouteContext) {
  const guard = await requireUser()
  if (!guard.user) return guard.response

  const { replyId } = await context.params
  const result = await prisma.$transaction(async (tx) => {
    const reply = await tx.reply.findFirst({
      where: { id: replyId, isDeleted: false },
      select: { id: true, authorId: true, postId: true },
    })
    if (!reply) return null

    await tx.replyLike.deleteMany({ where: { replyId, userId: guard.user.id } })
    const likeCount = await tx.replyLike.count({ where: { replyId } })
    await tx.reply.update({ where: { id: replyId }, data: { likeCount } })
    if (reply.authorId !== guard.user.id) {
      await syncLikeNotification(tx, {
        recipientId: reply.authorId,
        actorId: guard.user.id,
        target: { kind: 'reply', id: reply.id, link: `/posts/${reply.postId}?focus=${reply.id}` },
      }, 'unlike')
    }
    return {
      isLiked: false,
      likeCount,
      notifiedUserId: reply.authorId !== guard.user.id ? reply.authorId : null,
    }
  })

  if (!result) return NextResponse.json({ message: '回复不存在' }, { status: 404 })
  if (result.notifiedUserId) emitRealtime(result.notifiedUserId, 'notification')
  return NextResponse.json(result)
}
