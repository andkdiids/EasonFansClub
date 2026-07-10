import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import { POINTS, calcLevel } from '@/lib/points'
import { prisma } from '@/lib/prisma'

type Params = { params: Promise<{ postId: string }> }

export async function POST(_request: Request, { params }: Params) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ message: '请先登录后再点赞' }, { status: 401 })

  const { postId } = await params
  const result = await prisma.$transaction(async (tx) => {
    const post = await tx.post.findFirst({
      where: { id: postId, isDeleted: false, status: 'PUBLISHED' },
      select: { id: true, authorId: true, likeCount: true },
    })
    if (!post) return null

    const existing = await tx.like.findUnique({ where: { postId_userId: { postId, userId: user.id } } })
    if (existing) {
      return { isLiked: true, likeCount: post.likeCount }
    }

    await tx.like.create({ data: { postId, userId: user.id } })
    const updatedPost = await tx.post.update({
      where: { id: postId },
      data: { likeCount: { increment: 1 } },
      select: { likeCount: true },
    })

    if (post.authorId !== user.id) {
      const author = await tx.user.findUnique({ where: { id: post.authorId }, select: { points: true, exp: true } })
      if (author) {
        const nextPoints = author.points + POINTS.postLikeReceived
        await tx.user.update({
          where: { id: post.authorId },
          data: { points: nextPoints, level: calcLevel(nextPoints + author.exp) },
        })
        await tx.pointLog.create({
          data: {
            userId: post.authorId,
            action: 'POST_LIKE_RECEIVED',
            points: POINTS.postLikeReceived,
            before: author.points,
            after: nextPoints,
            postId,
            reason: '帖子收到点赞',
          },
        })
      }
    }

    return { isLiked: true, likeCount: updatedPost.likeCount }
  })

  if (!result) return NextResponse.json({ message: '帖子不存在' }, { status: 404 })
  return NextResponse.json(result)
}

export async function DELETE(_request: Request, { params }: Params) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ message: '请先登录' }, { status: 401 })

  const { postId } = await params
  const result = await prisma.$transaction(async (tx) => {
    const post = await tx.post.findUnique({ where: { id: postId }, select: { likeCount: true } })
    if (!post) return null

    const deleted = await tx.like.deleteMany({ where: { postId, userId: user.id } })
    if (deleted.count === 0) return { isLiked: false, likeCount: Math.max(post.likeCount, 0) }

    const nextCount = Math.max(post.likeCount - 1, 0)
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
