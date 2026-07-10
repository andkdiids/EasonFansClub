import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireUser } from '@/lib/security'

type RouteContext = { params: Promise<{ messageId: string }> }

export async function POST(_request: Request, context: RouteContext) {
  const guard = await requireUser()
  if (!guard.user) return guard.response

  const { messageId } = await context.params
  const result = await prisma.$transaction(async (tx) => {
    const message = await tx.dailyMessage.findFirst({
      where: { id: messageId, isDeleted: false },
      select: { id: true },
    })
    if (!message) return null

    const existing = await tx.dailyMessageFavorite.findUnique({
      where: { messageId_userId: { messageId, userId: guard.user.id } },
    })

    if (existing) {
      await tx.dailyMessageFavorite.delete({ where: { id: existing.id } })
    } else {
      await tx.dailyMessageFavorite.create({ data: { messageId, userId: guard.user.id } })
    }

    const favoriteCount = await tx.dailyMessageFavorite.count({ where: { messageId } })
    await tx.dailyMessage.update({ where: { id: messageId }, data: { favoriteCount } })
    return { isFavorited: !existing, favoriteCount }
  })

  if (!result) return NextResponse.json({ message: '留言不存在' }, { status: 404 })
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

    await tx.dailyMessageFavorite.deleteMany({ where: { messageId, userId: guard.user.id } })
    const favoriteCount = await tx.dailyMessageFavorite.count({ where: { messageId } })
    await tx.dailyMessage.update({ where: { id: messageId }, data: { favoriteCount } })
    return { isFavorited: false, favoriteCount }
  })

  if (!result) return NextResponse.json({ message: '留言不存在' }, { status: 404 })
  return NextResponse.json(result)
}
