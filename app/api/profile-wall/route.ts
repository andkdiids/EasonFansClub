import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import { getPublicUserDisplayName, loadFriendRemarkMap, resolveFriendDisplayName } from '@/lib/friend-remarks'
import { normalizeFriendPair } from '@/lib/friends'
import { prisma } from '@/lib/prisma'
import { containsSensitiveContent, sanitizeText } from '@/lib/security'

type WallVisibility = 'PUBLIC' | 'FRIENDS' | 'CLOSED'

function canManageWallMessage(user: { id: string; role: string } | null, senderId: string, receiverId: string) {
  return Boolean(user && (user.id === senderId || user.id === receiverId || user.role === 'ADMIN' || user.role === 'SUPER_ADMIN'))
}

async function isFriend(userId: string, targetId: string) {
  const [userAId, userBId] = normalizeFriendPair(userId, targetId)
  const friendship = await prisma.friendship.findUnique({
    where: { userAId_userBId: { userAId, userBId } },
    select: { id: true },
  })
  return Boolean(friendship)
}

async function canViewWall(viewerId: string | null, receiver: { id: string; Profile: { wallVisibility: WallVisibility } | null }) {
  const visibility = receiver.Profile?.wallVisibility || 'PUBLIC'
  if (visibility === 'PUBLIC') return true
  if (viewerId === receiver.id) return true
  if (!viewerId || visibility === 'CLOSED') return false
  return isFriend(viewerId, receiver.id)
}

export async function GET(request: Request) {
  const viewer = await getCurrentUser()
  const { searchParams } = new URL(request.url)
  const uid = Number(searchParams.get('receiverUid'))
  if (!Number.isSafeInteger(uid) || uid <= 0) return NextResponse.json({ message: '用户不存在' }, { status: 404 })

  const receiver = await prisma.user.findFirst({
    where: { uid, status: 'ACTIVE', isDeleted: false, Profile: { isNot: null } },
    select: {
      id: true,
      Profile: { select: { wallVisibility: true } },
    },
  })
  if (!receiver) return NextResponse.json({ message: '用户不存在' }, { status: 404 })

  const canView = await canViewWall(viewer?.id || null, receiver)
  if (!canView) {
    return NextResponse.json({ message: '你没有权限查看该留言墙' }, { status: 403 })
  }

  // 仅墙主人可查看点赞者具体身份；他人仅能看到点赞数量，不可枚举是谁点的赞。
  const isOwner = viewer?.id === receiver.id

  const rows = await prisma.profileWallMessage.findMany({
    where: { receiverId: receiver.id, parentId: null, deletedAt: null },
    orderBy: { createdAt: 'desc' },
    take: 30,
    include: {
      User_ProfileWallMessage_senderIdToUser: {
        select: {
          id: true,
          uid: true,
          nickname: true,
          avatarUrl: true,
          role: true,
          Profile: { select: { displayName: true, avatarUrl: true } },
        },
      },
      other_ProfileWallMessage: {
        where: { deletedAt: null },
        orderBy: { createdAt: 'asc' },
        take: 20,
        include: {
          // 最新 10 个点赞用户（朋友圈式头像展示）；当前用户是否点赞由下方批量查询判断。
          ProfileWallLike: {
            orderBy: { createdAt: 'desc' as const },
            take: 10,
            select: {
              userId: true,
              User: {
                select: {
                  uid: true,
                  nickname: true,
                  avatarUrl: true,
                  Profile: { select: { displayName: true, avatarUrl: true } },
                },
              },
            },
          },
          User_ProfileWallMessage_senderIdToUser: {
            select: {
              id: true,
              uid: true,
              nickname: true,
              avatarUrl: true,
              role: true,
              Profile: { select: { displayName: true, avatarUrl: true } },
            },
          },
        },
      },
      ProfileWallLike: {
        orderBy: { createdAt: 'desc' as const },
        take: 10,
        select: {
          userId: true,
          User: {
            select: {
              uid: true,
              nickname: true,
              avatarUrl: true,
              Profile: { select: { displayName: true, avatarUrl: true } },
            },
          },
        },
      },
    },
  })

  // 当前用户对这些留言的点赞：一次批量查询（避免 N+1），保持 liked ⇔ 当前用户已点赞 的既有契约。
  const allMessageIds = rows.flatMap((item) => [item.id, ...item.other_ProfileWallMessage.map((child) => child.id)])
  const viewerLikes = viewer && allMessageIds.length
    ? await prisma.profileWallLike.findMany({
        where: { userId: viewer.id, messageId: { in: allMessageIds } },
        select: { messageId: true },
      })
    : []
  const viewerLikedIds = new Set(viewerLikes.map((like) => like.messageId))
  const displayNameUserIds = [
    ...rows.flatMap((item) => [
      item.User_ProfileWallMessage_senderIdToUser.id,
      ...item.other_ProfileWallMessage.map((child) => child.User_ProfileWallMessage_senderIdToUser.id),
    ]),
    ...rows.flatMap((item) => [
      ...item.ProfileWallLike.map((like) => like.userId),
      ...item.other_ProfileWallMessage.flatMap((child) => child.ProfileWallLike.map((like) => like.userId)),
    ]),
  ]
  const remarkMap = await loadFriendRemarkMap(viewer?.id, displayNameUserIds)

  // 序列化为 LikeAvatars 的 LikeAvatarUser 结构（与每日留言 / 帖子点赞列表保持一致）。
  function serializeWallLikers(likes: Array<{ userId: string; User: { uid: number; nickname: string; avatarUrl: string | null; Profile: { displayName: string | null; avatarUrl: string | null } | null } }>) {
    return likes.map((like) => ({
      uid: like.User.uid,
      nickname: like.User.nickname,
      displayName: resolveFriendDisplayName({
        viewerId: viewer?.id,
        targetUserId: like.userId,
        fallbackName: getPublicUserDisplayName(like.User),
        remarkMap,
      }),
      avatarUrl: like.User.Profile?.avatarUrl || like.User.avatarUrl || null,
    }))
  }

  return NextResponse.json({
    visibility: receiver.Profile?.wallVisibility || 'PUBLIC',
    canPost: Boolean(viewer && receiver.Profile?.wallVisibility !== 'CLOSED'),
    messages: rows.map((item) => ({
      ...item,
      sender: {
        ...item.User_ProfileWallMessage_senderIdToUser,
        profile: item.User_ProfileWallMessage_senderIdToUser.Profile ? {
          ...item.User_ProfileWallMessage_senderIdToUser.Profile,
          displayName: resolveFriendDisplayName({
            viewerId: viewer?.id,
            targetUserId: item.senderId,
            fallbackName: getPublicUserDisplayName(item.User_ProfileWallMessage_senderIdToUser),
            remarkMap,
          }),
        } : item.User_ProfileWallMessage_senderIdToUser.Profile,
      },
      createdAt: item.createdAt.toISOString(),
      updatedAt: item.updatedAt.toISOString(),
      canDelete: canManageWallMessage(viewer, item.senderId, item.receiverId),
      liked: viewerLikedIds.has(item.id),
      likers: isOwner ? serializeWallLikers(item.ProfileWallLike) : [],
      commentCount: item.other_ProfileWallMessage.length,
      children: item.other_ProfileWallMessage.map((child) => ({
        ...child,
        sender: {
          ...child.User_ProfileWallMessage_senderIdToUser,
          profile: child.User_ProfileWallMessage_senderIdToUser.Profile ? {
            ...child.User_ProfileWallMessage_senderIdToUser.Profile,
            displayName: resolveFriendDisplayName({
              viewerId: viewer?.id,
              targetUserId: child.senderId,
              fallbackName: getPublicUserDisplayName(child.User_ProfileWallMessage_senderIdToUser),
              remarkMap,
            }),
          } : child.User_ProfileWallMessage_senderIdToUser.Profile,
        },
        children: [],
        createdAt: child.createdAt.toISOString(),
        updatedAt: child.updatedAt.toISOString(),
        canDelete: canManageWallMessage(viewer, child.senderId, child.receiverId),
        liked: viewerLikedIds.has(child.id),
        likers: isOwner ? serializeWallLikers(child.ProfileWallLike) : [],
        commentCount: 0,
      })),
    })),
  })
}

export async function POST(request: Request) {
  const viewer = await getCurrentUser()
  if (!viewer) return NextResponse.json({ message: '请先登录' }, { status: 401 })

  const body = await request.json().catch(() => null)
  const receiverUid = Number(body?.receiverUid)
  const parentId = sanitizeText(body?.parentId, 80) || null
  const rawContent = sanitizeText(body?.content, 500)
  if (await containsSensitiveContent(rawContent)) {
    return NextResponse.json({ message: '留言包含违禁词，无法发布' }, { status: 400 })
  }
  const content = rawContent
  if (!content) return NextResponse.json({ message: '留言内容不能为空' }, { status: 400 })
  if (!Number.isSafeInteger(receiverUid) || receiverUid <= 0) return NextResponse.json({ message: '用户不存在' }, { status: 404 })

  const receiver = await prisma.user.findFirst({
    where: { uid: receiverUid, status: 'ACTIVE', isDeleted: false, Profile: { isNot: null } },
    select: { id: true, uid: true, Profile: { select: { wallVisibility: true } } },
  })
  if (!receiver) return NextResponse.json({ message: '用户不存在' }, { status: 404 })

  const canView = await canViewWall(viewer.id, receiver)
  if (!canView || receiver.Profile?.wallVisibility === 'CLOSED') {
    return NextResponse.json({ message: '留言墙暂未开放' }, { status: 403 })
  }

  let parentMessage: { id: string; senderId: string; parentId: string | null } | null = null
  if (parentId) {
    parentMessage = await prisma.profileWallMessage.findFirst({
      where: { id: parentId, receiverId: receiver.id, deletedAt: null },
      select: { id: true, senderId: true, parentId: true },
    })
    if (!parentMessage) return NextResponse.json({ message: '要回复的留言不存在' }, { status: 404 })
  }

  const message = await prisma.$transaction(async (tx) => {
    const threadParentId = parentMessage?.parentId || parentMessage?.id || null
    const created = await tx.profileWallMessage.create({
      data: { senderId: viewer.id, receiverId: receiver.id, parentId: threadParentId, content },
      select: { id: true },
    })
    await tx.friendActivity.create({ data: { actorId: viewer.id, type: 'PROFILE_WALL', content, targetUrl: `/user/${String(receiver.uid).padStart(5, '0')}/wall?focus=${created.id}` } })
    const recipientId = parentMessage?.senderId || receiver.id
    if (recipientId !== viewer.id) {
      await tx.notification.create({
        data: {
          recipientId,
          actorId: viewer.id,
          type: 'MESSAGE',
          title: parentMessage ? '有人回复了你的留言' : '你的留言墙有新留言',
          content: parentMessage ? `${viewer.nickname} 回复了你的留言` : `${viewer.nickname} 给你留言了`,
          link: `/user/${String(receiver.uid).padStart(5, '0')}/wall?focus=${created.id}`,
        },
      })
    }
    return created
  })

  return NextResponse.json({ message: '留言已发布', id: message.id }, { status: 201 })
}
