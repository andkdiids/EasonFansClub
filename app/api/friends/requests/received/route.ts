import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { activeUserWhere, friendUserSelect } from '@/lib/friends'
import { requireUser } from '@/lib/security'

const REQUEST_LIST_LIMIT = 50

export async function GET() {
  const guard = await requireUser()
  if (!guard.user) return guard.response

  const requests = await prisma.friendRequest.findMany({
    where: {
      receiverId: guard.user.id,
      status: 'PENDING',
      User_FriendRequest_senderIdToUser: activeUserWhere,
    },
    orderBy: { createdAt: 'desc' },
    take: REQUEST_LIST_LIMIT,
    include: {
      User_FriendRequest_senderIdToUser: { select: friendUserSelect },
    },
  })

  return NextResponse.json({
    requests: requests.map(({ User_FriendRequest_senderIdToUser, ...request }) => ({
      ...request,
      sender: {
        ...User_FriendRequest_senderIdToUser,
        profile: User_FriendRequest_senderIdToUser.Profile,
      },
    })),
  }, { headers: { 'Cache-Control': 'private, no-store, max-age=0' } })
}
