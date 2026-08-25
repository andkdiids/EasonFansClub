import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import { getPublicUserDisplayName, loadFriendRemarkMap, resolveFriendDisplayName } from '@/lib/friend-remarks'
import { publicImageUrl } from '@/lib/images'
import { publicPostWhere } from '@/lib/post-moderation'
import { prisma } from '@/lib/prisma'
import { emitRealtime } from '@/lib/realtime'
import { syncLikeNotification, type LikeNotificationSyncInput } from '@/lib/like-notifications'
import { enforceApiRateLimit, unauthenticatedResponse } from '@/lib/security'
import { getEquippedBadgesForUsers } from '@/lib/badge-service'

type Params = { params: Promise<{ postId: string }> }

// 点赞用户列表：供 LikeAvatars 组件展开「全部点赞用户」时懒加载。
export async function GET(request: Request, { params }: Params) {
  const user = await getCurrentUser()
  if (!user) return unauthenticatedResponse()
  const limited = await enforceApiRateLimit(request, user.id, {
    endpoint: '/api/posts/like',
    user: { limit: 120, windowSeconds: 60 },
  })
  if (limited) return limited

  const { postId } = await params
  const likes = await prisma.like.findMany({
    where: { postId, Post: publicPostWhere },
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
  const remarkMap = await loadFriendRemarkMap(user.id, likes.map((like) => like.User.id))
  const equippedBadgeMap = await getEquippedBadgesForUsers(likes.map((like) => like.User.id))
  return NextResponse.json({
    likers: likes.map((like) => ({
      uid: like.User.uid,
      nickname: getPublicUserDisplayName(like.User),
      displayName: resolveFriendDisplayName({
        viewerId: user.id,
        targetUserId: like.User.id,
        fallbackName: getPublicUserDisplayName(like.User),
        remarkMap,
      }),
      avatarUrl: publicImageUrl(like.User.Profile?.avatarUrl || like.User.avatarUrl),
      equippedBadge: equippedBadgeMap.get(like.User.id) || null,
    })),
  })
}

export async function POST(request: Request, { params }: Params) {
  const user = await getCurrentUser()
  if (!user) return unauthenticatedResponse('请先登录后再点赞')
  const limited = await enforceApiRateLimit(request, user.id, {
    ip: { limit: 120, windowSeconds: 60 },
    user: { limit: 60, windowSeconds: 60 },
    endpoint: '/api/posts/like',
  }, '点赞操作过于频繁，请稍后再试')
  if (limited) return limited

  const { postId } = await params
  let notificationInput: LikeNotificationSyncInput | null = null
  const result = await prisma.$transaction(async (tx) => {
    const post = await tx.post.findFirst({
      where: { ...publicPostWhere, id: postId },
      select: { id: true, authorId: true, likeCount: true },
    })
    if (!post) return null

    const existing = await tx.like.findUnique({ where: { postId_userId: { postId, userId: user.id } } })
    if (existing) {
      const likeCount = await tx.like.count({ where: { postId } })
      if (likeCount !== post.likeCount) await tx.post.update({ where: { id: postId }, data: { likeCount } })
      return { isLiked: true, likeCount }
    }

    await tx.like.create({ data: { postId, userId: user.id } })
    const likeCount = await tx.like.count({ where: { postId } })
    const updatedPost = await tx.post.update({
      where: { id: postId },
      data: { likeCount },
      select: { likeCount: true },
    })

    if (post.authorId !== user.id) {
      notificationInput = {
  recipientId: post.authorId,
  actorId: user.id,
  actorName: user.nickname,
  target: {
    kind: 'post',
    id: postId,
    link: `/posts/${postId}`,
  },
}
    }

    return { isLiked: true, likeCount: updatedPost.likeCount, notifiedUserId: post.authorId !== user.id ? post.authorId : null }
  }, { timeout: 15_000, maxWait: 5_000 })

  if (!result) return NextResponse.json({ message: '帖子不存在' }, { status: 404 })
  if (notificationInput) await syncLikeNotification(notificationInput)
  if (result.notifiedUserId) emitRealtime(result.notifiedUserId, 'notification')
  return NextResponse.json(result)
}

export async function DELETE(request: Request, { params }: Params) {
  const user = await getCurrentUser()
  if (!user) return unauthenticatedResponse()
  const limited = await enforceApiRateLimit(request, user.id, {
    ip: { limit: 120, windowSeconds: 60 },
    user: { limit: 60, windowSeconds: 60 },
    endpoint: '/api/posts/like',
  }, '点赞操作过于频繁，请稍后再试')
  if (limited) return limited

  const { postId } = await params
  let notificationInput: LikeNotificationSyncInput | null = null
  const result = await prisma.$transaction(async (tx) => {
    const post = await tx.post.findFirst({ where: { ...publicPostWhere, id: postId }, select: { likeCount: true, authorId: true } })
    if (!post) return null

    await tx.like.deleteMany({ where: { postId, userId: user.id } })
    const nextCount = await tx.like.count({ where: { postId } })
    const updatedPost = await tx.post.update({
      where: { id: postId },
      data: { likeCount: nextCount },
      select: { likeCount: true },
    })

    if (post.authorId !== user.id) {
     notificationInput = {
  recipientId: post.authorId,
  actorId: user.id,
  actorName: user.nickname,
  target: {
    kind: 'post',
    id: postId,
    link: `/posts/${postId}`,
  },
}
    }

    return {
      isLiked: false,
      likeCount: Math.max(updatedPost.likeCount, 0),
      notifiedUserId: post.authorId !== user.id ? post.authorId : null,
    }
  }, { timeout: 15_000, maxWait: 5_000 })

  if (!result) return NextResponse.json({ message: '帖子不存在' }, { status: 404 })
  if (notificationInput) await syncLikeNotification(notificationInput)
  if (result.notifiedUserId) emitRealtime(result.notifiedUserId, 'notification')
  return NextResponse.json(result)
}
