import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import { compareFriendConversationOrder } from '@/lib/friend-conversation-order'
import { getPublicUserDisplayName, loadFriendRemarkMap, resolveFriendDisplayName } from '@/lib/friend-remarks'
import { normalizeFriendPair } from '@/lib/friends'
import { publicImageUrl } from '@/lib/images'
import { prisma } from '@/lib/prisma'
import { publicModerationText } from '@/lib/content-moderation'
import { enforceApiRateLimit, unauthenticatedResponse } from '@/lib/security'

const privateHeaders = { 'Cache-Control': 'private, no-store, max-age=0' }

export async function GET(request: Request) {
  const user = await getCurrentUser()
  if (!user) return unauthenticatedResponse('请先登录', privateHeaders)
  const limited = await enforceApiRateLimit(request, user.id, {
    endpoint: '/api/direct-conversations',
    ip: { limit: 240, windowSeconds: 60 },
    user: { limit: 120, windowSeconds: 60 },
  })
  if (limited) return limited
  const conversationRows = await prisma.conversation.findMany({
    where: { ConversationParticipant: { some: { userId: user.id, isDeleted: false } } },
    include: {
      ConversationParticipant: { select: { userId: true, lastReadAt: true, clearedAt: true, User: { select: { id: true, uid: true, nickname: true, usernameModerationStatus: true, nicknameModerationStatus: true, nicknameViolationDisplay: true, avatarUrl: true, Profile: { select: { displayName: true, displayNameModerationStatus: true, avatarUrl: true } } } } } },
      DirectMessage: { where: { isDeleted: false }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 1, select: { id: true, content: true, moderationStatus: true, createdAt: true, senderId: true } },
    },
  })
  // Sort by the latest visible message, then page.  Conversation.updatedAt is
  // intentionally not used: read markers and other metadata updates must not
  // move an old conversation above a newer one.
  const conversations = conversationRows
    .map((row) => {
      const participant = row.ConversationParticipant.find((item) => item.userId === user.id)
      const latest = row.DirectMessage[0]
      return participant?.clearedAt && latest && latest.createdAt <= participant.clearedAt
        ? { ...row, DirectMessage: [] }
        : row
    })
    .sort((left, right) => compareFriendConversationOrder(
      {
        latestMessageAt: left.DirectMessage[0]?.createdAt || null,
        fallbackAt: left.createdAt,
        stableId: left.id,
      },
      {
        latestMessageAt: right.DirectMessage[0]?.createdAt || null,
        fallbackAt: right.createdAt,
        stableId: right.id,
      },
    ))
    .slice(0, 30)
  const participants = conversations.map((row) => ({
    conversationId: row.id,
    lastReadAt: row.ConversationParticipant.find((participant) => participant.userId === user.id)?.lastReadAt || null,
    clearedAt: row.ConversationParticipant.find((participant) => participant.userId === user.id)?.clearedAt || null,
  }))
  const oldestReadAt = participants.some((item) => !item.lastReadAt)
    ? null
    : participants.reduce<Date | null>((oldest, item) => !oldest || (item.lastReadAt && item.lastReadAt < oldest) ? item.lastReadAt : oldest, null)
  const oldestClearedAt = participants.some((item) => !item.clearedAt)
    ? null
    : participants.reduce<Date | null>((oldest, item) => !oldest || (item.clearedAt && item.clearedAt < oldest) ? item.clearedAt : oldest, null)
  const oldestBoundary = oldestReadAt && oldestClearedAt
    ? (oldestReadAt < oldestClearedAt ? oldestReadAt : oldestClearedAt)
    : oldestReadAt || oldestClearedAt
  const incoming = conversations.length ? await prisma.directMessage.findMany({
    where: {
      conversationId: { in: conversations.map((row) => row.id) },
      senderId: { not: user.id },
      isDeleted: false,
      ...(oldestBoundary ? { createdAt: { gt: oldestBoundary } } : {}),
    },
    select: { conversationId: true, createdAt: true },
  }) : []
  const readByConversation = new Map(participants.map((item) => [item.conversationId, item.lastReadAt]))
  const clearedByConversation = new Map(participants.map((item) => [item.conversationId, item.clearedAt]))
  const unreadByConversation = new Map<string, number>()
  incoming.forEach((message) => {
    const lastReadAt = readByConversation.get(message.conversationId)
    const clearedAt = clearedByConversation.get(message.conversationId)
    if ((!clearedAt || message.createdAt > clearedAt) && (!lastReadAt || message.createdAt > lastReadAt)) unreadByConversation.set(message.conversationId, (unreadByConversation.get(message.conversationId) || 0) + 1)
  })
  const otherUserIds = conversations.flatMap((row) => row.ConversationParticipant
    .filter((participant) => participant.userId !== user.id)
    .map((participant) => participant.userId))
  const remarkMap = await loadFriendRemarkMap(user.id, otherUserIds)
  return NextResponse.json({ conversations: conversations.map((row) => {
    const other = row.ConversationParticipant.find((participant) => participant.userId !== user.id)
    const otherUser = other?.User
      ? {
          uid: other.User.uid,
          nickname: getPublicUserDisplayName(other.User),
          avatarUrl: publicImageUrl(other.User.avatarUrl),
          Profile: other.User.Profile ? {
            displayName: resolveFriendDisplayName({
              viewerId: user.id,
              targetUserId: other.User.id,
              fallbackName: getPublicUserDisplayName(other.User),
              remarkMap,
            }),
            avatarUrl: publicImageUrl(other.User.Profile.avatarUrl),
          } : other.User.Profile,
        }
      : null
    const latestMessage = row.DirectMessage[0]
      ? {
          id: row.DirectMessage[0].id,
          content: publicModerationText(row.DirectMessage[0].content, row.DirectMessage[0].moderationStatus),
          createdAt: row.DirectMessage[0].createdAt,
        }
      : null
    return {
      id: row.id,
      lastMessageAt: latestMessage?.createdAt || null,
      otherUser,
      latestMessage,
      unreadCount: unreadByConversation.get(row.id) || 0,
    }
  }) }, { headers: privateHeaders })
}

export async function POST(request: Request) {
  const user = await getCurrentUser()
  if (!user) return unauthenticatedResponse('请先登录', privateHeaders)
  const limited = await enforceApiRateLimit(request, user.id, {
    endpoint: '/api/direct-conversations',
    ip: { limit: 60, windowSeconds: 60 },
    user: { limit: 30, windowSeconds: 60 },
  }, '私信会话创建过于频繁，请稍后再试')
  if (limited) return limited
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
