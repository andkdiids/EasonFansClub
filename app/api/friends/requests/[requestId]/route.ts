import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import { decideFriendRequest } from '@/lib/friends'
import { prisma } from '@/lib/prisma'

type RouteContext = { params: Promise<{ requestId: string }> }

export async function PATCH(request: Request, context: RouteContext) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ message: '请先登录' }, { status: 401 })

  const { requestId } = await context.params
  const body = await request.json().catch(() => null)
  if (body?.action === 'cancel') {
    const cancelled = await prisma.friendRequest.updateMany({
      where: { id: requestId, senderId: user.id, status: 'PENDING' },
      data: { status: 'CANCELLED' },
    })
    if (!cancelled.count) return NextResponse.json({ message: '好友申请不存在或已处理' }, { status: 404 })
    await prisma.notification.updateMany({
      where: { actorId: user.id, type: 'FRIEND_REQUEST', link: '/friends#received-requests', isRead: false },
      data: { isRead: true, readAt: new Date() },
    })
    return NextResponse.json({ message: '好友申请已取消' })
  }
  const action = body?.action === 'accept' ? 'accept' : 'reject'
  const result = await decideFriendRequest(user.id, requestId, action)

  return NextResponse.json(result.body, { status: result.status })
}
