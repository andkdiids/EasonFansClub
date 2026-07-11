import type { Prisma, UserRole } from '@prisma/client'
import { prisma } from '@/lib/prisma'

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
  message: string
  targetUserId: string
  targetUid: string
  deletedRows: Record<string, number>
  storageFilesDeleted: number
  authUserDeleted: false
}

function uidLabel(uid: number) {
  return String(uid).padStart(5, '0')
}

export async function getUserDeletionPreview(userId: string): Promise<UserDeletionPreview | null> {
  const user = await prisma.user.findUnique({
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

  if (!user || user.uid <= 0) return null

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
    prisma.post.count({ where: { authorId: userId } }),
    prisma.reply.count({ where: { authorId: userId } }),
    prisma.friendship.count({ where: { userAId: userId } }),
    prisma.friendship.count({ where: { userBId: userId } }),
    prisma.checkIn.count({ where: { userId } }),
    prisma.userAchievement.count({ where: { userId } }),
    prisma.dailyMessage.count({ where: { userId } }),
    prisma.dailyMessageComment.count({ where: { authorId: userId } }),
    prisma.directMessage.count({ where: { senderId: userId } }),
    prisma.notification.count({ where: { recipientId: userId } }),
    prisma.postFavorite.count({ where: { userId } }),
    prisma.dailyMessageFavorite.count({ where: { userId } }),
    prisma.like.count({ where: { userId } }),
    prisma.replyLike.count({ where: { userId } }),
    prisma.dailyMessageLike.count({ where: { userId } }),
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

async function deleteUserRows(tx: Tx, userId: string, deletePublicContent: boolean) {
  const deletedRows: Record<string, number> = {}

  deletedRows.friendships = (
    await tx.friendship.deleteMany({
      where: { OR: [{ userAId: userId }, { userBId: userId }] },
    })
  ).count
  deletedRows.friendRequests = (
    await tx.friendRequest.deleteMany({
      where: { OR: [{ senderId: userId }, { receiverId: userId }] },
    })
  ).count
  deletedRows.follows = (
    await tx.follow.deleteMany({
      where: { OR: [{ followerId: userId }, { followingId: userId }] },
    })
  ).count
  deletedRows.blocks = (
    await tx.block.deleteMany({
      where: { OR: [{ blockerId: userId }, { blockedId: userId }] },
    })
  ).count

  deletedRows.likes = (await tx.like.deleteMany({ where: { userId } })).count
  deletedRows.replyLikes = (await tx.replyLike.deleteMany({ where: { userId } })).count
  deletedRows.dailyMessageLikes = (await tx.dailyMessageLike.deleteMany({ where: { userId } })).count
  deletedRows.favorites = (await tx.postFavorite.deleteMany({ where: { userId } })).count
  deletedRows.boardFavorites = (await tx.boardFavorite.deleteMany({ where: { userId } })).count
  deletedRows.dailyMessageFavorites = (await tx.dailyMessageFavorite.deleteMany({ where: { userId } })).count
  deletedRows.activityFavorites = (await tx.activityFavorite.deleteMany({ where: { userId } })).count
  deletedRows.musicFavorites = (await tx.musicFavorite.deleteMany({ where: { userId } })).count
  deletedRows.cultureFavorites = (await tx.cultureFavorite.deleteMany({ where: { userId } })).count

  deletedRows.checkIns = (await tx.checkIn.deleteMany({ where: { userId } })).count
  deletedRows.dailyTaskProgress = (await tx.dailyTaskProgress.deleteMany({ where: { userId } })).count
  deletedRows.userAchievements = (await tx.userAchievement.deleteMany({ where: { userId } })).count
  deletedRows.userBadges = (await tx.userBadge.deleteMany({ where: { userId } })).count
  deletedRows.pointLogs = (await tx.pointLog.deleteMany({ where: { userId } })).count
  deletedRows.notifications = (
    await tx.notification.deleteMany({
      where: { OR: [{ recipientId: userId }, { actorId: userId }] },
    })
  ).count

  deletedRows.directMessages = (await tx.directMessage.deleteMany({ where: { senderId: userId } })).count
  deletedRows.conversationParticipants = (await tx.conversationParticipant.deleteMany({ where: { userId } })).count
  deletedRows.emptyConversations = (await tx.conversation.deleteMany({ where: { participants: { none: {} } } })).count

  deletedRows.reports = (
    await tx.report.deleteMany({
      where: { OR: [{ reporterId: userId }, { targetUserId: userId }] },
    })
  ).count
  deletedRows.feedbackReplies = (await tx.feedbackReply.deleteMany({ where: { adminId: userId } })).count
  deletedRows.feedback = (await tx.feedback.deleteMany({ where: { userId } })).count

  deletedRows.musicPlayRecords = (await tx.musicPlayRecord.deleteMany({ where: { userId } })).count
  deletedRows.loginDevices = (await tx.loginDevice.deleteMany({ where: { userId } })).count
  deletedRows.onlineSessions = (await tx.onlineSession.deleteMany({ where: { userId } })).count
  deletedRows.emailVerifications = (await tx.emailVerification.deleteMany({ where: { userId } })).count
  deletedRows.passwordResetTokens = (await tx.passwordResetToken.deleteMany({ where: { userId } })).count
  deletedRows.searchHistory = (await tx.searchHistory.deleteMany({ where: { userId } })).count
  deletedRows.activityRegistrations = (await tx.activityRegistration.deleteMany({ where: { userId } })).count
  deletedRows.lotteryEntries = (await tx.lotteryEntry.deleteMany({ where: { userId } })).count
  deletedRows.pollVotes = (await tx.pollVote.deleteMany({ where: { userId } })).count
  deletedRows.adminPermissions = (await tx.adminPermission.deleteMany({ where: { userId } })).count
  deletedRows.userAlbumCollections = (await tx.userAlbumCollection.deleteMany({ where: { userId } })).count
  deletedRows.lyricCards = (await tx.lyricCard.deleteMany({ where: { userId } })).count

  await tx.reply.updateMany({ where: { parent: { is: { authorId: userId } } }, data: { parentId: null } })
  await tx.dailyMessageComment.updateMany({ where: { parent: { is: { authorId: userId } } }, data: { parentId: null } })

  deletedRows.replies = (await tx.reply.deleteMany({ where: { authorId: userId } })).count
  deletedRows.dailyMessageComments = (await tx.dailyMessageComment.deleteMany({ where: { authorId: userId } })).count
  deletedRows.cultureComments = (await tx.cultureComment.deleteMany({ where: { userId } })).count
  deletedRows.dailyMessages = (await tx.dailyMessage.deleteMany({ where: { userId } })).count
  deletedRows.posts = (await tx.post.deleteMany({ where: { authorId: userId } })).count

  deletedRows.profile = (await tx.profile.deleteMany({ where: { userId } })).count
  deletedRows.user = 1
  await tx.user.delete({ where: { id: userId } })

  return deletedRows
}

export async function deleteUserPermanently(input: DeleteUserInput): Promise<DeleteUserResult> {
  const transactionResult = await prisma.$transaction(
    async (tx) => {
      const target = await tx.user.findUnique({
        where: { id: input.userId },
        select: {
          id: true,
          uid: true,
          nickname: true,
          role: true,
          phone: true,
          avatarUrl: true,
          backgroundUrl: true,
          profile: { select: { avatarUrl: true, backgroundUrl: true } },
        },
      })
      if (!target || target.uid <= 0) throw new Error('USER_NOT_FOUND')
      if (input.confirmUid !== uidLabel(target.uid)) throw new Error('UID_CONFIRM_MISMATCH')

      const admin = await tx.user.findUnique({
        where: { id: input.adminId },
        select: { id: true },
      })
      if (!admin) throw new Error('ADMIN_NOT_FOUND')

      const isSelf = admin.id === input.userId
      if (isSelf && !input.confirmSelf) throw new Error('SELF_DELETE_REQUIRES_CONFIRMATION')

      if (target.role === 'SUPER_ADMIN') {
        const superAdminCount = await tx.user.count({
          where: { role: 'SUPER_ADMIN', status: 'ACTIVE', isDeleted: false, uid: { gt: 0 } },
        })
        if (superAdminCount <= 1) throw new Error('LAST_SUPER_ADMIN')
      }

      const storagePaths = collectStoragePaths([target.avatarUrl, target.backgroundUrl, target.profile?.avatarUrl, target.profile?.backgroundUrl])
      const deletedRows = await deleteUserRows(tx, input.userId, input.deletePublicContent)

      if (!isSelf) {
        await tx.adminAction.create({
          data: {
            adminId: input.adminId,
            targetUserId: null,
            action: 'DELETE_USER',
            reason: 'Permanent user deletion',
            metadata: {
              targetUserId: input.userId,
              targetUid: uidLabel(target.uid),
              targetNickname: target.nickname,
              deletePublicContent: input.deletePublicContent,
              deletedRows,
            },
          },
        })
      }

      return {
        targetUid: uidLabel(target.uid),
        storagePaths,
        deletedRows,
      }
    },
    { maxWait: 5000, timeout: 15000 },
  )

  const storageFilesDeleted = await deleteStorageFiles([...new Set(transactionResult.storagePaths)])

  return {
    success: true,
    message: 'User permanently deleted.',
    targetUserId: input.userId,
    targetUid: transactionResult.targetUid,
    deletedRows: transactionResult.deletedRows,
    storageFilesDeleted,
    authUserDeleted: false,
  }
}
