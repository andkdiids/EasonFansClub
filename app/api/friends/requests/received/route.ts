import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { activeUserWhere, friendUserSelect } from '@/lib/friends'
import { requireUser } from '@/lib/security'

export async function GET() {
  const guard = await requireUser()
  if (!guard.user) return guard.response

  const requests = await prisma.friendRequest.findMany({
    where: {
      receiverId: guard.user.id,
      status: 'PENDING',
      sender: activeUserWhere,
    },
    orderBy: { createdAt: 'desc' },
    include: {
      sender: { select: friendUserSelect },
    },
  })

  return NextResponse.json({ requests })
}
