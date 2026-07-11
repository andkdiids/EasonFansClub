import type { Prisma, UserRole } from '@prisma/client'
import { prisma } from '@/lib/prisma'

export const archivedUserUid = 0
export const archivedUserName = '已注销用户'

type Tx = Prisma.TransactionClient

export type UserDeletionPreview = {
  user: {
    id: string
    uid: number
    nickname: string
    avatarUrl: string | null
    phone: string | null
    email: string | null
    createdAt: Date
    role: UserRole
  }
  counts: {
    posts: number
    replies: number
    friends: number
    checkIns: number
    achievements: number
    dailyMessages: number
    publicDailyReplies: number
    privateMessages: number
    notifications: number
    favorites: number
    likes: number
  }
  hasPublicContent: boolean
}

export type DeleteUserInput = {
  adminId: string
  userId: string
  confirmUid: string
  deletePublicContent: boolean
  confirmSelf?: boolean
}

export type DeleteUserResult = {
  success: true
  targetUserId: string
  targetUid: string
  deletedPrivateRecords: Record<string, number>
  deletedPublicRecords: Record<string, number>
  anonymizedPublicRecords: Record<string, number>
  storageFilesDeleted: number
  authUserDeleted: boolean
  message: string
}

function uidLabel(uid: number) {
  return String(uid).padStart(5, '0')
}

async function getDeletionPreviewWithClient(client: typeof prisma | Tx, userId: string): Promise<UserDeletionPreview | null> {
  const user = await client.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      uid: true,
      nickname: true,
      avatarUrl: true,
      phone: true,
      email: true,
      createdAt: true,
      role: true,
      profile: { select: { displayName: true, avatarUrl: true } },
    },
  })

  if (!user || user.uid === archivedUserUid) return null

  const [
    posts,
    replies,
    friendsA,
    friendsB,
    checkIns,
    achievements,
    dailyMessages,
    publicDailyReplies,
    sentMessages,
    notifications,
    postFavorites,
    dailyFavorites,
    likes,
    replyLikes,
    dailyLikes,
  ] = await Promise.all([
    client.post.count({ where: { authorId: userId } }),
    client.reply.count({ where: { authorId: userId } }),
    client.friendship.count({ where: { userAId: userId } }),
    client.friendship.count({ where: { userBId: userId } }),
    client.checkIn.count({ where: { userId } }),
    client.userAchievement.count({ where: { userId } }),
    client.dailyMessage.count({ where: { userId } }),
    client.dailyMessageComment.count({ where: { authorId: userId } }),
    client.directMessage.count({ where: { senderId: userId } }),
    client.notification.count({ where: { recipientId: userId } }),
    client.postFavorite.count({ where: { userId } }),
    client.dailyMessageFavorite.count({ where: { userId } }),
    client.like.count({ where: { userId } }),
    client.replyLike.count({ where: { userId } }),
    client.dailyMessageLike.count({ where: { userId } }),
  ])

  return {
    user: {
      id: user.id,
      uid: user.uid,
      nickname: user.profile?.displayName || user.nickname,
      avatarUrl: user.profile?.avatarUrl || user.avatarUrl,
      phone: user.phone,
      email: user.email,
      createdAt: user.createdAt,
      role: user.role,
    },
    counts: {
      posts,
      replies,
      friends: friendsA + friendsB,
      checkIns,
      achievements,
      dailyMessages,
      publicDailyReplies,
      privateMessages: sentMessages,
      notifications,
      favorites: postFavorites + dailyFavorites,
      likes: likes + replyLikes + dailyLikes,
    },
    hasPublicContent: posts + replies + dailyMessages + publicDailyReplies > 0,
  }
}

export async function getUserDeletionPreview(userId: string) {
  return getDeletionPreviewWithClient(prisma, userId)
}

async function getOrCreateArchivedUser(tx: Tx) {
  const existing = await tx.user.findUnique({
    where: { uid: archivedUserUid },
    select: { id: true },
  })

  if (existing) return existing

  return tx.user.create({
    data: {
      uid: archivedUserUid,
      username: 'deleted-user',
      passwordHash: 'archived-user-no-login',
      nickname: archivedUserName,
      role: 'USER',
      status: 'ACTIVE',
      isDeleted: false,
      profile: {
        create: {
          displayName: archivedUserName,
          bio: '该账号已注销，公开内容已归档。',
        },
      },
    },
    select: { id: true },
  })
}

async function recalculatePostReplyCounts(tx: Tx, postIds: string[]) {
  for (const postId of [...new Set(postIds)]) {
    const replyCount = await tx.reply.count({ where: { postId, isDeleted: false } })
    await tx.post.update({ where: { id: postId }, data: { replyCount } }).catch(() => null)
  }
}

async function recalculateDailyMessageCommentCounts(tx: Tx, messageIds: string[]) {
  for (const messageId of [...new Set(messageIds)]) {
    const commentCount = await tx.dailyMessageComment.count({ where: { messageId, isDeleted: false } })
    await tx.dailyMessage.update({ where: { id: messageId }, data: { commentCount } }).catch(() => null)
  }
}

function collectStoragePaths(urls: Array<string | null | undefined>) {
  const supabaseUrl = process.env.SUPABASE_URL?.replace(/\/$/, '')
  const bucket = process.env.SUPABASE_STORAGE_BUCKET || 'public'
  if (!supabaseUrl) return []

  const marker = `/storage/v1/object/public/${encodeURIComponent(bucket)}/`
  return urls
    .map((url) => url?.trim())
    .filter((url): url is string => Boolean(url?.startsWith(supabaseUrl) && url.includes(marker)))
    .map((url) => decodeURIComponent(url.slice(url.indexOf(marker) + marker.length)))
    .filter(Boolean)
}

async function deleteStorageFiles(paths: string[]) {
  const supabaseUrl = process.env.SUPABASE_URL?.replace(/\/$/, '')
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  const bucket = process.env.SUPABASE_STORAGE_BUCKET || 'public'
  if (!supabaseUrl || !serviceKey || paths.length === 0) return 0

  try {
    const response = await fetch(`${supabaseUrl}/storage/v1/object/${encodeURIComponent(bucket)}/remove`, {
      method: 'POST',
      headers: {
        apikey: serviceKey,
        authorization: `Bearer ${serviceKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ prefixes: paths }),
    })

    return response.ok ? paths.length : 0
  } catch {
    return 0
  }
}

export async function deleteUserPermanently(input: DeleteUserInput): Promise<DeleteUserResult> {
  const storagePaths: string[] = []
  const result = await prisma.$transaction(async (tx) => {
    const preview = await getDeletionPreviewWithClient(tx, input.userId)
    if (!preview) throw new Error('USER_NOT_FOUND')
    if (input.confirmUid !== uidLabel(preview.user.uid)) throw new Error('UID_CONFIRM_MISMATCH')

    const admin = await tx.user.findUnique({
      where: { id: input.adminId },
      select: { id: true, role: true },
    })
    if (!admin) throw new Error('ADMIN_NOT_FOUND')

    const isSelf = admin.id === input.userId
    if (isSelf && !input.confirmSelf) throw new Error('SELF_DELETE_REQUIRES_CONFIRMATION')

    if (preview.user.role === 'SUPER_ADMIN') {
      const superAdminCount = await tx.user.count({
        where: { role: 'SUPER_ADMIN', status: 'ACTIVE', isDeleted: false, uid: { not: archivedUserUid } },
      })
      if (superAdminCount <= 1) throw new Error('LAST_SUPER_ADMIN')
    }

    const target = await tx.user.findUnique({
      where: { id: input.userId },
      select: {
        id: true,
        uid: true,
        avatarUrl: true,
        backgroundUrl: true,
        phone: true,
        profile: { select: { avatarUrl: true, backgroundUrl: true } },
      },
    })
    if (!target) throw new Error('USER_NOT_FOUND')

    storagePaths.push(...collectStoragePaths([target.avatarUrl, target.backgroundUrl, target.profile?.avatarUrl, target.profile?.backgroundUrl]))

    const archivedUser = await getOrCreateArchivedUser(tx)
    const affectedReplies = await tx.reply.findMany({ where: { authorId: input.userId }, select: { postId: true } })
    const affectedDailyComments = await tx.dailyMessageComment.findMany({
      where: { authorId: input.userId },
      select: { messageId: true },
    })

    const deletedPublicRecords: Record<string, number> = {}
    const anonymizedPublicRecords: Record<string, number> = {}

    if (input.deletePublicContent) {
      deletedPublicRecords.posts = (await tx.post.deleteMany({ where: { authorId: input.userId } })).count
      deletedPublicRecords.dailyMessages = (await tx.dailyMessage.deleteMany({ where: { userId: input.userId } })).count
      anonymizedPublicRecords.replies = (
        await tx.reply.updateMany({
          where: { authorId: input.userId },
          data: { authorId: archivedUser.id, isDeleted: true, deletedAt: new Date(), content: '该回复已随账号删除。' },
        })
      ).count
      anonymizedPublicRecords.dailyMessageComments = (
        await tx.dailyMessageComment.updateMany({
          where: { authorId: input.userId },
          data: { authorId: archivedUser.id, isDeleted: true, deletedAt: new Date(), content: '该评论已随账号删除。' },
        })
      ).count
      anonymizedPublicRecords.cultureComments = (
        await tx.cultureComment.updateMany({
          where: { userId: input.userId },
          data: { userId: archivedUser.id, isDeleted: true, content: '该评论已随账号删除。' },
        })
      ).count
    } else {
      anonymizedPublicRecords.posts = (await tx.post.updateMany({ where: { authorId: input.userId }, data: { authorId: archivedUser.id } })).count
      anonymizedPublicRecords.replies = (await tx.reply.updateMany({ where: { authorId: input.userId }, data: { authorId: archivedUser.id } })).count
      anonymizedPublicRecords.dailyMessages = (await tx.dailyMessage.updateMany({ where: { userId: input.userId }, data: { userId: archivedUser.id, checkInId: null } })).count
      anonymizedPublicRecords.dailyMessageComments = (
        await tx.dailyMessageComment.updateMany({ where: { authorId: input.userId }, data: { authorId: archivedUser.id } })
      ).count
      anonymizedPublicRecords.cultureComments = (await tx.cultureComment.updateMany({ where: { userId: input.userId }, data: { userId: archivedUser.id } })).count
    }

    await recalculatePostReplyCounts(tx, affectedReplies.map((item) => item.postId))
    await recalculateDailyMessageCommentCounts(tx, affectedDailyComments.map((item) => item.messageId))

    const conversationIds = await tx.conversationParticipant.findMany({
      where: { userId: input.userId },
      select: { conversationId: true },
    })

    const deletedPrivateRecords: Record<string, number> = {
      onlineSessions: (await tx.onlineSession.deleteMany({ where: { userId: input.userId } })).count,
      pollVotes: (await tx.pollVote.deleteMany({ where: { userId: input.userId } })).count,
      smsCodes: target.phone ? (await tx.smsCode.deleteMany({ where: { phone: target.phone } })).count : 0,
    }

    await tx.user.delete({ where: { id: input.userId } })
    deletedPrivateRecords.user = 1

    if (conversationIds.length > 0) {
      deletedPrivateRecords.emptyConversations = (
        await tx.conversation.deleteMany({
          where: {
            id: { in: conversationIds.map((item) => item.conversationId) },
            participants: { none: {} },
          },
        })
      ).count
    }

    if (!isSelf) {
      await tx.adminAction.create({
        data: {
          adminId: input.adminId,
          targetUserId: null,
          action: 'DELETE_USER',
          reason: '永久删除用户',
          metadata: {
            targetUserId: input.userId,
            targetUid: uidLabel(preview.user.uid),
            targetNickname: preview.user.nickname,
            deletePublicContent: input.deletePublicContent,
            deletedPrivateRecords,
            deletedPublicRecords,
            anonymizedPublicRecords,
          },
        },
      })
    }

    return {
      success: true as const,
      targetUserId: input.userId,
      targetUid: uidLabel(preview.user.uid),
      deletedPrivateRecords,
      deletedPublicRecords,
      anonymizedPublicRecords,
      storageFilesDeleted: 0,
      authUserDeleted: false,
      message: '用户已永久删除。',
    }
  })

  const storageFilesDeleted = await deleteStorageFiles([...new Set(storagePaths)])
  return { ...result, storageFilesDeleted }
}
