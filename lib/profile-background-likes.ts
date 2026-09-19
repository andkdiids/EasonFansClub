import { Prisma } from '@prisma/client'
import { getEquippedBadgesForUsers } from '@/lib/badge-service'
import type { EquippedBadgeView } from '@/lib/badge-types'
import { getShanghaiDateKey } from '@/lib/checkin'
import { getPublicUserDisplayName } from '@/lib/friend-display'
import { profileImageUrl, publicImageUrl } from '@/lib/images'
import { upsertNotificationWithDb } from '@/lib/notification-write'
import { prisma } from '@/lib/prisma'
import { emitRealtime } from '@/lib/realtime'
import { formatUid } from '@/lib/uid'

export const PROFILE_BACKGROUND_LIKE_DAILY_LIMIT = 10
export const PROFILE_BACKGROUND_LIKER_PAGE_SIZE = 20
export const PROFILE_BACKGROUND_LIKE_NOTIFICATION_KEY = 'profile-background-like'

const activeLikerWhere = {
  status: 'ACTIVE' as const,
  isDeleted: false,
  Profile: { isNot: null },
}

const likerDisplaySelect = {
  id: true,
  uid: true,
  nickname: true,
  usernameModerationStatus: true,
  nicknameModerationStatus: true,
  nicknameViolationDisplay: true,
  avatarUrl: true,
  Profile: {
    select: {
      displayName: true,
      displayNameModerationStatus: true,
      avatarUrl: true,
    },
  },
} as const

export type ProfileBackgroundLikeErrorCode =
  | 'SELF_LIKE_NOT_ALLOWED'
  | 'PROFILE_OWNER_NOT_FOUND'
  | 'PROFILE_BACKGROUND_ACCESS_DENIED'
  | 'PROFILE_BACKGROUND_REQUIRED'
  | 'PROFILE_BACKGROUND_DAILY_LIMIT_REACHED'

export class ProfileBackgroundLikeError extends Error {
  constructor(
    readonly code: ProfileBackgroundLikeErrorCode,
    message: string,
  ) {
    super(message)
    this.name = 'ProfileBackgroundLikeError'
  }
}

export type ProfileBackgroundLikeSummary = {
  backgroundLikeCount: number
  hasLikedBackground: boolean
  todayBackgroundLikeUsed: number
  dailyBackgroundLikeLimit: number
}

export type ProfileBackgroundLikerItem = {
  id: string
  uid: number
  displayName: string
  avatarUrl: string | null
  profileUrl: string
  likedAt: string
  equippedBadges: EquippedBadgeView[]
  equippedBadge: EquippedBadgeView | null
}

export function evaluateProfileBackgroundLikeQuota(input: {
  targetAlreadyCountedToday: boolean
  todayUsed: number
  limit?: number
}) {
  const limit = Math.max(0, Math.trunc(input.limit ?? PROFILE_BACKGROUND_LIKE_DAILY_LIMIT))
  const todayUsed = Math.max(0, Math.trunc(input.todayUsed))
  return {
    allowed: input.targetAlreadyCountedToday || todayUsed < limit,
    consumesQuota: !input.targetAlreadyCountedToday && todayUsed < limit,
  }
}

function ownerHasBackground(owner: {
  backgroundUrl: string | null
  Profile: { backgroundUrl: string | null } | null
}) {
  return Boolean(profileImageUrl(owner.Profile?.backgroundUrl || owner.backgroundUrl))
}

export function formatProfileBackgroundLikeNotification(actorNames: string[], count: number) {
  const visibleNames = actorNames.map((name) => name.trim()).filter(Boolean).slice(0, 2)
  if (count <= 0) return ''
  if (count === 1) return `${visibleNames[0] || '有人'}赞了你的主页背景`
  if (count === 2) return `${visibleNames[0] || '有人'}、${visibleNames[1] || '另一位用户'}赞了你的主页背景`
  return `${visibleNames[0] || '有人'}、${visibleNames[1] || '另一位用户'}等 ${count} 人赞了你的主页背景`
}

async function loadTodayUsed(
  db: Prisma.TransactionClient | typeof prisma,
  likerId: string,
  businessDate: string,
) {
  return db.profileBackgroundLikeDailyAction.count({ where: { likerId, businessDate } })
}

async function countCurrentLikes(db: Prisma.TransactionClient | typeof prisma, profileOwnerId: string) {
  return db.profileBackgroundLike.count({
    where: { profileOwnerId, Liker: activeLikerWhere },
  })
}

async function reconcileAggregateNotification(
  tx: Prisma.TransactionClient,
  profileOwnerId: string,
  now: Date,
  markUnread: boolean,
) {
  const [count, recentLikes] = await Promise.all([
    countCurrentLikes(tx, profileOwnerId),
    tx.profileBackgroundLike.findMany({
      where: { profileOwnerId, Liker: activeLikerWhere },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 2,
      select: { likerId: true, Liker: { select: likerDisplaySelect } },
    }),
  ])

  if (count === 0) {
    const deleted = await tx.notification.deleteMany({
      where: {
        recipientId: profileOwnerId,
        type: 'PROFILE_BACKGROUND_LIKE',
        key: PROFILE_BACKGROUND_LIKE_NOTIFICATION_KEY,
      },
    })
    return deleted.count > 0
  }

  const actorNames = recentLikes.map((like) => getPublicUserDisplayName(like.Liker))
  const content = formatProfileBackgroundLikeNotification(actorNames, count)
  const latestActorId = recentLikes[0]?.likerId || null
  const keyWhere = {
    recipientId_key: {
      recipientId: profileOwnerId,
      key: PROFILE_BACKGROUND_LIKE_NOTIFICATION_KEY,
    },
  }
  const commonData = {
    actorId: latestActorId,
    type: 'PROFILE_BACKGROUND_LIKE' as const,
    title: '主页背景获赞',
    content,
    aggregateCount: count,
    link: '/profile?backgroundLikes=1',
  }

  if (!markUnread) {
    const existing = await tx.notification.findUnique({ where: keyWhere, select: { id: true } })
    if (!existing) return false
    await tx.notification.update({ where: { id: existing.id }, data: commonData })
    return true
  }

  await upsertNotificationWithDb(tx, {
    where: keyWhere,
    update: {
      ...commonData,
      isRead: false,
      readAt: null,
      createdAt: now,
    },
    create: {
      recipientId: profileOwnerId,
      ...commonData,
      isRead: false,
      readAt: null,
      createdAt: now,
    },
  }, { operation: 'profile-background-like.aggregate', userId: profileOwnerId })
  return true
}

export async function getProfileBackgroundLikeSummary(
  profileOwnerId: string,
  viewerId?: string | null,
  now = new Date(),
): Promise<ProfileBackgroundLikeSummary> {
  const businessDate = getShanghaiDateKey(now)
  const [backgroundLikeCount, existingLike, todayBackgroundLikeUsed] = await Promise.all([
    countCurrentLikes(prisma, profileOwnerId),
    viewerId && viewerId !== profileOwnerId
      ? prisma.profileBackgroundLike.findUnique({
          where: { likerId_profileOwnerId: { likerId: viewerId, profileOwnerId } },
          select: { id: true },
        })
      : Promise.resolve(null),
    viewerId ? loadTodayUsed(prisma, viewerId, businessDate) : Promise.resolve(0),
  ])

  return {
    backgroundLikeCount,
    hasLikedBackground: Boolean(existingLike),
    todayBackgroundLikeUsed,
    dailyBackgroundLikeLimit: PROFILE_BACKGROUND_LIKE_DAILY_LIMIT,
  }
}

export async function setProfileBackgroundLike(input: {
  likerId: string
  profileOwnerId: string
  liked: boolean
  now?: Date
}) {
  const now = input.now || new Date()
  const businessDate = getShanghaiDateKey(now)

  const result = await prisma.$transaction(async (tx) => {
    if (input.likerId === input.profileOwnerId) {
      throw new ProfileBackgroundLikeError('SELF_LIKE_NOT_ALLOWED', '不能给自己的主页背景点赞')
    }

    // Lock both users in one deterministic order. Requests from one liker are
    // serialized for the daily quota, while requests from different likers to
    // one owner are serialized for the aggregate notification. The ORDER BY
    // also avoids opposite lock order when two users like each other at once.
    const lockedUsers = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT \`id\` FROM \`User\`
      WHERE \`id\` IN (${input.likerId}, ${input.profileOwnerId})
        AND \`status\` = 'ACTIVE' AND \`isDeleted\` = 0
      ORDER BY \`id\` ASC
      FOR UPDATE
    `)
    if (!lockedUsers.some((user) => user.id === input.likerId)) {
      throw new ProfileBackgroundLikeError('PROFILE_OWNER_NOT_FOUND', '用户不存在或不可用')
    }

    const owner = await tx.user.findFirst({
      where: { id: input.profileOwnerId, status: 'ACTIVE', isDeleted: false, Profile: { isNot: null } },
      select: { id: true, backgroundUrl: true, Profile: { select: { backgroundUrl: true } } },
    })
    if (!owner) {
      throw new ProfileBackgroundLikeError('PROFILE_OWNER_NOT_FOUND', '用户不存在或不可用')
    }
    const blocked = await tx.block.findFirst({
      where: {
        OR: [
          { blockerId: input.likerId, blockedId: owner.id },
          { blockerId: owner.id, blockedId: input.likerId },
        ],
      },
      select: { id: true },
    })
    if (blocked && input.liked) {
      throw new ProfileBackgroundLikeError('PROFILE_BACKGROUND_ACCESS_DENIED', '当前无法与该用户互动')
    }

    const existing = await tx.profileBackgroundLike.findUnique({
      where: { likerId_profileOwnerId: { likerId: input.likerId, profileOwnerId: owner.id } },
      select: { id: true },
    })

    if (!input.liked) {
      if (!existing) {
        return {
          changed: false,
          notificationChanged: false,
          liked: false,
          backgroundLikeCount: await countCurrentLikes(tx, owner.id),
          todayBackgroundLikeUsed: await loadTodayUsed(tx, input.likerId, businessDate),
        }
      }

      await tx.profileBackgroundLike.delete({ where: { id: existing.id } })
      const notificationChanged = await reconcileAggregateNotification(tx, owner.id, now, false)
      return {
        changed: true,
        notificationChanged,
        liked: false,
        backgroundLikeCount: await countCurrentLikes(tx, owner.id),
        todayBackgroundLikeUsed: await loadTodayUsed(tx, input.likerId, businessDate),
      }
    }

    if (existing) {
      return {
        changed: false,
        notificationChanged: false,
        liked: true,
        backgroundLikeCount: await countCurrentLikes(tx, owner.id),
        todayBackgroundLikeUsed: await loadTodayUsed(tx, input.likerId, businessDate),
      }
    }
    if (!ownerHasBackground(owner)) {
      throw new ProfileBackgroundLikeError('PROFILE_BACKGROUND_REQUIRED', '该用户暂未设置主页背景图')
    }

    const existingDailyAction = await tx.profileBackgroundLikeDailyAction.findUnique({
      where: {
        likerId_profileOwnerId_businessDate: {
          likerId: input.likerId,
          profileOwnerId: owner.id,
          businessDate,
        },
      },
      select: { id: true },
    })
    if (!existingDailyAction) {
      const todayUsed = await loadTodayUsed(tx, input.likerId, businessDate)
      const quota = evaluateProfileBackgroundLikeQuota({ targetAlreadyCountedToday: false, todayUsed })
      if (!quota.allowed) {
        throw new ProfileBackgroundLikeError(
          'PROFILE_BACKGROUND_DAILY_LIMIT_REACHED',
          '今天已经为 10 位用户的主页背景点过赞啦，明天再来吧',
        )
      }
      await tx.profileBackgroundLikeDailyAction.create({
        data: { likerId: input.likerId, profileOwnerId: owner.id, businessDate, createdAt: now },
      })
    }

    await tx.profileBackgroundLike.create({
      data: { likerId: input.likerId, profileOwnerId: owner.id, createdAt: now },
    })
    const notificationChanged = await reconcileAggregateNotification(tx, owner.id, now, true)
    return {
      changed: true,
      notificationChanged,
      liked: true,
      backgroundLikeCount: await countCurrentLikes(tx, owner.id),
      todayBackgroundLikeUsed: await loadTodayUsed(tx, input.likerId, businessDate),
    }
  }, { timeout: 15_000, maxWait: 5_000 })

  if (result.notificationChanged) emitRealtime(input.profileOwnerId, 'notification')
  return {
    ok: true as const,
    liked: result.liked,
    backgroundLikeCount: result.backgroundLikeCount,
    todayBackgroundLikeUsed: result.todayBackgroundLikeUsed,
    dailyBackgroundLikeLimit: PROFILE_BACKGROUND_LIKE_DAILY_LIMIT,
  }
}

export async function listProfileBackgroundLikers(input: {
  profileOwnerId: string
  viewerId?: string | null
  page?: number
  pageSize?: number
}) {
  const pageSize = Math.min(50, Math.max(1, Math.trunc(input.pageSize || PROFILE_BACKGROUND_LIKER_PAGE_SIZE)))
  const total = await countCurrentLikes(prisma, input.profileOwnerId)
  const totalPages = Math.max(1, Math.ceil(total / pageSize))
  const page = Math.min(totalPages, Math.max(1, Math.trunc(input.page || 1)))
  const likes = await prisma.profileBackgroundLike.findMany({
    where: { profileOwnerId: input.profileOwnerId, Liker: activeLikerWhere },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    skip: (page - 1) * pageSize,
    take: pageSize,
    select: {
      likerId: true,
      createdAt: true,
      Liker: { select: likerDisplaySelect },
    },
  })
  const badgeMap = await getEquippedBadgesForUsers(likes.map((like) => like.likerId), new Date(), input.viewerId)
  const items: ProfileBackgroundLikerItem[] = likes.map((like) => {
    const equippedBadges = badgeMap.get(like.likerId) || []
    return {
      id: like.Liker.id,
      uid: like.Liker.uid,
      displayName: getPublicUserDisplayName(like.Liker),
      avatarUrl: publicImageUrl(like.Liker.Profile?.avatarUrl || like.Liker.avatarUrl),
      profileUrl: `/user/${formatUid(like.Liker.uid)}`,
      likedAt: like.createdAt.toISOString(),
      equippedBadges,
      equippedBadge: equippedBadges[0] || null,
    }
  })

  return {
    items,
    pagination: {
      page,
      pageSize,
      total,
      totalPages,
      hasMore: page < totalPages,
    },
  }
}
