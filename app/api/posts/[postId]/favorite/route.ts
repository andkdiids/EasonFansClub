import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireUser } from '@/lib/security'

type RouteContext = { params: Promise<{ postId: string }> }

export async function POST(_request: Request, context: RouteContext) {
  const guard = await requireUser()
  if (!guard.user) return guard.response

  const { postId } = await context.params
  const result = await prisma.$transaction(async (tx) => {
    const post = await tx.post.findFirst({
      where: { id: postId, isDeleted: false, status: 'PUBLISHED', moderationStatus: 'APPROVED' },
      select: { id: true },
    })
    if (!post) return null

    const existing = await tx.postFavorite.findUnique({
      where: { postId_userId: { postId, userId: guard.user.id } },
    })

    if (existing) {
      await tx.postFavorite.delete({ where: { id: existing.id } })
    } else {
      await tx.postFavorite.create({ data: { postId, userId: guard.user.id } })
    }

    const favoriteCount = await tx.postFavorite.count({ where: { postId } })
    await tx.post.update({ where: { id: postId }, data: { favoriteCount } })
    return { isFavorited: !existing, favoriteCount }
  })

  if (!result) return NextResponse.json({ message: '帖子不存在' }, { status: 404 })
  return NextResponse.json(result)
}

export async function DELETE(_request: Request, context: RouteContext) {
  const guard = await requireUser()
  if (!guard.user) return guard.response

  const { postId } = await context.params
  const result = await prisma.$transaction(async (tx) => {
    const post = await tx.post.findFirst({
      where: { id: postId, isDeleted: false, moderationStatus: 'APPROVED' },
      select: { id: true },
    })
    if (!post) return null

    await tx.postFavorite.deleteMany({ where: { postId, userId: guard.user.id } })
    const favoriteCount = await tx.postFavorite.count({ where: { postId } })
    await tx.post.update({ where: { id: postId }, data: { favoriteCount } })
    return { isFavorited: false, favoriteCount }
  })

  if (!result) return NextResponse.json({ message: '帖子不存在' }, { status: 404 })
  return NextResponse.json(result)
}
