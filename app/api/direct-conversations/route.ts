import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import { normalizeFriendPair } from '@/lib/friends'
import { prisma } from '@/lib/prisma'

export async function GET() {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ message: '请先登录' }, { status: 401 })
  const conversations = await prisma.conversation.findMany({
    where: { participants: { some: { userId: user.id, isDeleted: false } } },
    orderBy: [{ lastMessageAt: 'desc' }, { updatedAt: 'desc' }],
    take: 30,
    include: {
      participants: { select: { userId: true, lastReadAt: true, user: { select: { uid: true, nickname: true, avatarUrl: true, profile: { select: { displayName: true, avatarUrl: true } } } } } },
      messages: { where: { isDeleted: false }, orderBy: { createdAt: 'desc' }, take: 100, select: { id: true, content: true, createdAt: true, senderId: true } },
    },
  })
  return NextResponse.json({ conversations: conversations.map((row) => {
    const mine = row.participants.find((participant) => participant.userId === user.id)
    const other = row.participants.find((participant) => participant.userId !== user.id)
    return {
      id: row.id,
      lastMessageAt: row.lastMessageAt,
      otherUser: other?.user || null,
      latestMessage: row.messages[0] || null,
      unreadCount: row.messages.filter((message) => message.senderId !== user.id && (!mine?.lastReadAt || message.createdAt > mine.lastReadAt)).length,
    }
  }) })
}

export async function POST(request: Request) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ message: '请先登录' }, { status: 401 })
  const body = await request.json().catch(() => null)
  const targetUid = Number(body?.targetUid)
  const target = await prisma.user.findFirst({ where: { uid: targetUid, status: 'ACTIVE', isDeleted: false }, select: { id: true } })
  if (!target || target.id === user.id) return NextResponse.json({ message: '用户不存在' }, { status: 404 })
  const [userAId, userBId] = normalizeFriendPair(user.id, target.id)
  const friendship = await prisma.friendship.findUnique({ where: { userAId_userBId: { userAId, userBId } }, select: { id: true } })
  if (!friendship) return NextResponse.json({ message: '只能给好友发送私信' }, { status: 403 })
  const pairKey = `${userAId}:${userBId}`
  const conversation = await prisma.conversation.upsert({
    where: { pairKey },
    update: {},
    create: { pairKey, participants: { create: [{ userId: userAId }, { userId: userBId }] } },
    select: { id: true },
  })
  return NextResponse.json({ conversation })
}
