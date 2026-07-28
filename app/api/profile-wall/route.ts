import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
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
          ProfileWallLike: viewer ? { where: { userId: viewer.id }, select: { id: true } } : false,
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
      ProfileWallLike: viewer ? { where: { userId: viewer.id }, select: { id: true } } : false,
    },
  })

  return NextResponse.json({
    visibility: receiver.Profile?.wallVisibility || 'PUBLIC',
    canPost: Boolean(viewer && receiver.Profile?.wallVisibility !== 'CLOSED'),
    messages: rows.map((item) => ({
      ...item,
      sender: {
        ...item.User_ProfileWallMessage_senderIdToUser,
        profile: item.User_ProfileWallMessage_senderIdToUser.Profile,
      },
      createdAt: item.createdAt.toISOString(),
      updatedAt: item.updatedAt.toISOString(),
      canDelete: canManageWallMessage(viewer, item.senderId, item.receiverId),
      liked: Array.isArray(item.ProfileWallLike) && item.ProfileWallLike.length > 0,
      commentCount: item.other_ProfileWallMessage.length,
      children: item.other_ProfileWallMessage.map((child) => ({
        ...child,
        sender: {
          ...child.User_ProfileWallMessage_senderIdToUser,
          profile: child.User_ProfileWallMessage_senderIdToUser.Profile,
        },
        children: [],
        createdAt: child.createdAt.toISOString(),
        updatedAt: child.updatedAt.toISOString(),
        canDelete: canManageWallMessage(viewer, child.senderId, child.receiverId),
        liked: Array.isArray(child.ProfileWallLike) && child.ProfileWallLike.length > 0,
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
