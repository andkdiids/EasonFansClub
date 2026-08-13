import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import { getPublicUserDisplayName, loadFriendRemarkMap, resolveFriendDisplayName } from '@/lib/friend-remarks'
import { publicImageUrl } from '@/lib/images'
import { publicPostWhere } from '@/lib/post-moderation'
import { prisma } from '@/lib/prisma'
import { emitRealtime } from '@/lib/realtime'

type Params = { params: Promise<{ postId: string }> }

// 点赞用户列表：供 LikeAvatars 组件展开「全部点赞用户」时懒加载。
export async function GET(_request: Request, { params }: Params) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ message: '请先登录' }, { status: 401 })

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
          avatarUrl: true,
          Profile: { select: { displayName: true, avatarUrl: true } },
        },
      },
    },
  })
  const remarkMap = await loadFriendRemarkMap(user.id, likes.map((like) => like.User.id))
  return NextResponse.json({
    likers: likes.map((like) => ({
      uid: like.User.uid,
      nickname: like.User.nickname,
      displayName: resolveFriendDisplayName({
        viewerId: user.id,
        targetUserId: like.User.id,
        fallbackName: getPublicUserDisplayName(like.User),
        remarkMap,
      }),
      avatarUrl: publicImageUrl(like.User.Profile?.avatarUrl || like.User.avatarUrl),
    })),
  })
}

export async function POST(_request: Request, { params }: Params) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ message: '请先登录后再点赞' }, { status: 401 })

  const { postId } = await params
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
      const author = await tx.user.findUnique({ where: { id: post.authorId }, select: { id: true } })
      if (author) {
        // 点赞通知：仅在「新建点赞」时生成一次（上面的 findUnique 已保证同一用户不会重复点赞），
        // 格式与回复点赞 / 每日留言点赞一致；link 指向帖子详情。
        await tx.notification.create({
          data: {
            recipientId: post.authorId,
            actorId: user.id,
            type: 'LIKE',
            title: '你的帖子收到点赞',
            content: `${user.nickname} 点赞了你的帖子`,
            link: `/posts/${postId}`,
          },
        })
      }
    }

    return { isLiked: true, likeCount: updatedPost.likeCount, notifiedUserId: post.authorId !== user.id ? post.authorId : null }
  })

  if (!result) return NextResponse.json({ message: '帖子不存在' }, { status: 404 })
  if (result.notifiedUserId) emitRealtime(result.notifiedUserId, 'notification')
  return NextResponse.json(result)
}

export async function DELETE(_request: Request, { params }: Params) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ message: '请先登录' }, { status: 401 })

  const { postId } = await params
  const result = await prisma.$transaction(async (tx) => {
    const post = await tx.post.findFirst({ where: { ...publicPostWhere, id: postId }, select: { likeCount: true } })
    if (!post) return null

    await tx.like.deleteMany({ where: { postId, userId: user.id } })
    const nextCount = await tx.like.count({ where: { postId } })
    const updatedPost = await tx.post.update({
      where: { id: postId },
      data: { likeCount: nextCount },
      select: { likeCount: true },
    })

    return { isLiked: false, likeCount: Math.max(updatedPost.likeCount, 0) }
  })

  if (!result) return NextResponse.json({ message: '帖子不存在' }, { status: 404 })
  return NextResponse.json(result)
}
