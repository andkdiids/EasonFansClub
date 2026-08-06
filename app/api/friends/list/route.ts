import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import { activeUserWhere } from '@/lib/friends'
import { calculateGrowthSummary, defaultGrowthLevels, listGrowthLevels } from '@/lib/growth'
import { prisma } from '@/lib/prisma'
import { sanitizeText } from '@/lib/security'

const privateHeaders = { 'Cache-Control': 'private, no-store, max-age=0' }

export async function GET(request: Request) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ message: '请先登录' }, { status: 401, headers: privateHeaders })
  const params = new URL(request.url).searchParams
  const q = sanitizeText(params.get('q'), 50)
  const page = Math.max(1, Number(params.get('page')) || 1)
  const pageSize = Math.min(50, Math.max(10, Number(params.get('pageSize')) || 30))

  if (q) return searchUsers(user.id, q)

  const [rows, growthLevels] = await Promise.all([
    prisma.friendship.findMany({
      where: {
        OR: [
          { userAId: user.id, User_Friendship_userBIdToUser: activeUserWhere },
          { userBId: user.id, User_Friendship_userAIdToUser: activeUserWhere },
        ],
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      skip: (page - 1) * pageSize,
      take: pageSize + 1,
      include: {
        User_Friendship_userAIdToUser: { select: publicFriendSelect },
        User_Friendship_userBIdToUser: { select: publicFriendSelect },
      },
    }),
    listGrowthLevels().catch(() => [...defaultGrowthLevels]),
  ])
  const friendRows = rows.slice(0, pageSize)
  const friendIds = friendRows.map((row) => row.userAId === user.id ? row.userBId : row.userAId)
  const conversations = friendIds.length ? await prisma.conversation.findMany({
    where: {
      ConversationParticipant: {
        some: { userId: user.id, isDeleted: false },
      },
      AND: [{
        ConversationParticipant: { some: { userId: { in: friendIds }, isDeleted: false } },
      }],
    },
    select: {
      id: true,
      lastMessageAt: true,
      ConversationParticipant: { select: { userId: true, lastReadAt: true } },
      DirectMessage: {
        where: { isDeleted: false },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: 1,
        select: { id: true, content: true, createdAt: true, senderId: true, type: true },
      },
    },
  }) : []
  const conversationByFriend = new Map(conversations.map((conversation) => {
    const otherId = conversation.ConversationParticipant.find((item) => item.userId !== user.id)?.userId
    return [otherId, conversation] as const
  }))
  const unreadByConversation = await getUnreadCounts(user.id, conversations.map((item) => item.id))

  const friends = friendRows.map((row) => {
    const friend = row.userAId === user.id ? row.User_Friendship_userBIdToUser : row.User_Friendship_userAIdToUser
    const conversation = conversationByFriend.get(friend.id)
    const growth = calculateGrowthSummary(friend.experience, growthLevels)
    return {
      ...serializePublicUser(friend, growth.level, growth.levelName),
      conversationId: conversation?.id || null,
      lastMessage: conversation?.DirectMessage[0] || null,
      lastMessageAt: conversation?.lastMessageAt || null,
      unreadCount: conversation ? unreadByConversation.get(conversation.id) || 0 : 0,
    }
  }).sort((a, b) =>
    Number(b.unreadCount > 0) - Number(a.unreadCount > 0)
    || b.unreadCount - a.unreadCount
    || (b.lastMessageAt?.getTime() || 0) - (a.lastMessageAt?.getTime() || 0)
    || a.nickname.localeCompare(b.nickname, 'zh-CN'),
  )

  return NextResponse.json({ friends, page, hasMore: rows.length > pageSize }, { headers: privateHeaders })
}

async function searchUsers(currentUserId: string, q: string) {
  const numericUid = /^\d+$/.test(q) ? Number(q) : null
  const [users, growthLevels] = await Promise.all([
    prisma.user.findMany({
      where: {
        uid: { gt: 0 },
        ...activeUserWhere,
        OR: [
          ...(Number.isSafeInteger(numericUid) && Number(numericUid) > 0 ? [{ uid: Number(numericUid) }] : []),
          { nickname: { contains: q } },
          { username: { contains: q } },
          { Profile: { displayName: { contains: q } } },
        ],
      },
      orderBy: [{ lastActiveAt: 'desc' }, { uid: 'asc' }],
      take: 20,
      select: publicFriendSelect,
    }),
    listGrowthLevels().catch(() => [...defaultGrowthLevels]),
  ])
  const ids = users.map((item) => item.id)
  const [friendships, requests, blocks] = ids.length ? await Promise.all([
    prisma.friendship.findMany({
      where: { OR: [
        { userAId: currentUserId, userBId: { in: ids } },
        { userBId: currentUserId, userAId: { in: ids } },
      ] },
      select: { userAId: true, userBId: true },
    }),
    prisma.friendRequest.findMany({
      where: {
        status: 'PENDING',
        OR: [
          { senderId: currentUserId, receiverId: { in: ids } },
          { receiverId: currentUserId, senderId: { in: ids } },
        ],
      },
      select: { id: true, senderId: true, receiverId: true },
    }),
    prisma.block.findMany({
      where: { OR: [
        { blockerId: currentUserId, blockedId: { in: ids } },
        { blockedId: currentUserId, blockerId: { in: ids } },
      ] },
      select: { blockerId: true, blockedId: true },
    }),
  ]) : [[], [], []]
  const friendIds = new Set(friendships.flatMap((item) => [item.userAId, item.userBId]).filter((id) => id !== currentUserId))
  const blockedIds = new Set(blocks.flatMap((item) => [item.blockerId, item.blockedId]).filter((id) => id !== currentUserId))

  return NextResponse.json({
    results: users.map((item) => {
      const request = requests.find((row) => row.senderId === item.id || row.receiverId === item.id)
      const relationshipStatus =
        item.id === currentUserId ? 'SELF'
          : blockedIds.has(item.id) ? 'BLOCKED'
            : friendIds.has(item.id) ? 'FRIEND'
              : request?.senderId === currentUserId ? 'OUTGOING_PENDING'
                : request ? 'INCOMING_PENDING'
                  : 'NONE'
      const growth = calculateGrowthSummary(item.experience, growthLevels)
      return {
        ...serializePublicUser(item, growth.level, growth.levelName),
        relationshipStatus,
        requestId: relationshipStatus === 'INCOMING_PENDING' ? request?.id : null,
      }
    }),
  }, { headers: privateHeaders })
}

async function getUnreadCounts(userId: string, conversationIds: string[]) {
  if (!conversationIds.length) return new Map<string, number>()
  const participantRows = await prisma.conversationParticipant.findMany({
    where: { userId, conversationId: { in: conversationIds }, isDeleted: false },
    select: { conversationId: true, lastReadAt: true },
  })
  const oldestReadAt = participantRows.some((item) => !item.lastReadAt)
    ? null
    : participantRows.reduce<Date | null>((oldest, item) => (
      !oldest || (item.lastReadAt && item.lastReadAt < oldest) ? item.lastReadAt : oldest
    ), null)
  const incoming = await prisma.directMessage.findMany({
    where: {
      conversationId: { in: conversationIds },
      senderId: { not: userId },
      isDeleted: false,
      ...(oldestReadAt ? { createdAt: { gt: oldestReadAt } } : {}),
    },
    select: { conversationId: true, createdAt: true },
  })
  const lastReadByConversation = new Map(participantRows.map((item) => [item.conversationId, item.lastReadAt]))
  const counts = new Map<string, number>()
  incoming.forEach((message) => {
    const lastReadAt = lastReadByConversation.get(message.conversationId)
    if (!lastReadAt || message.createdAt > lastReadAt) {
      counts.set(message.conversationId, (counts.get(message.conversationId) || 0) + 1)
    }
  })
  return counts
}

const publicFriendSelect = {
  id: true,
  uid: true,
  nickname: true,
  avatarUrl: true,
  bio: true,
  experience: true,
  isOnline: true,
  lastActiveAt: true,
  createdAt: true,
  Profile: { select: { displayName: true, avatarUrl: true, bio: true } },
} as const

function serializePublicUser(
  friend: {
    id: string
    uid: number
    nickname: string
    avatarUrl: string | null
    bio: string | null
    isOnline: boolean
    lastActiveAt: Date | null
    createdAt: Date
    Profile: { displayName: string | null; avatarUrl: string | null; bio: string | null } | null
  },
  level: number,
  levelName: string,
) {
  return {
    id: friend.id,
    uid: friend.uid,
    nickname: friend.nickname,
    avatarUrl: friend.avatarUrl,
    bio: friend.bio,
    isOnline: friend.isOnline,
    lastActiveAt: friend.lastActiveAt,
    createdAt: friend.createdAt,
    level,
    levelName,
    profile: friend.Profile,
  }
}
