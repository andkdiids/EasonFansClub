import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import { POINTS } from '@/lib/points'
import { prisma } from '@/lib/prisma'
import { awardRegistrationFee } from '@/lib/registration-fee'

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
        await awardRegistrationFee(tx, {
          userId: post.authorId,
          requestedAmount: POINTS.postLikeReceived,
          action: 'POST_LIKE_RECEIVED',
          reason: '帖子收到点赞',
          businessKey: `post-like-received:${postId}:${user.id}`,
          postId,
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
