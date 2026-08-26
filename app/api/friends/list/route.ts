import { NextResponse } from 'next/server'
import { activeUserWhere } from '@/lib/friends'
import { getFriendDisplayName, getPublicUserDisplayName, loadFriendRemarkMap, normalizeFriendRemark } from '@/lib/friend-remarks'
import { getUndercoverPresenceForUsers } from '@/lib/undercover-star'
import { calculateGrowthSummary, defaultGrowthLevels, listGrowthLevels } from '@/lib/growth'
import { compareFriendConversationOrder } from '@/lib/friend-conversation-order'
import { publicImageUrl } from '@/lib/images'
import { prisma } from '@/lib/prisma'
import { enforceApiRateLimit, requireUser, sanitizeText } from '@/lib/security'
import { publicModerationText } from '@/lib/content-moderation'
import { getEquippedBadgesForUsers } from '@/lib/badge-service'
import type { EquippedBadgeView } from '@/lib/badge-types'
import { belongsToFriendGroup, buildFriendGroupIndex, UNGROUPED_FRIEND_GROUP_ID } from '@/lib/friend-grouping'

const privateHeaders = { 'Cache-Control': 'private, no-store, max-age=0' }

export async function GET(request: Request) {
  const guard = await requireUser()
  if (!guard.user) return guard.response
  const user = guard.user
  const limited = await enforceApiRateLimit(request, user.id, {
    endpoint: '/api/friends/list',
    ip: { limit: 240, windowSeconds: 60 },
    user: { limit: 120, windowSeconds: 60 },
  })
  if (limited) return limited
  const params = new URL(request.url).searchParams
  const q = sanitizeText(params.get('q'), 50)
  if (q && q.length < 2) {
    return NextResponse.json({ results: [] }, { headers: privateHeaders })
  }
  const rawPage = Number(params.get('page'))
  const rawPageSize = Number(params.get('pageSize'))
  const page = Math.min(10_000, Math.max(1, Number.isFinite(rawPage) ? rawPage : 1))
  const pageSize = Math.min(50, Math.max(10, Number.isFinite(rawPageSize) ? rawPageSize : 30))
  const requestedGroupId = params.get('groupId')?.trim() || null

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
  if (requestedGroupId && requestedGroupId !== UNGROUPED_FRIEND_GROUP_ID && !groupRows.some((group) => group.id === requestedGroupId)) {
    return NextResponse.json({ message: '分组不存在' }, { status: 404, headers: privateHeaders })
  }
  const validGroupIds = new Set(groupRows.map((group) => group.id))
  const { groupByFriend, groupCounts, ungroupedCount } = buildFriendGroupIndex(
    friendIds,
    groupMembers.filter((member) => validGroupIds.has(member.groupId)),
  )
  const groups = groupRows.map((group) => ({ ...group, count: groupCounts.get(group.id) || 0 }))
  const scopedFriendRows = requestedGroupId
    ? friendRows.filter((row) => {
        const friendId = row.userAId === user.id ? row.userBId : row.userAId
        return belongsToFriendGroup(friendId, requestedGroupId, groupByFriend)
      })
    : friendRows
  const scopedFriendIds = scopedFriendRows.map((row) => row.userAId === user.id ? row.userBId : row.userAId)
  const conversations = scopedFriendIds.length ? await prisma.conversation.findMany({
      where: {
        ConversationParticipant: {
          some: { userId: user.id, isDeleted: false },
        },
        AND: [{
          ConversationParticipant: { some: { userId: { in: scopedFriendIds }, isDeleted: false } },
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

  const orderedFriendRows = scopedFriendRows
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
  const [unreadByConversation, remarkMap, presenceByFriend, equippedBadgeMap] = await Promise.all([
    getUnreadCounts(user.id, visibleConversationIds),
    loadFriendRemarkMap(user.id, visibleFriendIds),
    getUndercoverPresenceForUsers(visibleFriendIds),
    getEquippedBadgesForUsers(visibleFriendIds),
  ])

  const friends = visibleRows.map(({ friend, conversation }) => {
    const growth = calculateGrowthSummary(friend.experience, growthLevels)
    return {
      ...serializePublicUser(friend, growth.level, growth.levelName, remarkMap.get(friend.id) || null, equippedBadgeMap.get(friend.id) || null, true),
      groupId: groupByFriend.get(friend.id) || null,
      conversationId: conversation?.id || null,
      lastMessage: conversation?.DirectMessage[0] || null,
      // Derive this from the latest visible message instead of the mutable
      // conversation metadata.  This keeps legacy/stale lastMessageAt values
      // and deleted messages from changing the displayed order.
      lastMessageAt: conversation?.DirectMessage[0]?.createdAt || null,
      unreadCount: conversation ? unreadByConversation.get(conversation.id) || 0 : 0,
      undercoverPresence: presenceByFriend.get(friend.id) || null,
    }
  })

  const scopedTotal = scopedFriendRows.length
  return NextResponse.json({
    friends,
    groups,
    ungroupedCount,
    page,
    total: scopedTotal,
    friendTotal: total,
    hasMore: pageStart + pageSize < scopedTotal,
  }, { headers: privateHeaders })
}

async function searchUsers(currentUserId: string, q: string) {
  const numericUid = /^\d+$/.test(q) ? Number(q) : null
  const [nicknameUsers, matchingRemarks, growthLevels] = await Promise.all([
    prisma.user.findMany({
      where: {
        uid: { gt: 0 },
        ...activeUserWhere,
        OR: [
          ...(Number.isSafeInteger(numericUid) && Number(numericUid) > 0 ? [{ uid: Number(numericUid) }] : []),
          { nickname: { contains: q } },
          { Profile: { displayName: { contains: q } } },
        ],
      },
      orderBy: [{ lastActiveAt: 'desc' }, { uid: 'asc' }],
      take: 20,
      select: publicFriendSelect,
    }),
    // FriendDock is an authenticated contact search. Include the viewer's
    // own aliases in its candidate set, but keep the alias itself viewer
    // scoped and still verify the friendship through loadFriendRemarkMap.
    prisma.friendRemark.findMany({
      where: { ownerId: currentUserId, remark: { contains: q } },
      select: { friendId: true },
      take: 100,
    }),
    listGrowthLevels().catch(() => [...defaultGrowthLevels]),
  ])
  const nicknameUserIds = new Set(nicknameUsers.map((item) => item.id))
  const remarkOnlyIds = [...new Set(matchingRemarks.map((item) => item.friendId))]
    .filter((id) => !nicknameUserIds.has(id))
  const remarkOnlyUsers = remarkOnlyIds.length
    ? await prisma.user.findMany({
        where: { ...activeUserWhere, id: { in: remarkOnlyIds } },
        orderBy: [{ lastActiveAt: 'desc' }, { uid: 'asc' }],
        select: publicFriendSelect,
      })
    : []
  const remarkMatchedIds = new Set(matchingRemarks.map((item) => item.friendId))
  const users = [...nicknameUsers, ...remarkOnlyUsers]
    .sort((left, right) => {
      const remarkMatchOrder = Number(remarkMatchedIds.has(right.id)) - Number(remarkMatchedIds.has(left.id))
      if (remarkMatchOrder) return remarkMatchOrder
      const lastActiveOrder = (right.lastActiveAt?.getTime() || 0) - (left.lastActiveAt?.getTime() || 0)
      return lastActiveOrder || left.uid - right.uid
    })
    .slice(0, 20)
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
  const [remarkMap, groupMembers, equippedBadgeMap] = await Promise.all([
    loadFriendRemarkMap(currentUserId, friendIds),
    friendIds.size
      ? prisma.friendGroupMember.findMany({
          where: { ownerId: currentUserId, friendId: { in: [...friendIds] } },
          select: { friendId: true, groupId: true },
        })
      : Promise.resolve([]),
    getEquippedBadgesForUsers(users.map((item) => item.id)),
  ])
  const { groupByFriend } = buildFriendGroupIndex(friendIds, groupMembers)

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
        // A contact search is private. Only an actual current friend gets
        // the viewer-owned alias; pending/non-friend results stay public.
        ...serializePublicUser(item, growth.level, growth.levelName, remarkMap.get(item.id) || null, equippedBadgeMap.get(item.id) || null, relationshipStatus === 'FRIEND'),
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
  nicknameViolationDisplay: true,
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
  friendRemark: string | null = null,
  equippedBadge: EquippedBadgeView | null = null,
  isFriendContext = Boolean(friendRemark),
) {
  const nickname = getPublicUserDisplayName(friend)
  const normalizedRemark = normalizeFriendRemark(friendRemark)
  return {
    id: friend.id,
    uid: friend.uid,
    nickname,
    friendRemark: normalizedRemark,
    displayName: getFriendDisplayName({ nickname, friendRemark: normalizedRemark, isFriendContext }),
    avatarUrl: publicImageUrl(friend.avatarUrl),
    bio: publicModerationText(friend.Profile?.bio || friend.bio, friend.Profile?.bioModerationStatus || friend.bioModerationStatus),
    isOnline: friend.isOnline,
    lastActiveAt: friend.lastActiveAt,
    createdAt: friend.createdAt,
    level,
    levelName,
    equippedBadge,
    // Profile.displayName is a public profile field.  Never replace it with a
    // viewer-owned friend remark.
    profile: friend.Profile ? { ...friend.Profile, avatarUrl: publicImageUrl(friend.Profile.avatarUrl) } : friend.Profile,
  }
}
