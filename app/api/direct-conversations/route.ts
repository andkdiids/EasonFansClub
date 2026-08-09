import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import { getPublicUserDisplayName, loadFriendRemarkMap, resolveFriendDisplayName } from '@/lib/friend-remarks'
import { normalizeFriendPair } from '@/lib/friends'
import { prisma } from '@/lib/prisma'

const privateHeaders = { 'Cache-Control': 'private, no-store, max-age=0' }

export async function GET() {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ message: '请先登录' }, { status: 401, headers: privateHeaders })
  const conversations = await prisma.conversation.findMany({
    where: { ConversationParticipant: { some: { userId: user.id, isDeleted: false } } },
    orderBy: [{ lastMessageAt: 'desc' }, { updatedAt: 'desc' }],
    take: 30,
    include: {
      ConversationParticipant: { select: { userId: true, lastReadAt: true, User: { select: { id: true, uid: true, nickname: true, avatarUrl: true, Profile: { select: { displayName: true, avatarUrl: true } } } } } },
      DirectMessage: { where: { isDeleted: false }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 1, select: { id: true, content: true, createdAt: true, senderId: true } },
    },
  })
  const participants = conversations.map((row) => ({
    conversationId: row.id,
    lastReadAt: row.ConversationParticipant.find((participant) => participant.userId === user.id)?.lastReadAt || null,
  }))
  const oldestReadAt = participants.some((item) => !item.lastReadAt)
    ? null
    : participants.reduce<Date | null>((oldest, item) => !oldest || (item.lastReadAt && item.lastReadAt < oldest) ? item.lastReadAt : oldest, null)
  const incoming = conversations.length ? await prisma.directMessage.findMany({
    where: {
      conversationId: { in: conversations.map((row) => row.id) },
      senderId: { not: user.id },
      isDeleted: false,
      ...(oldestReadAt ? { createdAt: { gt: oldestReadAt } } : {}),
    },
    select: { conversationId: true, createdAt: true },
  }) : []
  const readByConversation = new Map(participants.map((item) => [item.conversationId, item.lastReadAt]))
  const unreadByConversation = new Map<string, number>()
  incoming.forEach((message) => {
    const lastReadAt = readByConversation.get(message.conversationId)
    if (!lastReadAt || message.createdAt > lastReadAt) unreadByConversation.set(message.conversationId, (unreadByConversation.get(message.conversationId) || 0) + 1)
  })
  const otherUserIds = conversations.flatMap((row) => row.ConversationParticipant
    .filter((participant) => participant.userId !== user.id)
    .map((participant) => participant.userId))
  const remarkMap = await loadFriendRemarkMap(user.id, otherUserIds)
  return NextResponse.json({ conversations: conversations.map((row) => {
    const other = row.ConversationParticipant.find((participant) => participant.userId !== user.id)
    const otherUser = other?.User
      ? {
          ...other.User,
          Profile: other.User.Profile ? {
            ...other.User.Profile,
            displayName: resolveFriendDisplayName({
              viewerId: user.id,
              targetUserId: other.User.id,
              fallbackName: getPublicUserDisplayName(other.User),
              remarkMap,
            }),
          } : other.User.Profile,
        }
      : null
    return {
      id: row.id,
      lastMessageAt: row.lastMessageAt,
      otherUser,
      latestMessage: row.DirectMessage[0] || null,
      unreadCount: unreadByConversation.get(row.id) || 0,
    }
  }) }, { headers: privateHeaders })
}

export async function POST(request: Request) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ message: '请先登录' }, { status: 401, headers: privateHeaders })
  const body = await request.json().catch(() => null)
  const targetUid = Number(body?.targetUid)
  const target = await prisma.user.findFirst({ where: { uid: targetUid, status: 'ACTIVE', isDeleted: false }, select: { id: true } })
  if (!target || target.id === user.id) return NextResponse.json({ message: '用户不存在' }, { status: 404, headers: privateHeaders })
  const [userAId, userBId] = normalizeFriendPair(user.id, target.id)
  const friendship = await prisma.friendship.findUnique({ where: { userAId_userBId: { userAId, userBId } }, select: { id: true } })
  if (!friendship) return NextResponse.json({ message: '只能给好友发送私信' }, { status: 403, headers: privateHeaders })
  const pairKey = `${userAId}:${userBId}`
  const conversation = await prisma.conversation.upsert({
    where: { pairKey },
    update: {},
    create: { pairKey, ConversationParticipant: { create: [{ userId: userAId }, { userId: userBId }] } },
    select: { id: true },
  })
  return NextResponse.json({ conversation }, { headers: privateHeaders })
}
