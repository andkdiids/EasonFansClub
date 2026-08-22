import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import { activeUserWhere } from '@/lib/friends'
import { getPublicUserDisplayName, loadFriendRemarkMap, resolveFriendDisplayName } from '@/lib/friend-remarks'
import { publicImageUrl } from '@/lib/images'
import { prisma } from '@/lib/prisma'
import { enforceApiRateLimit, sanitizeText } from '@/lib/security'
import { formatUid } from '@/lib/uid'

const privateHeaders = { 'Cache-Control': 'private, no-store, max-age=0' }
const MENTION_HISTORY_DAYS = 90

export async function GET(request: Request) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ message: '请先登录' }, { status: 401, headers: privateHeaders })
  const limited = await enforceApiRateLimit(request, user.id, {
    endpoint: '/api/friends/mentions',
    ip: { limit: 120, windowSeconds: 60 },
    user: { limit: 60, windowSeconds: 60 },
  })
  if (limited) return limited
  const q = sanitizeText(new URL(request.url).searchParams.get('q'), 50).toLocaleLowerCase('zh-CN')

  const friendships = await prisma.friendship.findMany({
    where: {
      OR: [
        { userAId: user.id, User_Friendship_userBIdToUser: activeUserWhere },
        { userBId: user.id, User_Friendship_userAIdToUser: activeUserWhere },
      ],
    },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: 300,
    include: {
      User_Friendship_userAIdToUser: { select: mentionFriendSelect },
      User_Friendship_userBIdToUser: { select: mentionFriendSelect },
    },
  })

  const friends = friendships.map((row) => ({
    friendshipCreatedAt: row.createdAt,
    user: row.userAId === user.id ? row.User_Friendship_userBIdToUser : row.User_Friendship_userAIdToUser,
  }))
  const friendIds = friends.map((item) => item.user.id)
  const cutoff = new Date(Date.now() - MENTION_HISTORY_DAYS * 24 * 60 * 60 * 1000)

  const [mentionStats, conversations, remarkMap] = friendIds.length ? await Promise.all([
    prisma.replyMention.groupBy({
      by: ['mentionedUserId'],
      where: { mentionerId: user.id, mentionedUserId: { in: friendIds }, createdAt: { gte: cutoff } },
      _count: { _all: true },
      _max: { createdAt: true },
    }),
    prisma.conversation.findMany({
      where: {
        ConversationParticipant: { some: { userId: user.id, isDeleted: false } },
        AND: [{ ConversationParticipant: { some: { userId: { in: friendIds }, isDeleted: false } } }],
      },
      select: {
        lastMessageAt: true,
        ConversationParticipant: { select: { userId: true } },
      },
    }),
    loadFriendRemarkMap(user.id, friendIds),
  ]) : [[], [], new Map<string, string>()]

  const statsByFriend = new Map(mentionStats.map((item) => [item.mentionedUserId, {
    count: item._count._all,
    lastMentionAt: item._max.createdAt,
  }]))
  const interactionByFriend = new Map(conversations.flatMap((conversation) => (
    conversation.ConversationParticipant
      .filter((item) => item.userId !== user.id)
      .map((item) => [item.userId, conversation.lastMessageAt] as const)
  )))

  const results = friends
    .map(({ user: friend, friendshipCreatedAt }) => {
      const name = resolveFriendDisplayName({
        viewerId: user.id,
        targetUserId: friend.id,
        fallbackName: getPublicUserDisplayName(friend),
        remarkMap,
      })
      const normalized = {
        uid: formatUid(friend.uid).toLocaleLowerCase('zh-CN'),
        rawUid: String(friend.uid),
        nickname: friend.nickname.toLocaleLowerCase('zh-CN'),
        displayName: (friend.Profile?.displayName || '').toLocaleLowerCase('zh-CN'),
        remark: (remarkMap.get(friend.id) || '').toLocaleLowerCase('zh-CN'),
      }
      const matchRank = !q ? 0
        : normalized.uid === q || normalized.rawUid === q ? 1
          : normalized.nickname === q || normalized.displayName === q || normalized.remark === q ? 2
            : normalized.uid.startsWith(q) || normalized.rawUid.startsWith(q) ? 3
              : normalized.nickname.includes(q) || normalized.displayName.includes(q) || normalized.remark.includes(q) ? 4
                : 99
      const stat = statsByFriend.get(friend.id)
      return {
        id: friend.id,
        uid: friend.uid,
        name,
        avatarUrl: publicImageUrl(friend.Profile?.avatarUrl || friend.avatarUrl),
        matchRank,
        mentionCount: stat?.count || 0,
        lastMentionAt: stat?.lastMentionAt?.getTime() || 0,
        lastInteractionAt: interactionByFriend.get(friend.id)?.getTime() || friendshipCreatedAt.getTime(),
      }
    })
    .filter((item) => item.matchRank < 99)
    .sort((a, b) =>
      a.matchRank - b.matchRank
      || b.mentionCount - a.mentionCount
      || b.lastMentionAt - a.lastMentionAt
      || b.lastInteractionAt - a.lastInteractionAt
      || a.name.localeCompare(b.name, 'zh-CN'),
    )
    .slice(0, q ? 20 : 6)
    .map((item) => ({
      id: item.id,
      uid: item.uid,
      name: item.name,
      avatarUrl: item.avatarUrl,
    }))

  return NextResponse.json({ friends: results }, { headers: privateHeaders })
}

const mentionFriendSelect = {
  id: true,
  uid: true,
  nickname: true,
  usernameModerationStatus: true,
  nicknameModerationStatus: true,
  nicknameViolationDisplay: true,
  avatarUrl: true,
  Profile: { select: { displayName: true, displayNameModerationStatus: true, avatarUrl: true } },
} as const
