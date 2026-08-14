import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import { activeUserWhere } from '@/lib/friends'
import { getPublicUserDisplayName, loadFriendRemarkMap, resolveFriendDisplayName } from '@/lib/friend-remarks'
import { calculateGrowthSummary, defaultGrowthLevels, listGrowthLevels } from '@/lib/growth'
import { compareFriendConversationOrder } from '@/lib/friend-conversation-order'
import { publicImageUrl } from '@/lib/images'
import { prisma } from '@/lib/prisma'
import { sanitizeText } from '@/lib/security'
import { publicModerationText } from '@/lib/content-moderation'

const privateHeaders = { 'Cache-Control': 'private, no-store, max-age=0' }

export async function GET(request: Request) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ message: '请先登录' }, { status: 401, headers: privateHeaders })
  const params = new URL(request.url).searchParams
  const q = sanitizeText(params.get('q'), 50)
  const page = Math.max(1, Number(params.get('page')) || 1)
  const pageSize = Math.min(50, Math.max(10, Number(params.get('pageSize')) || 30))

  if (q) return searchUsers(user.id, q)

  const friendshipWhere = {
    OR: [
      { userAId: user.id, User_Friendship_userBIdToUser: activeUserWhere },
      { userBId: user.id, User_Friendship_userAIdToUser: activeUserWhere },
    ],
  }
  const [rows, total, growthLevels] = await Promise.all([
    prisma.friendship.findMany({
      where: friendshipWhere,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      include: {
        User_Friendship_userAIdToUser: { select: publicFriendSelect },
        User_Friendship_userBIdToUser: { select: publicFriendSelect },
      },
    }),
    prisma.friendship.count({ where: friendshipWhere }),
    listGrowthLevels().catch(() => [...defaultGrowthLevels]),
  ])
  // Load all friendships before paging.  Paging by friendship.createdAt first
  // can hide a later friendship whose conversation just received a message.
  // The actual page is selected only after conversation ordering below.
  const friendRows = rows
  const friendIds = friendRows.map((row) => row.userAId === user.id ? row.userBId : row.userAId)
  const [groupRows, groupMembers] = await Promise.all([
    prisma.friendGroup.findMany({
      where: { ownerId: user.id },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
      select: { id: true, name: true, sortOrder: true, createdAt: true },
    }),
    friendIds.length
      ? prisma.friendGroupMember.findMany({
          where: { ownerId: user.id, friendId: { in: friendIds } },
          select: { friendId: true, groupId: true },
        })
      : Promise.resolve([]),
  ])
  const groupByFriend = new Map(groupMembers.map((member) => [member.friendId, member.groupId]))
  const groupMemberCounts = new Map<string, number>()
  groupMembers.forEach((member) => groupMemberCounts.set(member.groupId, (groupMemberCounts.get(member.groupId) || 0) + 1))
  const groups = groupRows.map((group) => ({ ...group, count: groupMemberCounts.get(group.id) || 0 }))
  const ungroupedCount = Math.max(0, friendIds.length - groupMembers.length)
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
        ConversationParticipant: { select: { userId: true, lastReadAt: true, clearedAt: true } },
        DirectMessage: {
          where: { isDeleted: false },
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          take: 1,
          select: { id: true, content: true, createdAt: true, senderId: true, type: true },
        },
      },
    }) : []
  const visibleConversations = conversations.map((conversation) => {
    const participant = conversation.ConversationParticipant.find((item) => item.userId === user.id)
    const latest = conversation.DirectMessage[0]
    return participant?.clearedAt && latest && latest.createdAt <= participant.clearedAt
      ? { ...conversation, DirectMessage: [] }
      : conversation
  })
  const conversationByFriend = new Map(visibleConversations.map((conversation) => {
    const otherId = conversation.ConversationParticipant.find((item) => item.userId !== user.id)?.userId
    return [otherId, conversation] as const
  }))

  const orderedFriendRows = friendRows
    .map((row) => {
      const friend = row.userAId === user.id ? row.User_Friendship_userBIdToUser : row.User_Friendship_userAIdToUser
      const conversation = conversationByFriend.get(friend.id)
      return { row, friend, conversation }
    })
    .sort((left, right) => compareFriendConversationOrder(
      {
        latestMessageAt: left.conversation?.DirectMessage[0]?.createdAt || null,
        fallbackAt: left.row.createdAt,
        stableId: left.row.id,
      },
      {
        latestMessageAt: right.conversation?.DirectMessage[0]?.createdAt || null,
        fallbackAt: right.row.createdAt,
        stableId: right.row.id,
      },
    ))

  const pageStart = (page - 1) * pageSize
  const visibleRows = orderedFriendRows.slice(pageStart, pageStart + pageSize)
  const visibleFriendIds = visibleRows.map(({ friend }) => friend.id)
  const visibleConversationIds = visibleRows.flatMap(({ conversation }) => conversation ? [conversation.id] : [])
  const [unreadByConversation, remarkMap] = await Promise.all([
    getUnreadCounts(user.id, visibleConversationIds),
    loadFriendRemarkMap(user.id, visibleFriendIds),
  ])

  const friends = visibleRows.map(({ friend, conversation }) => {
    const growth = calculateGrowthSummary(friend.experience, growthLevels)
    const displayName = resolveFriendDisplayName({
      viewerId: user.id,
      targetUserId: friend.id,
      fallbackName: getPublicUserDisplayName(friend),
      remarkMap,
    })
    return {
      ...serializePublicUser(friend, growth.level, growth.levelName, displayName),
      groupId: groupByFriend.get(friend.id) || null,
      conversationId: conversation?.id || null,
      lastMessage: conversation?.DirectMessage[0] || null,
      // Derive this from the latest visible message instead of the mutable
      // conversation metadata.  This keeps legacy/stale lastMessageAt values
      // and deleted messages from changing the displayed order.
      lastMessageAt: conversation?.DirectMessage[0]?.createdAt || null,
      unreadCount: conversation ? unreadByConversation.get(conversation.id) || 0 : 0,
    }
  })

  return NextResponse.json({ friends, groups, ungroupedCount, page, total, hasMore: pageStart + pageSize < total }, { headers: privateHeaders })
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
  const [remarkMap, groupMembers] = await Promise.all([
    loadFriendRemarkMap(currentUserId, friendIds),
    friendIds.size
      ? prisma.friendGroupMember.findMany({
          where: { ownerId: currentUserId, friendId: { in: [...friendIds] } },
          select: { friendId: true, groupId: true },
        })
      : Promise.resolve([]),
  ])
  const groupByFriend = new Map(groupMembers.map((member) => [member.friendId, member.groupId]))

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
      const displayName = resolveFriendDisplayName({
        viewerId: currentUserId,
        targetUserId: item.id,
        fallbackName: getPublicUserDisplayName(item),
        remarkMap,
      })
      return {
        ...serializePublicUser(item, growth.level, growth.levelName, displayName),
        groupId: groupByFriend.get(item.id) || null,
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
    select: { conversationId: true, lastReadAt: true, clearedAt: true },
  })
  const oldestReadAt = participantRows.some((item) => !item.lastReadAt)
    ? null
    : participantRows.reduce<Date | null>((oldest, item) => (
      !oldest || (item.lastReadAt && item.lastReadAt < oldest) ? item.lastReadAt : oldest
    ), null)
  const oldestClearedAt = participantRows.some((item) => !item.clearedAt)
    ? null
    : participantRows.reduce<Date | null>((oldest, item) => (
      !oldest || (item.clearedAt && item.clearedAt < oldest) ? item.clearedAt : oldest
    ), null)
  const oldestBoundary = oldestReadAt && oldestClearedAt
    ? (oldestReadAt < oldestClearedAt ? oldestReadAt : oldestClearedAt)
    : oldestReadAt || oldestClearedAt
  const incoming = await prisma.directMessage.findMany({
    where: {
      conversationId: { in: conversationIds },
      senderId: { not: userId },
      isDeleted: false,
      ...(oldestBoundary ? { createdAt: { gt: oldestBoundary } } : {}),
    },
    select: { conversationId: true, createdAt: true },
  })
  const lastReadByConversation = new Map(participantRows.map((item) => [item.conversationId, item.lastReadAt]))
  const clearedByConversation = new Map(participantRows.map((item) => [item.conversationId, item.clearedAt]))
  const counts = new Map<string, number>()
  incoming.forEach((message) => {
    const lastReadAt = lastReadByConversation.get(message.conversationId)
    const clearedAt = clearedByConversation.get(message.conversationId)
    if ((!clearedAt || message.createdAt > clearedAt) && (!lastReadAt || message.createdAt > lastReadAt)) {
      counts.set(message.conversationId, (counts.get(message.conversationId) || 0) + 1)
    }
  })
  return counts
}

const publicFriendSelect = {
  id: true,
  uid: true,
  nickname: true,
  usernameModerationStatus: true,
  nicknameModerationStatus: true,
  bioModerationStatus: true,
  avatarUrl: true,
  bio: true,
  experience: true,
  isOnline: true,
  lastActiveAt: true,
  createdAt: true,
  Profile: { select: { displayName: true, displayNameModerationStatus: true, avatarUrl: true, bio: true, bioModerationStatus: true } },
} as const

function serializePublicUser(
  friend: {
    id: string
    uid: number
    nickname: string
    usernameModerationStatus?: string | null
    nicknameModerationStatus?: string | null
    bioModerationStatus?: string | null
    avatarUrl: string | null
    bio: string | null
    isOnline: boolean
    lastActiveAt: Date | null
    createdAt: Date
    Profile: { displayName: string | null; displayNameModerationStatus?: string | null; avatarUrl: string | null; bio: string | null; bioModerationStatus?: string | null } | null
  },
  level: number,
  levelName: string,
  displayName = getPublicUserDisplayName(friend),
) {
  return {
    id: friend.id,
    uid: friend.uid,
    nickname: getPublicUserDisplayName(friend),
    avatarUrl: publicImageUrl(friend.avatarUrl),
    bio: publicModerationText(friend.Profile?.bio || friend.bio, friend.Profile?.bioModerationStatus || friend.bioModerationStatus),
    isOnline: friend.isOnline,
    lastActiveAt: friend.lastActiveAt,
    createdAt: friend.createdAt,
    level,
    levelName,
    profile: friend.Profile ? { ...friend.Profile, avatarUrl: publicImageUrl(friend.Profile.avatarUrl), displayName } : friend.Profile,
  }
}
