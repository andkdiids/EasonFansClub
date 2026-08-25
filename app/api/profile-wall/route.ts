import { Prisma } from '@prisma/client'
import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import { getPublicUserDisplayName, loadFriendRemarkMap, resolveFriendDisplayName } from '@/lib/friend-remarks'
import { normalizeFriendPair } from '@/lib/friends'
import { publicImageUrl } from '@/lib/images'
import { prisma } from '@/lib/prisma'
import { emitRealtime } from '@/lib/realtime'
import { sanitizeText, unauthenticatedResponse } from '@/lib/security'
import { resolveIpLocation, updateUserIpRegion } from '@/lib/ip-region'
import { BANNED_WORD_MESSAGE, CONTENT_CONTAINS_BANNED_WORD, checkBannedWords, publicModerationText } from '@/lib/content-moderation'
import { getEquippedBadgesForUsers } from '@/lib/badge-service'
import type { EquippedBadgeView } from '@/lib/badge-types'
import { safeNotificationWrite } from '@/lib/notification-transaction'
import { upsertNotification } from '@/lib/notification-write'

type WallVisibility = 'PUBLIC' | 'FRIENDS' | 'CLOSED'

const PROFILE_WALL_PAGE_SIZE = 10

const wallRowInclude = {
  User_ProfileWallMessage_senderIdToUser: {
    select: {
      id: true,
      uid: true,
      nickname: true,
      usernameModerationStatus: true,
      nicknameModerationStatus: true,
      nicknameViolationDisplay: true,
      avatarUrl: true,
      role: true,
      Profile: { select: { displayName: true, displayNameModerationStatus: true, avatarUrl: true } },
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
          usernameModerationStatus: true,
          nicknameModerationStatus: true,
          nicknameViolationDisplay: true,
          avatarUrl: true,
          Profile: { select: { displayName: true, displayNameModerationStatus: true, avatarUrl: true } },
        },
      },
    },
  },
} as const

type WallRow = Prisma.ProfileWallMessageGetPayload<{ include: typeof wallRowInclude }>
type WallLiker = WallRow['ProfileWallLike'][number]
type WallNode = { row: WallRow; children: WallNode[]; commentCount: number }
type SerializedWallMessage = {
  id: string
  content: string
  parentId: string | null
  createdAt: string
  updatedAt: string
  ipRegion: string | null
  canDelete: boolean
  liked: boolean
  likeCount: number
  likers: Array<{ uid: number; nickname: string; displayName: string; avatarUrl: string | null; equippedBadge: EquippedBadgeView | null }>
  commentCount: number
  sender: {
    uid: number
    nickname: string
    avatarUrl: string | null
    equippedBadge: EquippedBadgeView | null
    profile: { displayName: string | null; avatarUrl: string | null } | null
  }
  children: SerializedWallMessage[]
}

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

function buildWallTree(rows: WallRow[]) {
  const childrenByParent = new Map<string, WallRow[]>()
  for (const row of rows) {
    if (!row.parentId) continue
    const children = childrenByParent.get(row.parentId) || []
    children.push(row)
    childrenByParent.set(row.parentId, children)
  }
  for (const children of childrenByParent.values()) {
    children.sort((left, right) => left.createdAt.getTime() - right.createdAt.getTime())
  }

  const buildNode = (row: WallRow, ancestors: Set<string>): WallNode => {
    const nextAncestors = new Set(ancestors).add(row.id)
    const children = (childrenByParent.get(row.id) || [])
      .filter((child) => !nextAncestors.has(child.id))
      .map((child) => buildNode(child, nextAncestors))
    return {
      row,
      children,
      commentCount: children.reduce((total, child) => total + 1 + child.commentCount, 0),
    }
  }

  return rows
    .filter((row) => !row.parentId)
    .map((row) => buildNode(row, new Set()))
}

function serializeWallLikers(likes: WallLiker[], viewerId: string | null, remarkMap: ReadonlyMap<string, string>, equippedBadgeMap: ReadonlyMap<string, EquippedBadgeView>) {
  return likes.map((like) => ({
    uid: like.User.uid,
    nickname: getPublicUserDisplayName(like.User),
    displayName: resolveFriendDisplayName({
      viewerId: viewerId || undefined,
      targetUserId: like.userId,
      fallbackName: getPublicUserDisplayName(like.User),
      remarkMap,
    }),
    avatarUrl: publicImageUrl(like.User.Profile?.avatarUrl || like.User.avatarUrl),
    equippedBadge: equippedBadgeMap.get(like.userId) || null,
  }))
}

function serializeWallNode(
  node: WallNode,
  viewer: { id: string; role: string } | null,
  receiverId: string,
  isOwner: boolean,
  viewerLikedIds: ReadonlySet<string>,
  remarkMap: ReadonlyMap<string, string>,
  equippedBadgeMap: ReadonlyMap<string, EquippedBadgeView>,
): SerializedWallMessage {
  const sender = node.row.User_ProfileWallMessage_senderIdToUser
  const displayName = resolveFriendDisplayName({
    viewerId: viewer?.id,
    targetUserId: node.row.senderId,
    fallbackName: getPublicUserDisplayName(sender),
    remarkMap,
  })

  return {
    id: node.row.id,
    content: publicModerationText(node.row.content, node.row.moderationStatus),
    parentId: node.row.parentId,
    createdAt: node.row.createdAt.toISOString(),
    updatedAt: node.row.updatedAt.toISOString(),
    ipRegion: node.row.ipRegion,
    canDelete: canManageWallMessage(viewer, node.row.senderId, receiverId),
    liked: viewerLikedIds.has(node.row.id),
    likeCount: node.row.likeCount,
    likers: isOwner ? serializeWallLikers(node.row.ProfileWallLike, viewer?.id || null, remarkMap, equippedBadgeMap) : [],
    commentCount: node.commentCount,
    sender: {
      uid: sender.uid,
      nickname: getPublicUserDisplayName(sender),
      avatarUrl: publicImageUrl(sender.avatarUrl),
      equippedBadge: equippedBadgeMap.get(node.row.senderId) || null,
      profile: sender.Profile ? { ...sender.Profile, avatarUrl: publicImageUrl(sender.Profile.avatarUrl), displayName } : null,
    },
    children: node.children.map((child) => serializeWallNode(child, viewer, receiverId, isOwner, viewerLikedIds, remarkMap, equippedBadgeMap)),
  }
}

async function loadWallMessage(id: string) {
  return prisma.profileWallMessage.findUnique({ where: { id }, include: wallRowInclude })
}

function parseWallPage(value: string | null) {
  const page = Number(value)
  return Number.isSafeInteger(page) && page > 0 ? page : 1
}

async function findWallFocusRoot(focusId: string, receiverId: string) {
  const visited = new Set<string>()
  let currentId: string | null = focusId

  while (currentId && !visited.has(currentId)) {
    visited.add(currentId)
    const row: { id: string; parentId: string | null; createdAt: Date } | null = await prisma.profileWallMessage.findFirst({
      where: { id: currentId, receiverId, deletedAt: null },
      select: { id: true, parentId: true, createdAt: true },
    })
    if (!row) return null
    if (!row.parentId) return row
    currentId = row.parentId
  }

  return null
}

export async function GET(request: Request) {
  const viewer = await getCurrentUser()
  const { searchParams } = new URL(request.url)
  const uid = Number(searchParams.get('receiverUid'))
  const requestedPage = parseWallPage(searchParams.get('wallPage'))
  const focusId = searchParams.get('focusId')?.slice(0, 80) || null
  if (!Number.isSafeInteger(uid) || uid <= 0) return NextResponse.json({ message: '用户不存在' }, { status: 404 })

  const receiver = await prisma.user.findFirst({
    where: { uid, status: 'ACTIVE', isDeleted: false, Profile: { isNot: null } },
    select: { id: true, Profile: { select: { wallVisibility: true } } },
  })
  if (!receiver) return NextResponse.json({ message: '用户不存在' }, { status: 404 })

  const canView = await canViewWall(viewer?.id || null, receiver)
  if (!canView) return NextResponse.json({ message: '你没有权限查看该留言墙' }, { status: 403 })

  const isOwner = viewer?.id === receiver.id
  const rootWhere = { receiverId: receiver.id, parentId: null, deletedAt: null } as const
  const total = await prisma.profileWallMessage.count({ where: rootWhere })
  const totalPages = Math.max(1, Math.ceil(total / PROFILE_WALL_PAGE_SIZE))
  let page = Math.min(requestedPage, totalPages)

  const focusRoot = focusId ? await findWallFocusRoot(focusId, receiver.id) : null
  if (focusRoot) {
    const rootsBeforeFocus = await prisma.profileWallMessage.count({
      where: {
        ...rootWhere,
        OR: [
          { createdAt: { gt: focusRoot.createdAt } },
          { createdAt: focusRoot.createdAt, id: { gt: focusRoot.id } },
        ],
      },
    })
    page = Math.min(Math.floor(rootsBeforeFocus / PROFILE_WALL_PAGE_SIZE) + 1, totalPages)
  }

  const rootRows = await prisma.profileWallMessage.findMany({
    where: rootWhere,
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    skip: (page - 1) * PROFILE_WALL_PAGE_SIZE,
    take: PROFILE_WALL_PAGE_SIZE,
    include: wallRowInclude,
  })

  const rows: WallRow[] = [...rootRows]
  let parentIds = rootRows.map((row) => row.id)
  while (parentIds.length) {
    const children = await prisma.profileWallMessage.findMany({
      where: { receiverId: receiver.id, deletedAt: null, parentId: { in: parentIds } },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      include: wallRowInclude,
    })
    if (!children.length) break
    rows.push(...children)
    parentIds = children.map((row) => row.id)
  }
  const allMessageIds = rows.map((row) => row.id)
  const viewerLikes = viewer && allMessageIds.length
    ? await prisma.profileWallLike.findMany({
        where: { userId: viewer.id, messageId: { in: allMessageIds } },
        select: { messageId: true },
      })
    : []
  const viewerLikedIds = new Set(viewerLikes.map((like) => like.messageId))
  const displayNameUserIds = [
    ...rows.map((row) => row.senderId),
    ...rows.flatMap((row) => row.ProfileWallLike.map((like) => like.userId)),
  ]
  const remarkMap = await loadFriendRemarkMap(viewer?.id, displayNameUserIds)
  const equippedBadgeMap = await getEquippedBadgesForUsers(displayNameUserIds)
  const tree = buildWallTree(rows)

  return NextResponse.json({
    visibility: receiver.Profile?.wallVisibility || 'PUBLIC',
    canPost: Boolean(viewer && receiver.Profile?.wallVisibility !== 'CLOSED'),
    messages: tree.map((node) => serializeWallNode(node, viewer, receiver.id, isOwner, viewerLikedIds, remarkMap, equippedBadgeMap)),
    pagination: {
      page,
      pageSize: PROFILE_WALL_PAGE_SIZE,
      total,
      totalPages,
      hasPrevious: page > 1,
      hasNext: page < totalPages,
    },
  })
}

export async function POST(request: Request) {
  const viewer = await getCurrentUser()
  if (!viewer) return unauthenticatedResponse()

  const ipLocation = await resolveIpLocation(request)
  const ipRegion = ipLocation?.label || null
  void updateUserIpRegion(viewer.id, ipLocation)
  const body = await request.json().catch(() => null)
  const receiverUid = Number(body?.receiverUid)
  const parentId = sanitizeText(body?.parentId, 80) || null
  const rawContent = sanitizeText(body?.content, 500)
  if ((await checkBannedWords(rawContent)).blocked) return NextResponse.json({ error: CONTENT_CONTAINS_BANNED_WORD, message: BANNED_WORD_MESSAGE }, { status: 400 })
  if (!rawContent) return NextResponse.json({ message: '留言内容不能为空' }, { status: 400 })
  if (!Number.isSafeInteger(receiverUid) || receiverUid <= 0) return NextResponse.json({ message: '用户不存在' }, { status: 404 })

  const receiver = await prisma.user.findFirst({
    where: { uid: receiverUid, status: 'ACTIVE', isDeleted: false, Profile: { isNot: null } },
    select: { id: true, uid: true, Profile: { select: { wallVisibility: true } } },
  })
  if (!receiver) return NextResponse.json({ message: '用户不存在' }, { status: 404 })

  const canView = await canViewWall(viewer.id, receiver)
  if (!canView || receiver.Profile?.wallVisibility === 'CLOSED') return NextResponse.json({ message: '留言墙暂未开放' }, { status: 403 })

  let parentMessage: { id: string; senderId: string } | null = null
  if (parentId) {
    parentMessage = await prisma.profileWallMessage.findFirst({
      where: { id: parentId, receiverId: receiver.id, deletedAt: null },
      select: { id: true, senderId: true },
    })
    if (!parentMessage) return NextResponse.json({ message: '要回复的留言不存在' }, { status: 404 })
  }

  let notifiedUserId: string | null = null
  let notificationData: Prisma.NotificationUpsertArgs | null = null
  const message = await prisma.$transaction(async (tx) => {
    const created = await tx.profileWallMessage.create({
      data: { senderId: viewer.id, receiverId: receiver.id, parentId: parentMessage?.id || null, content: rawContent, ipRegion },
      select: { id: true },
    })
    await tx.friendActivity.create({
      data: {
        actorId: viewer.id,
        type: 'PROFILE_WALL',
        content: rawContent,
        targetUrl: `/user/${String(receiver.uid).padStart(5, '0')}/wall?focus=${created.id}`,
      },
    })
    const recipientId = parentMessage?.senderId || receiver.id
    if (recipientId !== viewer.id) {
      notifiedUserId = recipientId
      const notificationKey = parentMessage
        ? `profile-wall-reply:${created.id}`
        : `profile-wall-message:${created.id}`
      const notificationContent = parentMessage
        ? `${viewer.nickname} 回复了你的留言：${rawContent.slice(0, 120)}`
        : `${viewer.nickname} 给你留言了：${rawContent.slice(0, 120)}`

      // Profile-wall interactions are reply-style notifications rather than
      // direct messages. The unique key makes retrying this transaction
      // idempotent without creating a second notification for one message.
      notificationData = {
        where: { recipientId_key: { recipientId, key: notificationKey } },
        update: {},
        create: {
          recipientId,
          actorId: viewer.id,
          type: 'REPLY',
          title: parentMessage ? '有人回复了你的留言' : '你的留言墙有新留言',
          content: notificationContent,
          link: `/user/${String(receiver.uid).padStart(5, '0')}/wall?focus=${created.id}`,
          key: notificationKey,
        },
      }
    }
    return created
  }, { timeout: 15_000, maxWait: 5_000 })

  const committedNotificationData = notificationData as Prisma.NotificationUpsertArgs | null
  if (committedNotificationData) {
    await safeNotificationWrite(
      () => upsertNotification(committedNotificationData),
      { operation: 'profile-wall-message-notification', userId: committedNotificationData.create.recipientId, notificationType: 'REPLY' },
    )
  }
  if (notifiedUserId) emitRealtime(notifiedUserId, 'notification')
  const createdRow = await loadWallMessage(message.id)
  if (!createdRow) return NextResponse.json({ message: '留言已保存，但读取新留言失败' }, { status: 500 })
  const remarkMap = await loadFriendRemarkMap(viewer.id, [createdRow.senderId])
  const equippedBadgeMap = await getEquippedBadgesForUsers([
    createdRow.senderId,
    ...createdRow.ProfileWallLike.map((like) => like.userId),
  ])
  const wallMessage = serializeWallNode(
    { row: createdRow, children: [], commentCount: 0 },
    viewer,
    receiver.id,
    viewer.id === receiver.id,
    new Set<string>(),
    remarkMap,
    equippedBadgeMap,
  )

  return NextResponse.json({ message: '留言已发布', id: message.id, wallMessage }, { status: 201 })
}
