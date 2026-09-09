import type { Prisma } from '@prisma/client'
import { getPublicUserDisplayName, loadFriendRemarkMap } from '@/lib/friend-remarks'
import { activeUserWhere, normalizeFriendPair } from '@/lib/friends'
import { getFriendDisplayName } from '@/lib/friend-display-name'
import { getForumBoardDisplayName } from '@/lib/boards'
import { publicImageUrl } from '@/lib/images'
import { prisma } from '@/lib/prisma'
import { publicModerationText } from '@/lib/content-moderation'
import { postContentPlainText, summarizePlainText } from '@/lib/share-metadata'
import { canonicalShareUrl } from '@/lib/share-card'
import { parsePostShareSnapshot, postShareUrl, POST_SHARE_UNAVAILABLE_TITLE, type PostShareMessageView, type PostShareSnapshot } from '@/lib/post-share-types'

export const postShareSelect = {
  id: true,
  title: true,
  content: true,
  richContent: true,
  authorId: true,
  status: true,
  moderationStatus: true,
  isDeleted: true,
  User: {
    select: {
      id: true,
      nickname: true,
      nicknameModerationStatus: true,
      nicknameViolationDisplay: true,
      status: true,
      isDeleted: true,
      Profile: { select: { avatarUrl: true } },
    },
  },
  Board: { select: { name: true, slug: true } },
  PostMedia: {
    where: { type: 'IMAGE' as const },
    orderBy: { sortOrder: 'asc' as const },
    take: 1,
    select: { url: true },
  },
} satisfies Prisma.PostSelect

export type ShareablePost = Prisma.PostGetPayload<{ select: typeof postShareSelect }>

export async function findShareablePost(viewerId: string, postId: string) {
  return prisma.post.findFirst({
    where: {
      id: postId,
      status: 'PUBLISHED',
      isDeleted: false,
      User: { status: 'ACTIVE', isDeleted: false, Profile: { isNot: null } },
      OR: [
        { moderationStatus: { in: ['APPROVED', 'VIOLATION'] as const } },
        { authorId: viewerId },
      ],
    },
    select: postShareSelect,
  })
}

export function toPostShareSnapshot(post: ShareablePost): PostShareSnapshot {
  const title = publicModerationText(post.title, post.moderationStatus).trim() || 'E院广场帖子'
  const content = publicModerationText(postContentPlainText(post.content, post.richContent), post.moderationStatus)
  return {
    postId: post.id,
    title: title.slice(0, 120),
    summary: summarizePlainText(content, 180),
    authorName: getPublicUserDisplayName(post.User),
    boardName: getForumBoardDisplayName(post.Board),
    imageUrl: publicImageUrl(post.PostMedia[0]?.url),
  }
}

export function toPostShareMessageView(snapshot: PostShareSnapshot, available = true): PostShareMessageView {
  return {
    ...snapshot,
    url: canonicalShareUrl(postShareUrl(snapshot.postId)),
    available,
  }
}

export function unavailablePostShareView(postId: string): PostShareMessageView {
  return {
    postId,
    title: POST_SHARE_UNAVAILABLE_TITLE,
    summary: '',
    authorName: '',
    boardName: '',
    imageUrl: null,
    url: canonicalShareUrl(postShareUrl(postId)),
    available: false,
  }
}

export async function resolvePostShareViews(
  messages: ReadonlyArray<{ type?: string | null; metadata?: unknown }>,
  viewerId: string,
) {
  const snapshots = messages
    .filter((message) => message.type === 'POST_SHARE')
    .map((message) => parsePostShareSnapshot(message.metadata))
    .filter((snapshot): snapshot is PostShareSnapshot => Boolean(snapshot))
  const uniqueIds = [...new Set(snapshots.map((snapshot) => snapshot.postId))]
  if (!uniqueIds.length) return new Map<string, PostShareMessageView>()

  const posts = await prisma.post.findMany({
    where: {
      id: { in: uniqueIds },
      status: 'PUBLISHED',
      isDeleted: false,
      User: { status: 'ACTIVE', isDeleted: false, Profile: { isNot: null } },
      OR: [
        { moderationStatus: { in: ['APPROVED', 'VIOLATION'] as const } },
        { authorId: viewerId },
      ],
    },
    select: postShareSelect,
  })
  const postMap = new Map(posts.map((post) => [post.id, toPostShareSnapshot(post)]))
  return new Map(snapshots.map((snapshot) => [
    snapshot.postId,
    postMap.has(snapshot.postId)
      ? toPostShareMessageView(postMap.get(snapshot.postId)!, true)
      : unavailablePostShareView(snapshot.postId),
  ]))
}

export type RecentPostShareFriend = Readonly<{
  id: string
  uid: number
  nickname: string
  displayName: string
  avatarUrl: string | null
  conversationId: string
  lastMessageAt: string
}>

const recentShareFriendUserSelect = {
  id: true,
  uid: true,
  nickname: true,
  nicknameModerationStatus: true,
  nicknameViolationDisplay: true,
  avatarUrl: true,
  Profile: { select: { avatarUrl: true } },
} as const

export async function getRecentPostShareFriends(userId: string, limit = 12): Promise<RecentPostShareFriend[]> {
  const candidates = await prisma.conversation.findMany({
    where: {
      ConversationParticipant: { some: { userId, isDeleted: false } },
      DirectMessage: { some: { isDeleted: false } },
    },
    orderBy: [{ lastMessageAt: 'desc' }, { id: 'desc' }],
    take: Math.min(100, Math.max(24, limit * 6)),
    select: {
      id: true,
      lastMessageAt: true,
      ConversationParticipant: { where: { isDeleted: false }, select: { userId: true, clearedAt: true } },
      DirectMessage: { where: { isDeleted: false }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 1, select: { createdAt: true } },
    },
  })
  const candidateByUser = candidates
    .map((conversation) => {
      const participant = conversation.ConversationParticipant.find((item) => item.userId === userId)
      const otherIds = conversation.ConversationParticipant.map((participant) => participant.userId).filter((id) => id !== userId)
      const latestMessage = conversation.DirectMessage[0]
      if (!participant || otherIds.length !== 1 || !latestMessage || (participant.clearedAt && latestMessage.createdAt <= participant.clearedAt)) return null
      return { conversation, friendId: otherIds[0] }
    })
    .filter((item): item is { conversation: typeof candidates[number]; friendId: string } => Boolean(item))
    .sort((left, right) => {
      const leftAt = left.conversation.DirectMessage[0]?.createdAt || left.conversation.lastMessageAt
      const rightAt = right.conversation.DirectMessage[0]?.createdAt || right.conversation.lastMessageAt
      return (rightAt?.getTime() || 0) - (leftAt?.getTime() || 0) || right.conversation.id.localeCompare(left.conversation.id)
    })
  if (!candidateByUser.length) return []

  const candidateIds = [...new Set(candidateByUser.map((item) => item.friendId))]
  const [friendships, blockedRows, users] = await Promise.all([
    prisma.friendship.findMany({
      where: {
        OR: [
          { userAId: userId, userBId: { in: candidateIds }, User_Friendship_userAIdToUser: activeUserWhere, User_Friendship_userBIdToUser: activeUserWhere },
          { userBId: userId, userAId: { in: candidateIds }, User_Friendship_userAIdToUser: activeUserWhere, User_Friendship_userBIdToUser: activeUserWhere },
        ],
      },
      select: { userAId: true, userBId: true },
    }),
    prisma.block.findMany({
      where: {
        OR: [
          { blockerId: userId, blockedId: { in: candidateIds } },
          { blockedId: userId, blockerId: { in: candidateIds } },
        ],
      },
      select: { blockerId: true, blockedId: true },
    }),
    prisma.user.findMany({ where: { id: { in: candidateIds }, ...activeUserWhere }, select: recentShareFriendUserSelect }),
  ])
  const friendIds = new Set(friendships.map((row) => row.userAId === userId ? row.userBId : row.userAId))
  const blockedIds = new Set(blockedRows.map((row) => row.blockerId === userId ? row.blockedId : row.blockerId))
  const userMap = new Map(users.map((user) => [user.id, user]))
  const remarkMap = await loadFriendRemarkMap(userId, friendIds)
  const result: RecentPostShareFriend[] = []
  for (const item of candidateByUser) {
    if (!friendIds.has(item.friendId) || blockedIds.has(item.friendId) || result.some((friend) => friend.id === item.friendId)) continue
    const friend = userMap.get(item.friendId)
    if (!friend) continue
    const nickname = getPublicUserDisplayName(friend)
    const friendRemark = remarkMap.get(friend.id) || null
    const lastMessageAt = item.conversation.DirectMessage[0]?.createdAt || item.conversation.lastMessageAt
    if (!lastMessageAt) continue
    result.push({
      id: friend.id,
      uid: friend.uid,
      nickname,
      displayName: getFriendDisplayName({ nickname, friendRemark, isFriendContext: true }),
      avatarUrl: publicImageUrl(friend.Profile?.avatarUrl || friend.avatarUrl),
      conversationId: item.conversation.id,
      lastMessageAt: lastMessageAt.toISOString(),
    })
    if (result.length >= limit) break
  }
  return result
}

export async function assertFriendShareTarget(userId: string, recipientId: string) {
  if (!recipientId || recipientId === userId) return false
  const [recipient, friendship, block] = await Promise.all([
    prisma.user.findFirst({ where: { id: recipientId, ...activeUserWhere }, select: { id: true } }),
    (() => {
      const [userAId, userBId] = normalizeFriendPair(userId, recipientId)
      return prisma.friendship.findUnique({ where: { userAId_userBId: { userAId, userBId } }, select: { id: true } })
    })(),
    prisma.block.findFirst({
      where: {
        OR: [
          { blockerId: userId, blockedId: recipientId },
          { blockerId: recipientId, blockedId: userId },
        ],
      },
      select: { id: true },
    }),
  ])
  return Boolean(recipient && friendship && !block)
}
