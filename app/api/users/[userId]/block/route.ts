import { NextResponse } from 'next/server'
import { invalidateCheckInMessagesCache } from '@/lib/checkin-messages'
import { prisma } from '@/lib/prisma'
import { requireUser, sanitizeText } from '@/lib/security'

type RouteContext = { params: Promise<{ userId: string }> }

export async function POST(request: Request, context: RouteContext) {
  const guard = await requireUser()
  if (!guard.user) return guard.response

  const { userId } = await context.params
  if (guard.user.id === userId) {
    return NextResponse.json({ message: '不能拉黑自己' }, { status: 400 })
  }

  const body = await request.json().catch(() => null)
  await prisma.block.upsert({
    where: {
      blockerId_blockedId: {
        blockerId: guard.user.id,
        blockedId: userId,
      },
    },
    update: { reason: sanitizeText(body?.reason, 120) || null },
    create: {
      blockerId: guard.user.id,
      blockedId: userId,
      reason: sanitizeText(body?.reason, 120) || null,
    },
  })

  await prisma.follow.deleteMany({
    where: {
      OR: [
        { followerId: guard.user.id, followingId: userId },
        { followerId: userId, followingId: guard.user.id },
      ],
    },
  })
  await prisma.friendFollow.deleteMany({
    where: {
      OR: [
        { followerId: guard.user.id, followedId: userId },
        { followerId: userId, followedId: guard.user.id },
      ],
    },
  })
  invalidateCheckInMessagesCache()

  return NextResponse.json({ blocked: true })
}

export async function DELETE(_request: Request, context: RouteContext) {
  const guard = await requireUser()
  if (!guard.user) return guard.response

  const { userId } = await context.params
  await prisma.block.deleteMany({
    where: { blockerId: guard.user.id, blockedId: userId },
  })

  return NextResponse.json({ blocked: false })
}
