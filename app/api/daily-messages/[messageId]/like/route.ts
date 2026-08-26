import { NextResponse } from 'next/server'
import type { Prisma } from '@prisma/client'
import { formatBeijingDate } from '@/lib/checkin'
import { getPublicUserDisplayName } from '@/lib/friend-remarks'
import { publicImageUrl } from '@/lib/images'
import { prisma } from '@/lib/prisma'
import { emitRealtime } from '@/lib/realtime'
import { enforceApiRateLimit, requireUser } from '@/lib/security'
import { getEquippedBadgesForUsers } from '@/lib/badge-service'
import { safeNotificationWrite } from '@/lib/notification-transaction'
import { createNotification } from '@/lib/notification-write'

type RouteContext = { params: Promise<{ messageId: string }> }

const likerUserSelect = {
  id: true,
  uid: true,
  nickname: true,
  usernameModerationStatus: true,
  nicknameModerationStatus: true,
  nicknameViolationDisplay: true,
  avatarUrl: true,
  Profile: { select: { displayName: true, displayNameModerationStatus: true, avatarUrl: true } },
} as const

type LikerRow = {
  User: {
    id: string
    uid: number
    nickname: string
    avatarUrl: string | null
    Profile: { displayName: string | null; avatarUrl: string | null } | null
  }
}

function serializeLiker(row: LikerRow, equippedBadgeMap: ReadonlyMap<string, import('@/lib/badge-types').EquippedBadgeView>) {
  const nickname = getPublicUserDisplayName(row.User)
  return {
    uid: row.User.uid,
    nickname,
    displayName: nickname,
    avatarUrl: publicImageUrl(row.User.Profile?.avatarUrl || row.User.avatarUrl),
    equippedBadge: equippedBadgeMap.get(row.User.id) || null,
  }
}

// 点赞用户列表：供 LikeAvatars 组件展开「全部点赞用户」时懒加载。
export async function GET(_request: Request, context: RouteContext) {
  const guard = await requireUser()
  if (!guard.user) return guard.response
  const limited = await enforceApiRateLimit(_request, guard.user.id, {
    endpoint: '/api/daily-messages/[messageId]/like:GET',
    user: { limit: 120, windowSeconds: 60 },
  })
  if (limited) return limited

  const { messageId } = await context.params
  const likes = await prisma.dailyMessageLike.findMany({
    where: { messageId, DailyMessage: { isDeleted: false } },
    orderBy: { createdAt: 'desc' },
    take: 50,
    select: { User: { select: likerUserSelect } },
  })
  const equippedBadgeMap = await getEquippedBadgesForUsers(likes.map((like) => like.User.id))
  return NextResponse.json({ likers: likes.map((like) => serializeLiker(like, equippedBadgeMap)) })
}

export async function POST(_request: Request, context: RouteContext) {
  const guard = await requireUser()
  if (!guard.user) return guard.response
  const limited = await enforceApiRateLimit(_request, guard.user.id, {
    endpoint: '/api/daily-messages/[messageId]/like:POST',
    ip: { limit: 120, windowSeconds: 60 },
    user: { limit: 60, windowSeconds: 60 },
  })
  if (limited) return limited

  const { messageId } = await context.params
  let notificationData: Prisma.NotificationCreateArgs | null = null
  const result = await prisma.$transaction(async (tx) => {
    const message = await tx.dailyMessage.findFirst({
      where: { id: messageId, isDeleted: false },
      select: { id: true, userId: true, date: true },
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
        notificationData = {
          data: {
            recipientId: message.userId,
            actorId: guard.user.id,
            type: 'LIKE',
            title: '你的每日留言收到点赞',
            content: `${guard.user.nickname} 点赞了你的挂号留言`,
            // 带上留言日期，确保历史留言也能在挂号页正确定位（否则只加载今天的留言会找不到目标）。
            link: `/checkin?date=${formatBeijingDate(message.date)}&message=${messageId}`,
          },
        }
      }
    }

    const likeCount = await tx.dailyMessageLike.count({ where: { messageId } })
    await tx.dailyMessage.update({ where: { id: messageId }, data: { likeCount } })
    return { isLiked: !existing, likeCount, notifiedUserId: !existing && message.userId !== guard.user.id ? message.userId : null }
  }, { timeout: 15_000, maxWait: 5_000 })

  if (!result) return NextResponse.json({ message: '留言不存在' }, { status: 404 })
  const committedNotificationData = notificationData as Prisma.NotificationCreateArgs | null
  if (committedNotificationData) {
    await safeNotificationWrite(
      () => createNotification(committedNotificationData),
      { operation: 'daily-message-like-notification', userId: committedNotificationData.data.recipientId, notificationType: 'LIKE' },
    )
  }
  if (result.notifiedUserId) emitRealtime(result.notifiedUserId, 'notification')
  return NextResponse.json(result)
}

export async function DELETE(_request: Request, context: RouteContext) {
  const guard = await requireUser()
  if (!guard.user) return guard.response
  const limited = await enforceApiRateLimit(_request, guard.user.id, {
    endpoint: '/api/daily-messages/[messageId]/like:DELETE',
    ip: { limit: 120, windowSeconds: 60 },
    user: { limit: 60, windowSeconds: 60 },
  })
  if (limited) return limited

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
