import { NextResponse } from 'next/server'
import { formatBeijingDate } from '@/lib/checkin'
import { getPublicUserDisplayName, loadFriendRemarkMap, resolveFriendDisplayName } from '@/lib/friend-remarks'
import { publicImageUrl } from '@/lib/images'
import { prisma } from '@/lib/prisma'
import { emitRealtime } from '@/lib/realtime'
import { requireUser } from '@/lib/security'

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

function serializeLiker(row: LikerRow, viewerId: string, remarkMap: ReadonlyMap<string, string>) {
  return {
    uid: row.User.uid,
    nickname: getPublicUserDisplayName(row.User),
    displayName: resolveFriendDisplayName({
      viewerId,
      targetUserId: row.User.id,
      fallbackName: getPublicUserDisplayName(row.User),
      remarkMap,
    }),
    avatarUrl: publicImageUrl(row.User.Profile?.avatarUrl || row.User.avatarUrl),
  }
}

// 点赞用户列表：供 LikeAvatars 组件展开「全部点赞用户」时懒加载。
export async function GET(_request: Request, context: RouteContext) {
  const guard = await requireUser()
  if (!guard.user) return guard.response

  const { messageId } = await context.params
  const likes = await prisma.dailyMessageLike.findMany({
    where: { messageId, DailyMessage: { isDeleted: false } },
    orderBy: { createdAt: 'desc' },
    take: 50,
    select: { User: { select: likerUserSelect } },
  })
  const remarkMap = await loadFriendRemarkMap(guard.user.id, likes.map((like) => like.User.id))
  return NextResponse.json({ likers: likes.map((like) => serializeLiker(like, guard.user.id, remarkMap)) })
}

export async function POST(_request: Request, context: RouteContext) {
  const guard = await requireUser()
  if (!guard.user) return guard.response

  const { messageId } = await context.params
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
        await tx.notification.create({
          data: {
            recipientId: message.userId,
            actorId: guard.user.id,
            type: 'LIKE',
            title: '你的每日留言收到点赞',
            content: `${guard.user.nickname} 点赞了你的挂号留言`,
            // 带上留言日期，确保历史留言也能在挂号页正确定位（否则只加载今天的留言会找不到目标）。
            link: `/checkin?date=${formatBeijingDate(message.date)}&message=${messageId}`,
          },
        })
      }
    }

    const likeCount = await tx.dailyMessageLike.count({ where: { messageId } })
    await tx.dailyMessage.update({ where: { id: messageId }, data: { likeCount } })
    return { isLiked: !existing, likeCount, notifiedUserId: !existing && message.userId !== guard.user.id ? message.userId : null }
  })

  if (!result) return NextResponse.json({ message: '留言不存在' }, { status: 404 })
  if (result.notifiedUserId) emitRealtime(result.notifiedUserId, 'notification')
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
