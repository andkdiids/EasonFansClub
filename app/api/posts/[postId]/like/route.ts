import { NextResponse } from 'next/server'
import type { Prisma } from '@prisma/client'
import { getCurrentUser } from '@/lib/auth'
import { publicImageUrl } from '@/lib/images'
import { publicPostWhere } from '@/lib/post-moderation'
import { decodePostLikeCursor, encodePostLikeCursor, POST_LIKE_PAGE_SIZE } from '@/lib/post-like-pagination'
import { prisma } from '@/lib/prisma'
import { emitRealtime } from '@/lib/realtime'
import { syncLikeNotification, type LikeNotificationSyncInput } from '@/lib/like-notifications'
import { logNotificationError } from '@/lib/notification-errors'
import { enforceApiRateLimit, unauthenticatedResponse } from '@/lib/security'

type Params = { params: Promise<{ postId: string }> }

// 点赞用户列表是公开帖子详情的一部分，不要求登录；头像点击后仍由公开用户页处理可见性。
export async function GET(request: Request, { params }: Params) {
  const limited = await enforceApiRateLimit(request, null, {
    endpoint: '/api/posts/like',
    ip: { limit: 120, windowSeconds: 60 },
  })
  if (limited) return limited

  const { postId } = await params
  const cursor = decodePostLikeCursor(new URL(request.url).searchParams.get('cursor'))
  const where: Prisma.LikeWhereInput = {
    postId,
    Post: publicPostWhere,
    ...(cursor ? {
      OR: [
        { createdAt: { lt: new Date(cursor.createdAt) } },
        { createdAt: new Date(cursor.createdAt), id: { lt: cursor.id } },
      ],
    } : {}),
  }
  const [rows, total] = await Promise.all([
    prisma.like.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: POST_LIKE_PAGE_SIZE + 1,
      select: {
        id: true,
        createdAt: true,
        User: {
          select: {
            id: true,
            uid: true,
            avatarUrl: true,
            Profile: { select: { avatarUrl: true } },
          },
        },
      },
    }),
    prisma.like.count({ where: { postId, Post: publicPostWhere } }),
  ])
  const likes = rows.slice(0, POST_LIKE_PAGE_SIZE)
  const last = likes[likes.length - 1]
  const nextCursor = rows.length > POST_LIKE_PAGE_SIZE && last
    ? encodePostLikeCursor({ createdAt: last.createdAt.toISOString(), id: last.id })
    : null
  return NextResponse.json({
    likers: likes.map((like) => ({
      id: like.User.id,
      uid: like.User.uid,
      avatarUrl: publicImageUrl(like.User.Profile?.avatarUrl || like.User.avatarUrl),
    })),
    total,
    nextCursor,
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
    await tx.$queryRaw`SELECT \`id\` FROM \`Post\` WHERE \`id\` = ${postId} FOR UPDATE`
    const post = await tx.post.findFirst({
      where: { ...publicPostWhere, id: postId },
      select: { id: true, authorId: true, likeCount: true },
    })
    if (!post) return null

    const existing = await tx.like.findUnique({ where: { postId_userId: { postId, userId: user.id } } })
    if (existing) {
      const likeCount = await tx.like.count({ where: { postId } })
      if (likeCount !== post.likeCount) await tx.post.update({ where: { id: postId }, data: { likeCount }, select: { id: true } })
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
    await tx.$queryRaw`SELECT \`id\` FROM \`Post\` WHERE \`id\` = ${postId} FOR UPDATE`
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
