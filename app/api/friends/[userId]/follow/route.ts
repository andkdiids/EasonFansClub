import { NextResponse } from 'next/server'
import { requireUser } from '@/lib/security'
import { activeUserWhere, normalizeFriendPair } from '@/lib/friends'
import { invalidateCheckInMessagesCache } from '@/lib/checkin-messages'
import { prisma } from '@/lib/prisma'

type RouteContext = { params: Promise<{ userId: string }> }

export async function POST(_request: Request, context: RouteContext) {
  const guard = await requireUser()
  if (!guard.user) return guard.response
  const viewer = guard.user

  const { userId } = await context.params
  if (!userId || userId === viewer.id) {
    return NextResponse.json({ ok: false, message: '不能关注自己' }, { status: 400 })
  }

  const target = await prisma.user.findFirst({
    where: { id: userId, ...activeUserWhere },
    select: { id: true },
  })
  if (!target) return NextResponse.json({ ok: false, message: '用户不存在或不可用' }, { status: 404 })

  const [userAId, userBId] = normalizeFriendPair(viewer.id, target.id)
  const followed = await prisma.$transaction(async (tx) => {
    const friendship = await tx.friendship.findUnique({
      where: { userAId_userBId: { userAId, userBId } },
      select: { id: true },
    })
    if (!friendship) return false

    await tx.friendFollow.upsert({
      where: { followerId_followedId: { followerId: viewer.id, followedId: target.id } },
      update: {},
      create: { followerId: viewer.id, followedId: target.id },
    })
    return true
  })

  if (!followed) {
    return NextResponse.json({ ok: false, message: '只有已经是好友的用户才能关注' }, { status: 403 })
  }

  invalidateCheckInMessagesCache()
  return NextResponse.json({ ok: true, followed: true }, { headers: { 'Cache-Control': 'private, no-store, max-age=0' } })
}

export async function DELETE(_request: Request, context: RouteContext) {
  const guard = await requireUser()
  if (!guard.user) return guard.response
  const viewer = guard.user

  const { userId } = await context.params
  if (!userId || userId === viewer.id) {
    return NextResponse.json({ ok: false, message: '不能取消关注自己' }, { status: 400 })
  }

  await prisma.friendFollow.deleteMany({ where: { followerId: viewer.id, followedId: userId } })
  invalidateCheckInMessagesCache()
  return NextResponse.json({ ok: true, followed: false }, { headers: { 'Cache-Control': 'private, no-store, max-age=0' } })
}
