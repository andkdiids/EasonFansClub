import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { activeUserWhere, friendUserSelect } from '@/lib/friends'
import { publicImageUrl } from '@/lib/images'
import { requireUser } from '@/lib/security'

const REQUEST_LIST_LIMIT = 50

export async function GET() {
  const guard = await requireUser()
  if (!guard.user) return guard.response

  const requests = await prisma.friendRequest.findMany({
    where: {
      senderId: guard.user.id,
      User_FriendRequest_receiverIdToUser: activeUserWhere,
    },
    orderBy: { createdAt: 'desc' },
    take: REQUEST_LIST_LIMIT,
    include: {
      User_FriendRequest_receiverIdToUser: { select: friendUserSelect },
    },
  })

  return NextResponse.json({
    requests: requests.map(({ User_FriendRequest_receiverIdToUser, ...request }) => ({
      ...request,
      receiver: {
        ...User_FriendRequest_receiverIdToUser,
        avatarUrl: publicImageUrl(User_FriendRequest_receiverIdToUser.avatarUrl),
        Profile: User_FriendRequest_receiverIdToUser.Profile ? {
          ...User_FriendRequest_receiverIdToUser.Profile,
          avatarUrl: publicImageUrl(User_FriendRequest_receiverIdToUser.Profile.avatarUrl),
        } : User_FriendRequest_receiverIdToUser.Profile,
        profile: User_FriendRequest_receiverIdToUser.Profile ? {
          ...User_FriendRequest_receiverIdToUser.Profile,
          avatarUrl: publicImageUrl(User_FriendRequest_receiverIdToUser.Profile.avatarUrl),
        } : User_FriendRequest_receiverIdToUser.Profile,
      },
    })),
  }, { headers: { 'Cache-Control': 'private, no-store, max-age=0' } })
}
