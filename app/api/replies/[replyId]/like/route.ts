import { NextResponse } from 'next/server'
import { getPublicUserDisplayName } from '@/lib/friend-remarks'
import { publicImageUrl } from '@/lib/images'
import { prisma } from '@/lib/prisma'
import { emitRealtime } from '@/lib/realtime'
import { enforceApiRateLimit, requireUser } from '@/lib/security'
import { syncLikeNotification, type LikeNotificationSyncInput } from '@/lib/like-notifications'
import { logNotificationError } from '@/lib/notification-errors'
import { getEquippedBadgesForUsers } from '@/lib/badge-service'

type RouteContext = { params: Promise<{ replyId: string }> }

// 点赞用户列表：供 LikeAvatars 组件展开「全部点赞用户」时懒加载。
export async function GET(request: Request, context: RouteContext) {
  const guard = await requireUser()
  if (!guard.user) return guard.response
  const limited = await enforceApiRateLimit(request, guard.user.id, {
    endpoint: '/api/replies/like',
    user: { limit: 120, windowSeconds: 60 },
  })
  if (limited) return limited

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
  const equippedBadgeMap = await getEquippedBadgesForUsers(likes.map((like) => like.User.id))
  return NextResponse.json({
    likers: likes.map((like) => ({
      id: like.User.id,
      uid: like.User.uid,
      nickname: getPublicUserDisplayName(like.User),
      friendRemark: null,
      displayName: getPublicUserDisplayName(like.User),
      avatarUrl: publicImageUrl(like.User.Profile?.avatarUrl || like.User.avatarUrl),
      equippedBadge: equippedBadgeMap.get(like.User.id) || null,
    })),
  })
}

export async function POST(request: Request, context: RouteContext) {
  const guard = await requireUser()
  if (!guard.user) return guard.response
  const limited = await enforceApiRateLimit(request, guard.user.id, {
    ip: { limit: 120, windowSeconds: 60 },
    user: { limit: 60, windowSeconds: 60 },
    endpoint: '/api/replies/like',
  }, '点赞操作过于频繁，请稍后再试')
  if (limited) return limited

  const { replyId } = await context.params
  let notificationInput: LikeNotificationSyncInput | null = null
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
      notificationInput = {
        recipientId: reply.authorId,
        actorId: guard.user.id,
        actorName: guard.user.nickname,
        target: { kind: 'reply', id: reply.id, link: `/posts/${reply.postId}?focus=${reply.id}` },
      }
    }
    return {
      isLiked: !existing,
      likeCount,
      notifiedUserId: reply.authorId !== guard.user.id ? reply.authorId : null,
    }
  }, { timeout: 15_000, maxWait: 5_000 })

  if (!result) return NextResponse.json({ message: '回复不存在' }, { status: 404 })
  if (notificationInput) {
    const input = notificationInput as LikeNotificationSyncInput
    const recipientId = result.notifiedUserId
    void syncLikeNotification(input)
      .catch((error) => logNotificationError('like-notification-background', { userId: input.recipientId, notificationType: 'LIKE' }, error))
      .finally(() => {
        if (!recipientId) return
        try { emitRealtime(recipientId, 'notification') } catch (error) {
          logNotificationError('like-notification-realtime', { userId: recipientId, notificationType: 'LIKE' }, error)
        }
      })
  } else if (result.notifiedUserId) {
    emitRealtime(result.notifiedUserId, 'notification')
  }
  return NextResponse.json(result)
}

export async function DELETE(request: Request, context: RouteContext) {
  const guard = await requireUser()
  if (!guard.user) return guard.response
  const limited = await enforceApiRateLimit(request, guard.user.id, {
    ip: { limit: 120, windowSeconds: 60 },
    user: { limit: 60, windowSeconds: 60 },
    endpoint: '/api/replies/like',
  }, '点赞操作过于频繁，请稍后再试')
  if (limited) return limited

  const { replyId } = await context.params
  let notificationInput: LikeNotificationSyncInput | null = null
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
      notificationInput = {
        recipientId: reply.authorId,
        actorId: guard.user.id,
        target: { kind: 'reply', id: reply.id, link: `/posts/${reply.postId}?focus=${reply.id}` },
      }
    }
    return {
      isLiked: false,
      likeCount,
      notifiedUserId: reply.authorId !== guard.user.id ? reply.authorId : null,
    }
  }, { timeout: 15_000, maxWait: 5_000 })

  if (!result) return NextResponse.json({ message: '回复不存在' }, { status: 404 })
  if (notificationInput) {
    const input = notificationInput as LikeNotificationSyncInput
    const recipientId = result.notifiedUserId
    void syncLikeNotification(input)
      .catch((error) => logNotificationError('like-notification-background', { userId: input.recipientId, notificationType: 'LIKE' }, error))
      .finally(() => {
        if (!recipientId) return
        try { emitRealtime(recipientId, 'notification') } catch (error) {
          logNotificationError('like-notification-realtime', { userId: recipientId, notificationType: 'LIKE' }, error)
        }
      })
  } else if (result.notifiedUserId) {
    emitRealtime(result.notifiedUserId, 'notification')
  }
  return NextResponse.json(result)
}
