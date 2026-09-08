import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import { normalizeFriendPair } from '@/lib/friends'
import { emitRealtime } from '@/lib/realtime'
import { prisma } from '@/lib/prisma'
import { enforceApiRateLimit, unauthenticatedResponse } from '@/lib/security'

const privateHeaders = { 'Cache-Control': 'private, no-store, max-age=0' }

export async function POST(request: Request, { params }: { params: Promise<{ conversationId: string }> }) {
  const user = await getCurrentUser()
  if (!user) return unauthenticatedResponse('请先登录', privateHeaders)
  const limited = await enforceApiRateLimit(request, user.id, {
    endpoint: '/api/direct-conversations/pin',
    user: { limit: 120, windowSeconds: 60 },
  })
  if (limited) return limited

  const body = await request.json().catch(() => null)
  if (typeof body?.pinned !== 'boolean') {
    return NextResponse.json({ message: '置顶状态无效' }, { status: 400, headers: privateHeaders })
  }
  const { conversationId } = await params
  const conversation = await prisma.conversation.findFirst({
    where: {
      id: conversationId,
      ConversationParticipant: { some: { userId: user.id, isDeleted: false } },
    },
    select: {
      ConversationParticipant: { select: { userId: true, isDeleted: true } },
    },
  })
  if (!conversation) return NextResponse.json({ message: '会话不存在或无权操作' }, { status: 404, headers: privateHeaders })

  const peerIds = conversation.ConversationParticipant
    .filter((participant) => participant.userId !== user.id && !participant.isDeleted)
    .map((participant) => participant.userId)
  if (peerIds.length !== 1) return NextResponse.json({ message: '只能置顶好友会话' }, { status: 403, headers: privateHeaders })
  const [userAId, userBId] = normalizeFriendPair(user.id, peerIds[0])
  const friendship = await prisma.friendship.findUnique({
    where: { userAId_userBId: { userAId, userBId } },
    select: { id: true },
  })
  if (!friendship) return NextResponse.json({ message: '只能置顶好友会话' }, { status: 403, headers: privateHeaders })

  const pinnedAt = body.pinned ? new Date() : null
  const participant = await prisma.conversationParticipant.update({
    where: { conversationId_userId: { conversationId, userId: user.id } },
    data: { pinnedAt },
    select: { pinnedAt: true },
  })
  // Pinning is a private participant preference. Notify only this account so
  // another member of the same conversation cannot inherit the preference.
  emitRealtime(user.id, 'message', { conversationId })
  return NextResponse.json({
    pinned: Boolean(participant.pinnedAt),
    pinnedAt: participant.pinnedAt,
  }, { headers: privateHeaders })
}
