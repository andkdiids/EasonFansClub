import { prisma } from '@/lib/prisma'
import { getFriendRequestAcceptedNotificationKey, getFriendRequestNotificationKey } from '@/lib/notifications'
import { emitRealtimeMany } from '@/lib/realtime'
import { safeNotificationWrite } from '@/lib/notification-transaction'
import { createNotification } from '@/lib/notification-write'

export const activeUserWhere = {
  status: 'ACTIVE' as const,
  isDeleted: false,
  Profile: { isNot: null },
}

export function normalizeFriendPair(userId: string, otherUserId: string) {
  return [userId, otherUserId].sort() as [string, string]
}

export async function getFriendIds(userId: string) {
  const friendships = await prisma.friendship.findMany({
    where: {
      AND: [
        { OR: [{ userAId: userId }, { userBId: userId }] },
        { User_Friendship_userAIdToUser: activeUserWhere },
        { User_Friendship_userBIdToUser: activeUserWhere },
      ],
    },
    select: { userAId: true, userBId: true },
  })
  return friendships.map((item) => (item.userAId === userId ? item.userBId : item.userAId))
}

/**
 * Returns only private friend-follow marks that still point at a current friend.
 * Keeping the friendship ids as the input makes the friendship permission check
 * explicit at every caller and prevents stale follow rows from affecting reads.
 */
export async function getFriendFollowedIds(userId: string, friendIds: string[]) {
  const ids = [...new Set(friendIds)].filter((id) => id && id !== userId)
  if (!ids.length) return []

  const follows = await prisma.friendFollow.findMany({
    where: { followerId: userId, followedId: { in: ids } },
    select: { followedId: true },
  })
  return follows.map((item) => item.followedId)
}

export const friendUserSelect = {
  id: true,
  uid: true,
  nickname: true,
  avatarUrl: true,
  bio: true,
  status: true,
  isDeleted: true,
  Profile: {
    select: {
      displayName: true,
      avatarUrl: true,
      bio: true,
    },
  },
}

export async function createFriendRequest(
  currentUser: { id: string; nickname: string },
  receiverUid: number,
  message?: string | null,
) {
  const receiver = await prisma.user.findFirst({
    where: { uid: receiverUid, ...activeUserWhere },
    select: { id: true, uid: true, nickname: true, Profile: true },
  })

  if (!receiver) return { status: 404 as const, body: { message: '用户不存在' } }
  if (receiver.id === currentUser.id) return { status: 400 as const, body: { message: '不能添加自己' } }

  const [userAId, userBId] = normalizeFriendPair(currentUser.id, receiver.id)
  const friendship = await prisma.friendship.findUnique({
    where: { userAId_userBId: { userAId, userBId } },
  })
  if (friendship) return { status: 409 as const, body: { message: '你们已经是好友', status: 'FRIEND' } }

  const existing = await prisma.friendRequest.findFirst({
    where: {
      status: 'PENDING',
      OR: [
        { senderId: currentUser.id, receiverId: receiver.id },
        { senderId: receiver.id, receiverId: currentUser.id },
      ],
    },
    include: {
      User_FriendRequest_senderIdToUser: { select: friendUserSelect },
      User_FriendRequest_receiverIdToUser: { select: friendUserSelect },
    },
  })
  if (existing) {
    const incoming = existing.receiverId === currentUser.id
    return {
      status: 409 as const,
      body: {
        message: incoming ? '对方已向你发送好友申请' : '好友申请已发送，请等待对方处理',
        status: incoming ? 'INCOMING_PENDING' : 'OUTGOING_PENDING',
        request: existing,
      },
    }
  }

  const friendRequest = await prisma.$transaction(async (tx) => {
    const request = await tx.friendRequest.create({
      data: {
        senderId: currentUser.id,
        receiverId: receiver.id,
        status: 'PENDING',
        message: message || null,
      },
      include: {
        User_FriendRequest_senderIdToUser: { select: friendUserSelect },
        User_FriendRequest_receiverIdToUser: { select: friendUserSelect },
      },
    })

    return request
  }, { timeout: 15_000, maxWait: 5_000 })

  await safeNotificationWrite(
    () => createNotification({
      data: {
        recipientId: receiver.id,
        actorId: currentUser.id,
        type: 'FRIEND_REQUEST',
        title: '好友申请',
        content: `${currentUser.nickname} 向你发送了好友申请`,
        link: '/friends#received-requests',
        key: getFriendRequestNotificationKey(friendRequest.id),
      },
    }),
    { operation: 'friend-request-created', userId: receiver.id, notificationType: 'FRIEND_REQUEST' },
  )

  emitRealtimeMany([currentUser.id, receiver.id], 'friend-request', { requestId: friendRequest.id })

  return { status: 201 as const, body: { message: '好友申请已发送', status: 'OUTGOING_PENDING', request: friendRequest } }
}

export async function decideFriendRequest(userId: string, requestId: string, action: 'accept' | 'reject') {
  const result = await prisma.$transaction(async (tx) => {
    const friendRequest = await tx.friendRequest.findFirst({
      where: {
        id: requestId,
        receiverId: userId,
        status: 'PENDING',
        User_FriendRequest_senderIdToUser: activeUserWhere,
      },
      include: { User_FriendRequest_senderIdToUser: { select: { nickname: true } } },
    })
    if (!friendRequest) return null

    const updated = await tx.friendRequest.update({
      where: { id: requestId },
      data: { status: action === 'accept' ? 'ACCEPTED' : 'REJECTED' },
    })
    if (action === 'accept') {
      const [userAId, userBId] = normalizeFriendPair(friendRequest.senderId, friendRequest.receiverId)
      await tx.friendship.upsert({
        where: { userAId_userBId: { userAId, userBId } },
        update: {},
        create: { userAId, userBId },
      })
    }

    return {
      request: updated,
      senderId: friendRequest.senderId,
      receiverId: friendRequest.receiverId,
      requestCreatedAt: friendRequest.createdAt,
    }
  }, { timeout: 15_000, maxWait: 5_000 })

  if (!result) return { status: 404 as const, body: { message: '好友申请不存在或已处理' }, badgeEvaluationUserIds: [] as string[] }
  await safeNotificationWrite(async () => {
    const exactNotification = await prisma.notification.findFirst({
      where: {
        recipientId: userId,
        type: 'FRIEND_REQUEST',
        key: getFriendRequestNotificationKey(requestId),
        isRead: false,
      },
      select: { id: true },
    })
    const legacyNotification = exactNotification ? null : await prisma.notification.findFirst({
      where: {
        recipientId: userId,
        actorId: result.senderId,
        type: 'FRIEND_REQUEST',
        title: '好友申请',
        key: null,
        isRead: false,
        createdAt: { gte: result.requestCreatedAt },
      },
      orderBy: { createdAt: 'desc' },
      select: { id: true },
    })
    const requestNotification = exactNotification || legacyNotification
    if (requestNotification) {
      await prisma.notification.update({
        where: { id: requestNotification.id },
        data: { isRead: true, readAt: new Date() },
      })
    }
  }, { operation: 'friend-request-mark-read', userId, notificationType: 'FRIEND_REQUEST' })
  if (action === 'accept') {
    await safeNotificationWrite(
      () => createNotification({
        data: {
          recipientId: result.senderId,
          actorId: result.receiverId,
          type: 'FRIEND_REQUEST',
          title: '好友申请已通过',
          content: '你的好友申请已通过',
          link: '/friends#received-requests',
          key: getFriendRequestAcceptedNotificationKey(requestId),
        },
      }),
      { operation: 'friend-request-accepted', userId: result.senderId, notificationType: 'FRIEND_REQUEST' },
    )
  }
  emitRealtimeMany([result.senderId, result.receiverId], 'friend-request', { requestId })
  return {
    status: 200 as const,
    body: { request: result.request },
    badgeEvaluationUserIds: action === 'accept' ? [result.senderId, result.receiverId] : [],
  }
}
