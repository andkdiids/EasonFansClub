import { NextResponse } from 'next/server'
import { invalidateCheckInMessagesCache } from '@/lib/checkin-messages'
import { normalizeFriendPair } from '@/lib/friends'
import { prisma } from '@/lib/prisma'
import { requireRequestUser } from '@/lib/security'

type RouteContext = { params: Promise<{ userId: string }> }

/**
 * Removes only the Friendship and its private friend-follow marks. No
 * notification, message, or historical content is created or deleted here.
 */
export async function DELETE(request: Request, context: RouteContext) {
  const guard = await requireRequestUser(request)
  if (!guard.user) return guard.response
  const viewer = guard.user

  const { userId } = await context.params
  if (!userId || userId === viewer.id) {
    return NextResponse.json({ ok: false, message: '不能删除自己' }, { status: 400 })
  }

  const [userAId, userBId] = normalizeFriendPair(viewer.id, userId)
  const result = await prisma.$transaction(async (tx) => {
    const friendship = await tx.friendship.deleteMany({ where: { userAId, userBId } })
    // Legacy "delete friend" remains an adapter during the transition: the
    // viewer unfollows the target, while the reverse Follow is preserved.
    // This makes MUTUAL become FOLLOWED_BY without deleting conversation or
    // message history.
    await tx.follow.deleteMany({ where: { followerId: viewer.id, followingId: userId } })
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
