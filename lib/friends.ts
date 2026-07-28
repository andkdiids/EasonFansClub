import { prisma } from '@/lib/prisma'

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
  if (friendship) return { status: 200 as const, body: { message: '已是好友', status: 'FRIEND' } }

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
  if (existing) return { status: 200 as const, body: { message: '等待通过', status: 'PENDING', request: existing } }

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

    await tx.notification.create({
      data: {
        recipientId: receiver.id,
        actorId: currentUser.id,
        type: 'FRIEND_REQUEST',
        title: '好友申请',
        content: `${currentUser.nickname} 向你发送了好友申请`,
        link: '/friends#received-requests',
      },
    })

    return request
  })

  return { status: 201 as const, body: { message: '好友申请已发送', status: 'PENDING', request: friendRequest } }
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
      await tx.notification.create({
        data: {
          recipientId: friendRequest.senderId,
          actorId: friendRequest.receiverId,
          type: 'FRIEND_REQUEST',
          title: '好友申请已通过',
          content: '你的好友申请已通过',
          link: '/friends#received-requests',
        },
      })
    }

    return updated
  })

  if (!result) return { status: 404 as const, body: { message: '好友申请不存在或已处理' } }
  return { status: 200 as const, body: { request: result } }
}
