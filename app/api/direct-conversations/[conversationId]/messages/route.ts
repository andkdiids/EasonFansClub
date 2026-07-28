import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import { normalizeFriendPair } from '@/lib/friends'
import { prisma } from '@/lib/prisma'
import { containsSensitiveContent, sanitizeText } from '@/lib/security'

async function getConversation(userId: string, conversationId: string) {
  return prisma.conversation.findFirst({
    where: { id: conversationId, ConversationParticipant: { some: { userId, isDeleted: false } } },
    select: { id: true, ConversationParticipant: { select: { userId: true } } },
  })
}

export async function GET(_request: Request, { params }: { params: Promise<{ conversationId: string }> }) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ message: '请先登录' }, { status: 401 })
  const { conversationId } = await params
  const conversation = await getConversation(user.id, conversationId)
  if (!conversation) return NextResponse.json({ message: '会话不存在或无权查看' }, { status: 404 })
  const messages = await prisma.directMessage.findMany({
    where: { conversationId, isDeleted: false },
    orderBy: { createdAt: 'desc' },
    take: 50,
    select: { id: true, content: true, senderId: true, createdAt: true },
  })
  await prisma.conversationParticipant.updateMany({
    where: { conversationId, userId: user.id },
    data: { lastReadAt: new Date(), isDeleted: false },
  })
  return NextResponse.json({ messages: messages.reverse() })
}

export async function POST(request: Request, { params }: { params: Promise<{ conversationId: string }> }) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ message: '请先登录' }, { status: 401 })
  const { conversationId } = await params
  const content = sanitizeText((await request.json().catch(() => null))?.content, 1000)
  if (!content) return NextResponse.json({ message: '消息不能为空' }, { status: 400 })
  if (await containsSensitiveContent(content)) return NextResponse.json({ message: '消息包含违禁内容' }, { status: 400 })
  const conversation = await getConversation(user.id, conversationId)
  if (!conversation) return NextResponse.json({ message: '会话不存在或无权发送' }, { status: 404 })
  const otherUserId = conversation.ConversationParticipant.find((participant) => participant.userId !== user.id)?.userId
  if (!otherUserId) return NextResponse.json({ message: '会话成员无效' }, { status: 400 })
  const [userAId, userBId] = normalizeFriendPair(user.id, otherUserId)
  const friendship = await prisma.friendship.findUnique({ where: { userAId_userBId: { userAId, userBId } }, select: { id: true } })
  if (!friendship) return NextResponse.json({ message: '只能给好友发送私信' }, { status: 403 })
  const now = new Date()
  const message = await prisma.$transaction(async (tx) => {
    const created = await tx.directMessage.create({
      data: { conversationId, senderId: user.id, content, type: 'TEXT' },
      select: { id: true, content: true, senderId: true, createdAt: true },
    })
    await tx.conversation.update({ where: { id: conversationId }, data: { lastMessageAt: now } })
    await tx.conversationParticipant.updateMany({ where: { conversationId, userId: user.id }, data: { lastReadAt: now, isDeleted: false } })
    return created
  })
  return NextResponse.json({ message }, { status: 201 })
}
