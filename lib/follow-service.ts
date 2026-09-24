import type { Prisma } from '@prisma/client'
import { getEquippedBadgesForUsers } from '@/lib/badge-service'
import type { EquippedBadgeView } from '@/lib/badge-types'
import { getPublicUserDisplayName } from '@/lib/friend-display'
import { activeUserWhere } from '@/lib/friends'
import { publicImageUrl } from '@/lib/images'
import { prisma } from '@/lib/prisma'
import type { RelationshipView } from '@/lib/relationship-resolver'

export const followUserSelect = {
  id: true,
  uid: true,
  nickname: true,
  nicknameModerationStatus: true,
  nicknameViolationDisplay: true,
  avatarUrl: true,
  Profile: { select: { avatarUrl: true } },
} satisfies Prisma.UserSelect

export type FollowUser = Prisma.UserGetPayload<{ select: typeof followUserSelect }>

export async function findActiveFollowTarget(userId: string) {
  return prisma.user.findFirst({
    where: { id: userId, ...activeUserWhere },
    select: followUserSelect,
  })
}

export function parseFollowPagination(request: Request) {
  const params = new URL(request.url).searchParams
  const rawPage = Number(params.get('page'))
  const rawPageSize = Number(params.get('pageSize'))
  const page = Math.min(10_000, Math.max(1, Number.isSafeInteger(rawPage) ? rawPage : 1))
  const pageSize = Math.min(50, Math.max(1, Number.isSafeInteger(rawPageSize) ? rawPageSize : 20))
  return { page, pageSize, skip: (page - 1) * pageSize }
}

export function serializeFollowUser(
  user: FollowUser,
  relationship: RelationshipView,
  badges: EquippedBadgeView[],
) {
  return {
    id: user.id,
    uid: user.uid,
    nickname: getPublicUserDisplayName(user),
    avatarUrl: publicImageUrl(user.avatarUrl) || publicImageUrl(user.Profile?.avatarUrl),
    badge: badges[0] || null,
    badges,
    relationship,
  }
}

export async function getFollowListBadges(userIds: string[], viewerId: string) {
  return getEquippedBadgesForUsers(userIds, new Date(), viewerId)
}

export const privateFollowHeaders = {
  'Cache-Control': 'private, no-store, max-age=0',
}
