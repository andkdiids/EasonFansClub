import { NextResponse } from 'next/server'
import type { Prisma } from '@prisma/client'
import { getCurrentUser } from '@/lib/auth'
import { getPublicUserDisplayName, loadFriendRemarkMap, resolveFriendDisplayName } from '@/lib/friend-remarks'
import { publicImageUrl } from '@/lib/images'
import { prisma } from '@/lib/prisma'
import { emitRealtime } from '@/lib/realtime'
import { getEquippedBadgesForUsers } from '@/lib/badge-service'
import { unauthenticatedResponse } from '@/lib/security'
import { safeNotificationWrite } from '@/lib/notification-transaction'

// 点赞用户列表：供 LikeAvatars 组件展开「全部点赞用户」时懒加载。
export async function GET(_request: Request, { params }: { params: Promise<{ messageId: string }> }) {
  const user = await getCurrentUser()
  if (!user) return unauthenticatedResponse()
  const { messageId } = await params

  const message = await prisma.profileWallMessage.findFirst({
    where: { id: messageId, deletedAt: null },
    select: { id: true, receiverId: true },
  })
  if (!message) return NextResponse.json({ message: '该留言已被删除或无法查看' }, { status: 404 })

  // 仅墙主人（receiver）可查看点赞者具体身份；他人仅能点赞，不可枚举点赞者。
  if (message.receiverId !== user.id) {
    return NextResponse.json({ likers: [] })
  }

  const likes = await prisma.profileWallLike.findMany({
    where: { messageId, ProfileWallMessage: { deletedAt: null } },
    orderBy: { createdAt: 'desc' },
    take: 50,
    select: {
      userId: true,
      User: {
        select: {
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
  const remarkMap = await loadFriendRemarkMap(user.id, likes.map((like) => like.userId))
  const equippedBadgeMap = await getEquippedBadgesForUsers(likes.map((like) => like.userId))
  return NextResponse.json({
    likers: likes.map((like) => ({
      uid: like.User.uid,
      nickname: getPublicUserDisplayName(like.User),
      displayName: resolveFriendDisplayName({
        viewerId: user.id,
        targetUserId: like.userId,
        fallbackName: getPublicUserDisplayName(like.User),
        remarkMap,
      }),
      avatarUrl: publicImageUrl(like.User.Profile?.avatarUrl || like.User.avatarUrl),
      equippedBadge: equippedBadgeMap.get(like.userId) || null,
    })),
  })
}

export async function POST(_request: Request, { params }: { params: Promise<{ messageId: string }> }) {
  const user = await getCurrentUser()
  if (!user) return unauthenticatedResponse()
  const { messageId } = await params

  const message = await prisma.profileWallMessage.findFirst({
    where: { id: messageId, deletedAt: null },
    select: { id: true, senderId: true, User_ProfileWallMessage_receiverIdToUser: { select: { uid: true } } },
  })
  if (!message) return NextResponse.json({ message: '该留言已被删除或无法查看' }, { status: 404 })

  let notificationData: Prisma.NotificationCreateArgs | null = null
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
        notificationData = {
          data: {
            recipientId: message.senderId,
            actorId: user.id,
            type: 'LIKE',
            title: '有人赞了你的留言',
            content: `${user.nickname} 赞了你的留言`,
            link: `/user/${String(message.User_ProfileWallMessage_receiverIdToUser.uid).padStart(5, '0')}/wall?focus=${messageId}`,
          },
        }
      }
    }
    const likeCount = await tx.profileWallLike.count({ where: { messageId } })
    await tx.profileWallMessage.update({ where: { id: messageId }, data: { likeCount } })
    return { liked: !existing, likeCount, notifiedUserId: !existing && message.senderId !== user.id ? message.senderId : null }
  }, { timeout: 15_000, maxWait: 5_000 })

  const committedNotificationData = notificationData as Prisma.NotificationCreateArgs | null
  if (committedNotificationData) {
    await safeNotificationWrite(
      () => prisma.notification.create(committedNotificationData),
      { operation: 'profile-wall-like-notification', userId: committedNotificationData.data.recipientId, notificationType: 'LIKE' },
    )
  }
  if (result.notifiedUserId) emitRealtime(result.notifiedUserId, 'notification')
  return NextResponse.json(result)
}
