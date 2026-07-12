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
      senderId: guard.user.id,
      receiver: activeUserWhere,
    },
    orderBy: { createdAt: 'desc' },
    take: REQUEST_LIST_LIMIT,
    include: {
      receiver: { select: friendUserSelect },
    },
  })

  return NextResponse.json({ requests })
}
