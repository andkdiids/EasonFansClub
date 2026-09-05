import { NextResponse } from 'next/server'
import { publicPostWhere } from '@/lib/post-moderation'
import { prisma } from '@/lib/prisma'
import { enforceApiRateLimit, requireUser } from '@/lib/security'

type RouteContext = { params: Promise<{ postId: string }> }

export async function POST(request: Request, context: RouteContext) {
  const guard = await requireUser()
  if (!guard.user) return guard.response
  const limited = await enforceApiRateLimit(request, guard.user.id, {
    ip: { limit: 120, windowSeconds: 60 },
    user: { limit: 60, windowSeconds: 60 },
    endpoint: '/api/posts/favorite',
  }, '收藏操作过于频繁，请稍后再试')
  if (limited) return limited

  const { postId } = await context.params
  const body = await request.json().catch(() => null) as { isFavorited?: unknown } | null
  const requestedState = typeof body?.isFavorited === 'boolean' ? body.isFavorited : null
  const result = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT \`id\` FROM \`Post\` WHERE \`id\` = ${postId} FOR UPDATE`
    const post = await tx.post.findFirst({
      where: { ...publicPostWhere, id: postId },
      select: { id: true },
    })
    if (!post) return null

    const existing = requestedState === null
      ? await tx.postFavorite.findUnique({ where: { postId_userId: { postId, userId: guard.user.id } } })
      : null

    if (requestedState === true) {
      await tx.postFavorite.upsert({
        where: { postId_userId: { postId, userId: guard.user.id } },
        update: {},
        create: { postId, userId: guard.user.id },
      })
    } else if (requestedState === false) {
      await tx.postFavorite.deleteMany({ where: { postId, userId: guard.user.id } })
    } else if (existing) {
      await tx.postFavorite.delete({ where: { id: existing.id } })
    } else {
      await tx.postFavorite.create({ data: { postId, userId: guard.user.id } })
    }

    const favoriteCount = await tx.postFavorite.count({ where: { postId } })
    await tx.post.update({ where: { id: postId }, data: { favoriteCount }, select: { id: true } })
    return { isFavorited: requestedState ?? !existing, favoriteCount }
  })

  if (!result) return NextResponse.json({ message: '帖子不存在' }, { status: 404 })
  return NextResponse.json(result)
}

export async function DELETE(request: Request, context: RouteContext) {
  const guard = await requireUser()
  if (!guard.user) return guard.response
  const limited = await enforceApiRateLimit(request, guard.user.id, {
    ip: { limit: 120, windowSeconds: 60 },
    user: { limit: 60, windowSeconds: 60 },
    endpoint: '/api/posts/favorite',
  }, '收藏操作过于频繁，请稍后再试')
  if (limited) return limited

  const { postId } = await context.params
  const result = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT \`id\` FROM \`Post\` WHERE \`id\` = ${postId} FOR UPDATE`
    const post = await tx.post.findFirst({
      where: { ...publicPostWhere, id: postId },
      select: { id: true },
    })
    if (!post) return null

    await tx.postFavorite.deleteMany({ where: { postId, userId: guard.user.id } })
    const favoriteCount = await tx.postFavorite.count({ where: { postId } })
    await tx.post.update({ where: { id: postId }, data: { favoriteCount }, select: { id: true } })
    return { isFavorited: false, favoriteCount }
  })

  if (!result) return NextResponse.json({ message: '帖子不存在' }, { status: 404 })
  return NextResponse.json(result)
}
