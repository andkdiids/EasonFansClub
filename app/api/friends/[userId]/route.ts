import { NextResponse } from 'next/server'
import { invalidateCheckInMessagesCache } from '@/lib/checkin-messages'
import { normalizeFriendPair } from '@/lib/friends'
import { prisma } from '@/lib/prisma'
import { requireUser } from '@/lib/security'

type RouteContext = { params: Promise<{ userId: string }> }

/**
 * Removes only the Friendship and its private friend-follow marks. No
 * notification, message, or historical content is created or deleted here.
 */
export async function DELETE(_request: Request, context: RouteContext) {
  const guard = await requireUser()
  if (!guard.user) return guard.response
  const viewer = guard.user

  const { userId } = await context.params
  if (!userId || userId === viewer.id) {
    return NextResponse.json({ ok: false, message: '不能删除自己' }, { status: 400 })
  }

  const [userAId, userBId] = normalizeFriendPair(viewer.id, userId)
  const result = await prisma.$transaction(async (tx) => {
    const friendship = await tx.friendship.deleteMany({ where: { userAId, userBId } })
    await tx.friendFollow.deleteMany({
      where: {
        OR: [
          { followerId: viewer.id, followedId: userId },
          { followerId: userId, followedId: viewer.id },
        ],
      },
    })
    await tx.friendGroupMember.deleteMany({
      where: {
        OR: [
          { ownerId: viewer.id, friendId: userId },
          { ownerId: userId, friendId: viewer.id },
        ],
      },
    })
    return friendship.count
  })

  invalidateCheckInMessagesCache()
  return NextResponse.json(
    { ok: true, isFriend: false, deleted: result > 0 },
    { headers: { 'Cache-Control': 'private, no-store, max-age=0' } },
  )
}
