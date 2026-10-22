import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { getPublicUserDisplayName } from '@/lib/friend-remarks'
import { publicModerationText } from '@/lib/content-moderation'
import { publicImageUrl } from '@/lib/images'
import { publicProfileIpRegion } from '@/lib/ip-region'

const publicUserSelect = {
  id: true,
  uid: true,
  nickname: true,
  usernameModerationStatus: true,
  nicknameModerationStatus: true,
  nicknameViolationDisplay: true,
  avatarUrl: true,
  backgroundUrl: true,
  bio: true,
  bioModerationStatus: true,
  ipRegion: true,
  Profile: {
    select: {
      displayName: true,
      displayNameModerationStatus: true,
      avatarUrl: true,
      backgroundUrl: true,
      bio: true,
      bioModerationStatus: true,
    },
  },
} as const

const activePublicUser = { status: 'ACTIVE' as const, isDeleted: false, Profile: { isNot: null } }

type ProfileConnectionUser = Prisma.UserGetPayload<{ select: typeof publicUserSelect }>

function serializeProfileConnectionUser(user: ProfileConnectionUser) {
  const displayName = getPublicUserDisplayName(user)
  const profile = user.Profile
  return {
    id: user.id,
    uid: user.uid,
    nickname: displayName,
    displayName,
    avatarUrl: publicImageUrl(profile?.avatarUrl || user.avatarUrl),
    backgroundUrl: publicImageUrl(profile?.backgroundUrl || user.backgroundUrl),
    bio: publicModerationText(profile?.bio || user.bio, profile?.bioModerationStatus || user.bioModerationStatus),
    ipRegion: publicProfileIpRegion(user.ipRegion),
    profile: profile ? {
      displayName,
      avatarUrl: publicImageUrl(profile.avatarUrl),
      backgroundUrl: publicImageUrl(profile.backgroundUrl),
      bio: publicModerationText(profile.bio, profile.bioModerationStatus),
    } : null,
  }
}

function paginatedUsers(users: ReturnType<typeof serializeProfileConnectionUser>[], total: number, page: number, pageSize: number) {
  const totalPages = Math.ceil(total / pageSize)
  return {
    users,
    pagination: { page, pageSize, total, totalPages, hasMore: page < totalPages },
  }
}

export async function getProfileConnectionPage(userId: string, viewerId: string, kind: 'followers' | 'following', page: number, pageSize: number) {
  if (viewerId !== userId) {
    const block = await prisma.block.findFirst({
      where: { OR: [{ blockerId: viewerId, blockedId: userId }, { blockerId: userId, blockedId: viewerId }] },
      select: { id: true },
    })
    if (block) return paginatedUsers([], 0, page, pageSize)
  }

  if (kind === 'followers') {
    const where = { followingId: userId, User_Follow_followerIdToUser: { is: activePublicUser } }
    const [total, rows] = await Promise.all([
      prisma.follow.count({ where }),
      prisma.follow.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: { User_Follow_followerIdToUser: { select: publicUserSelect } },
      }),
    ])
    return paginatedUsers(rows.map((row) => serializeProfileConnectionUser(row.User_Follow_followerIdToUser)), total, page, pageSize)
  }

  const where = { followerId: userId, User_Follow_followingIdToUser: { is: activePublicUser } }
  const [total, rows] = await Promise.all([
    prisma.follow.count({ where }),
    prisma.follow.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: { User_Follow_followingIdToUser: { select: publicUserSelect } },
    }),
  ])
  return paginatedUsers(rows.map((row) => serializeProfileConnectionUser(row.User_Follow_followingIdToUser)), total, page, pageSize)
}
