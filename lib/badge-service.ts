import { Prisma } from '@prisma/client'
import { toPublicMediaUrl } from '@/lib/media-url'
import { prisma } from '@/lib/prisma'
import type { BadgeCollectionView, BadgeView, EquippedBadgeView } from '@/lib/badge-types'

const BADGE_SELECT = {
  id: true,
  code: true,
  slug: true,
  name: true,
  description: true,
  acquisitionDescription: true,
  iconUrl: true,
  visibility: true,
  rarity: true,
  grantType: true,
  isWearable: true,
  isEnabled: true,
  isActive: true,
  effectType: true,
  nicknameEffect: true,
  nicknameColor: true,
  nicknameGradientStart: true,
  nicknameGradientEnd: true,
  sortOrder: true,
} as const

type DbBadge = Prisma.BadgeGetPayload<{ select: typeof BADGE_SELECT }>
type DbUserBadge = {
  obtainedAt: Date
  grantedAt: Date
  Badge: DbBadge
}

export type GrantBadgeInput = {
  userId: string
  badgeId: string
  sourceType?: string | null
  sourceId?: string | null
  grantReason?: string | null
  actorId?: string | null
  obtainedAt?: Date
}

export type BadgeOperationResult = {
  created: boolean
  alreadyOwned?: boolean
  recordId: string
  userId: string
  badgeId: string
  badgeName: string
}

export class BadgeServiceError extends Error {
  code: 'USER_NOT_FOUND' | 'BADGE_NOT_FOUND' | 'BADGE_DISABLED' | 'BADGE_NOT_WEARABLE' | 'NOT_OWNED' | 'NOT_FOUND' | 'HAS_OWNERS'

  constructor(code: BadgeServiceError['code'], message: string) {
    super(message)
    this.name = 'BadgeServiceError'
    this.code = code
  }
}

type BadgeAdminActionInput = {
  actorId: string
  action: string
  badgeId: string
  targetUserId?: string
  detail?: Record<string, unknown>
}

/** Keep every administrative badge mutation auditable in the same transaction as the mutation. */
export async function writeBadgeAdminAction(tx: Prisma.TransactionClient, input: BadgeAdminActionInput) {
  await tx.adminActionLog.create({
    data: {
      adminId: input.actorId,
      action: input.action,
      targetUserId: input.targetUserId || input.actorId,
      detail: { badgeId: input.badgeId, ...(input.detail || {}) } as Prisma.InputJsonValue,
    },
  })
}

/** Serialize badge ownership/equipment mutations with admin state changes. */
export async function lockBadgeForMutation(tx: Prisma.TransactionClient, badgeId: string) {
  const rows = await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM \`Badge\` WHERE id = ${badgeId} FOR UPDATE`
  if (!rows.length) throw new BadgeServiceError('BADGE_NOT_FOUND', '勋章不存在')
}

function publicBadge(badge: DbBadge): Omit<BadgeView, 'status' | 'obtainedAt' | 'isEquipped'> {
  return {
    id: badge.id,
    code: badge.code,
    name: badge.name,
    imageUrl: toPublicMediaUrl(badge.iconUrl),
    description: badge.description,
    acquisitionDescription: badge.acquisitionDescription,
    visibility: badge.visibility,
    rarity: badge.rarity,
    grantType: badge.grantType,
    isWearable: badge.isWearable,
    isEnabled: badge.isEnabled && badge.isActive,
    effectType: badge.effectType,
    nicknameEffect: badge.nicknameEffect,
    nicknameColor: badge.nicknameColor,
    nicknameGradientStart: badge.nicknameGradientStart,
    nicknameGradientEnd: badge.nicknameGradientEnd,
    sortOrder: badge.sortOrder,
  }
}

function obtainedBadgeView(record: DbUserBadge, isEquipped: boolean): BadgeView {
  return {
    ...publicBadge(record.Badge),
    status: 'OBTAINED',
    obtainedAt: record.obtainedAt.toISOString(),
    isEquipped,
  }
}

function hiddenBadgeView(badge: DbBadge): BadgeView {
  return {
    id: badge.id,
    name: '???',
    imageUrl: null,
    description: null,
    acquisitionDescription: null,
    visibility: 'HIDDEN',
    rarity: 'COMMON',
    grantType: 'MANUAL',
    isWearable: false,
    isEnabled: badge.isEnabled && badge.isActive,
    effectType: 'NONE',
    nicknameEffect: 'NONE',
    nicknameColor: null,
    nicknameGradientStart: null,
    nicknameGradientEnd: null,
    sortOrder: badge.sortOrder,
    status: 'HIDDEN',
    obtainedAt: null,
    isEquipped: false,
  }
}

function sortBadgeViews(items: BadgeView[], equippedBadgeId: string | null) {
  return items.sort((left, right) => {
    if (left.id === equippedBadgeId) return -1
    if (right.id === equippedBadgeId) return 1
    if (left.sortOrder !== right.sortOrder) return left.sortOrder - right.sortOrder
    const leftTime = left.obtainedAt ? new Date(left.obtainedAt).getTime() : 0
    const rightTime = right.obtainedAt ? new Date(right.obtainedAt).getTime() : 0
    return rightTime - leftTime || left.name.localeCompare(right.name, 'zh-CN')
  })
}

export async function getBadgeCollection(userId: string, viewerId?: string | null): Promise<BadgeCollectionView | null> {
  const target = await prisma.user.findFirst({
    where: { id: userId, status: 'ACTIVE', isDeleted: false, Profile: { isNot: null } },
    select: {
      id: true,
      uid: true,
      equippedBadgeId: true,
      EquippedBadge: { select: BADGE_SELECT },
    },
  })
  if (!target) return null

  const isSelf = viewerId === userId
  const [records, allBadges] = await Promise.all([
    prisma.userBadge.findMany({
      where: { userId, ...(isSelf ? {} : { isHidden: false }) },
      orderBy: [{ obtainedAt: 'desc' }, { grantedAt: 'desc' }, { id: 'desc' }],
      select: { obtainedAt: true, grantedAt: true, Badge: { select: BADGE_SELECT } },
    }),
    isSelf
      ? prisma.badge.findMany({
          where: { OR: [{ isEnabled: true, isActive: true }, { UserBadge: { some: { userId } } }] },
          orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
          select: BADGE_SELECT,
        })
      : Promise.resolve([] as DbBadge[]),
  ])

  const equippedBadgeId = target.EquippedBadge && target.EquippedBadge.isEnabled && target.EquippedBadge.isActive && target.EquippedBadge.isWearable && records.some((record) => record.Badge.id === target.EquippedBadge?.id)
    ? target.EquippedBadge.id
    : null
  const recordByBadgeId = new Map(records.map((record) => [record.Badge.id, record]))

  if (!isSelf) {
    return {
      target: { id: target.id, uid: target.uid },
      isSelf: false,
      equippedBadgeId,
      obtainedCount: records.length,
      visibleTotal: records.length,
      items: sortBadgeViews(records.map((record) => obtainedBadgeView(record, record.Badge.id === equippedBadgeId)), equippedBadgeId),
    }
  }

  const items = allBadges.flatMap((badge) => {
    const record = recordByBadgeId.get(badge.id)
    if (record) return [obtainedBadgeView(record, badge.id === equippedBadgeId)]
    if (badge.visibility === 'SECRET') return []
    return [badge.visibility === 'HIDDEN'
      ? hiddenBadgeView(badge)
      : { ...publicBadge(badge), status: 'NOT_OBTAINED' as const, obtainedAt: null, isEquipped: false }]
  })

  return {
    target: { id: target.id, uid: target.uid },
    isSelf: true,
    equippedBadgeId,
    obtainedCount: records.length,
    visibleTotal: allBadges.filter((badge) => badge.isEnabled && badge.isActive && badge.visibility !== 'SECRET').length,
    items: sortBadgeViews(items, equippedBadgeId),
  }
}

export async function getEquippedBadgeForUser(userId: string): Promise<EquippedBadgeView | null> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { equippedBadgeId: true, EquippedBadge: { select: BADGE_SELECT } },
  })
  if (!user?.equippedBadgeId || !user.EquippedBadge || !user.EquippedBadge.isEnabled || !user.EquippedBadge.isActive || !user.EquippedBadge.isWearable) return null

  const owned = await prisma.userBadge.findUnique({
    where: { userId_badgeId: { userId, badgeId: user.equippedBadgeId } },
    select: { obtainedAt: true },
  })
  if (!owned) return null

  return {
    id: user.EquippedBadge.id,
    code: user.EquippedBadge.code,
    name: user.EquippedBadge.name,
    imageUrl: toPublicMediaUrl(user.EquippedBadge.iconUrl),
    effectType: user.EquippedBadge.effectType,
    nicknameEffect: user.EquippedBadge.nicknameEffect,
    nicknameColor: user.EquippedBadge.nicknameColor,
    nicknameGradientStart: user.EquippedBadge.nicknameGradientStart,
    nicknameGradientEnd: user.EquippedBadge.nicknameGradientEnd,
    rarity: user.EquippedBadge.rarity,
    obtainedAt: owned.obtainedAt.toISOString(),
    description: user.EquippedBadge.description,
    acquisitionDescription: user.EquippedBadge.acquisitionDescription,
    isWearable: user.EquippedBadge.isWearable,
    isEnabled: user.EquippedBadge.isEnabled && user.EquippedBadge.isActive,
  }
}

/** Load the current badge for many authors in two bounded queries, never one query per nickname. */
export async function getEquippedBadgesForUsers(userIds: Iterable<string>) {
  const ids = [...new Set([...userIds].filter(Boolean))]
  const result = new Map<string, EquippedBadgeView>()
  if (!ids.length) return result

  const users = await prisma.user.findMany({
    where: { id: { in: ids } },
    select: { id: true, equippedBadgeId: true, EquippedBadge: { select: BADGE_SELECT } },
  })
  const equippedUsers = users.filter((user) => Boolean(user.equippedBadgeId && user.EquippedBadge && user.EquippedBadge.isEnabled && user.EquippedBadge.isActive && user.EquippedBadge.isWearable))
  if (!equippedUsers.length) return result
  const records = await prisma.userBadge.findMany({
    where: { userId: { in: equippedUsers.map((user) => user.id) }, badgeId: { in: equippedUsers.map((user) => user.equippedBadgeId!).filter(Boolean) } },
    select: { userId: true, badgeId: true, obtainedAt: true },
  })
  const recordByUserId = new Map(records.map((record) => [`${record.userId}:${record.badgeId}`, record]))
  for (const user of equippedUsers) {
    if (!user.equippedBadgeId || !user.EquippedBadge) continue
    const record = recordByUserId.get(`${user.id}:${user.equippedBadgeId}`)
    if (!record) continue
    result.set(user.id, {
      id: user.EquippedBadge.id,
      code: user.EquippedBadge.code,
      name: user.EquippedBadge.name,
      imageUrl: toPublicMediaUrl(user.EquippedBadge.iconUrl),
      effectType: user.EquippedBadge.effectType,
      nicknameEffect: user.EquippedBadge.nicknameEffect,
      nicknameColor: user.EquippedBadge.nicknameColor,
      nicknameGradientStart: user.EquippedBadge.nicknameGradientStart,
      nicknameGradientEnd: user.EquippedBadge.nicknameGradientEnd,
      rarity: user.EquippedBadge.rarity,
      obtainedAt: record.obtainedAt.toISOString(),
      description: user.EquippedBadge.description,
      acquisitionDescription: user.EquippedBadge.acquisitionDescription,
      isWearable: user.EquippedBadge.isWearable,
      isEnabled: user.EquippedBadge.isEnabled && user.EquippedBadge.isActive,
    })
  }
  return result
}

export async function grantBadge(input: GrantBadgeInput): Promise<BadgeOperationResult> {
  const obtainedAt = input.obtainedAt || new Date()
  const sourceType = input.sourceType?.trim().slice(0, 32) || null
  const sourceId = input.sourceId?.trim().slice(0, 191) || null
  const grantReason = input.grantReason?.trim().slice(0, 500) || null

  try {
    return await prisma.$transaction(async (tx) => {
      const [user, badge] = await Promise.all([
        tx.user.findUnique({ where: { id: input.userId }, select: { id: true } }),
        tx.badge.findUnique({ where: { id: input.badgeId }, select: { id: true, name: true } }),
      ])
      if (!user) throw new BadgeServiceError('USER_NOT_FOUND', '目标用户不存在')
      if (!badge) throw new BadgeServiceError('BADGE_NOT_FOUND', '勋章不存在')

      const existing = await tx.userBadge.findUnique({
        where: { userId_badgeId: { userId: input.userId, badgeId: input.badgeId } },
        select: { id: true },
      })
      if (existing) {
        return {
          created: false,
          alreadyOwned: true,
          recordId: existing.id,
          userId: input.userId,
          badgeId: input.badgeId,
          badgeName: badge.name,
        }
      }

      const record = await tx.userBadge.create({
        data: {
          userId: input.userId,
          badgeId: input.badgeId,
          obtainedAt,
          grantedAt: obtainedAt,
          createdAt: obtainedAt,
          sourceType,
          sourceId,
          grantReason,
          grantedBy: input.actorId || null,
        },
        select: { id: true },
      })

      if (input.actorId) await writeBadgeAdminAction(tx, {
        actorId: input.actorId,
        action: 'BADGE_GRANT',
        targetUserId: input.userId,
        badgeId: input.badgeId,
        detail: { badgeName: badge.name, obtainedAt: obtainedAt.toISOString(), sourceType, sourceId, grantReason },
      })

      return {
        created: true,
        recordId: record.id,
        userId: input.userId,
        badgeId: input.badgeId,
        badgeName: badge.name,
      }
    })
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      const existing = await prisma.userBadge.findUnique({
        where: { userId_badgeId: { userId: input.userId, badgeId: input.badgeId } },
        select: { id: true, Badge: { select: { name: true } } },
      })
      if (existing) {
        return {
          created: false,
          alreadyOwned: true,
          recordId: existing.id,
          userId: input.userId,
          badgeId: input.badgeId,
          badgeName: existing.Badge.name,
        }
      }
    }
    throw error
  }
}

export async function hasBadge(userId: string, badgeId: string) {
  const record = await prisma.userBadge.findUnique({
    where: { userId_badgeId: { userId, badgeId } },
    select: { id: true },
  })
  return Boolean(record)
}

export async function revokeBadge({ userId, badgeId, actorId, reason }: { userId: string; badgeId: string; actorId?: string | null; reason?: string | null }) {
  return prisma.$transaction(async (tx) => {
    await lockBadgeForMutation(tx, badgeId)
    const record = await tx.userBadge.findUnique({
      where: { userId_badgeId: { userId, badgeId } },
      select: { id: true, Badge: { select: { name: true } } },
    })
    if (!record) throw new BadgeServiceError('NOT_FOUND', '该用户尚未拥有此勋章')

    await tx.userBadge.delete({ where: { id: record.id } })
    await tx.user.updateMany({ where: { id: userId, equippedBadgeId: badgeId }, data: { equippedBadgeId: null } })

    if (actorId) await writeBadgeAdminAction(tx, {
      actorId,
      action: 'BADGE_REVOKE',
      targetUserId: userId,
      badgeId,
      detail: { badgeName: record.Badge.name, reason: reason?.trim().slice(0, 500) || null },
    })

    return { userId, badgeId, badgeName: record.Badge.name }
  })
}

export async function equipBadge(userId: string, badgeId: string) {
  return prisma.$transaction(async (tx) => {
    await lockBadgeForMutation(tx, badgeId)
    const record = await tx.userBadge.findUnique({
      where: { userId_badgeId: { userId, badgeId } },
      select: { id: true, obtainedAt: true, Badge: { select: BADGE_SELECT } },
    })
    if (!record) throw new BadgeServiceError('NOT_OWNED', '你还没有获得这枚勋章')
    if (!record.Badge.isEnabled || !record.Badge.isActive) throw new BadgeServiceError('BADGE_DISABLED', '这枚勋章当前已停用')
    if (!record.Badge.isWearable) throw new BadgeServiceError('BADGE_NOT_WEARABLE', '这枚勋章不允许佩戴')

    await tx.user.update({ where: { id: userId }, data: { equippedBadgeId: badgeId } })
    return {
      equippedBadgeId: badgeId,
      badge: {
        id: record.Badge.id,
        code: record.Badge.code,
        name: record.Badge.name,
        imageUrl: toPublicMediaUrl(record.Badge.iconUrl),
        effectType: record.Badge.effectType,
        nicknameEffect: record.Badge.nicknameEffect,
        nicknameColor: record.Badge.nicknameColor,
        nicknameGradientStart: record.Badge.nicknameGradientStart,
        nicknameGradientEnd: record.Badge.nicknameGradientEnd,
        rarity: record.Badge.rarity,
        obtainedAt: record.obtainedAt.toISOString(),
        description: record.Badge.description,
        acquisitionDescription: record.Badge.acquisitionDescription,
        isWearable: record.Badge.isWearable,
        isEnabled: record.Badge.isEnabled && record.Badge.isActive,
      } satisfies EquippedBadgeView,
    }
  })
}

export async function unequipBadge(userId: string) {
  await prisma.user.updateMany({ where: { id: userId }, data: { equippedBadgeId: null } })
  return { equippedBadgeId: null }
}

export async function disableBadge(badgeId: string, enabled: boolean, actorId?: string | null) {
  return prisma.$transaction(async (tx) => {
    const badge = await tx.badge.update({ where: { id: badgeId }, data: { isEnabled: enabled, isActive: enabled }, select: { id: true, name: true } })
    if (!enabled) await tx.user.updateMany({ where: { equippedBadgeId: badgeId }, data: { equippedBadgeId: null } })
    if (actorId) await writeBadgeAdminAction(tx, {
      actorId,
      action: enabled ? 'BADGE_ENABLE' : 'BADGE_DISABLE',
      badgeId,
      detail: { badgeName: badge.name },
    })
    return badge
  })
}

export async function deleteBadgeSafely(badgeId: string, actorId?: string | null) {
  try {
    return await prisma.$transaction(async (tx) => {
      await lockBadgeForMutation(tx, badgeId)
      const ownerCount = await tx.userBadge.count({ where: { badgeId } })
      if (ownerCount > 0) throw new BadgeServiceError('HAS_OWNERS', `该勋章已有 ${ownerCount} 位用户获得，请先停用；为保护历史记录不能直接删除`)

      const badge = await tx.badge.delete({ where: { id: badgeId }, select: { id: true, name: true } })
      if (actorId) await writeBadgeAdminAction(tx, {
        actorId,
        action: 'BADGE_DELETE',
        badgeId,
        detail: { badgeName: badge.name },
      })
      return badge
    })
  } catch (error) {
    if (error instanceof BadgeServiceError) throw error
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
      throw new BadgeServiceError('NOT_FOUND', '勋章不存在')
    }
    throw error
  }
}

export const badgeAdminSelect = {
  ...BADGE_SELECT,
  category: true,
  musicTourId: true,
  isAutoGrant: true,
  createdAt: true,
  updatedAt: true,
  _count: { select: { UserBadge: true } },
} as const

export async function findBadgeForAdmin(badgeId: string) {
  return prisma.badge.findUnique({ where: { id: badgeId }, select: badgeAdminSelect })
}

export async function listBadgesForAdmin({ query, enabled, visibility, grantType }: { query?: string; enabled?: boolean; visibility?: string; grantType?: string } = {}) {
  const where: Prisma.BadgeWhereInput = {}
  const normalizedQuery = query?.trim()
  if (normalizedQuery) where.OR = [{ name: { contains: normalizedQuery } }, { code: { contains: normalizedQuery } }, { slug: { contains: normalizedQuery } }]
  if (typeof enabled === 'boolean') where.isEnabled = enabled
  if (visibility === 'PUBLIC' || visibility === 'HIDDEN' || visibility === 'SECRET') where.visibility = visibility
  if (grantType === 'AUTO' || grantType === 'MANUAL' || grantType === 'EVENT') where.grantType = grantType

  return prisma.badge.findMany({ where, orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }], select: badgeAdminSelect })
}

export async function listBadgeOwners(badgeId: string) {
  return prisma.userBadge.findMany({
    where: { badgeId },
    orderBy: [{ obtainedAt: 'desc' }, { id: 'desc' }],
    select: {
      id: true,
      obtainedAt: true,
      grantReason: true,
      sourceType: true,
      sourceId: true,
      User: { select: { id: true, uid: true, nickname: true, username: true, Profile: { select: { displayName: true } } } },
    },
  })
}

export async function findUsersForBadgeGrant(query: string) {
  const keyword = query.trim().slice(0, 80)
  if (!keyword) return []
  const uid = Number.parseInt(keyword, 10)
  return prisma.user.findMany({
    where: {
      status: 'ACTIVE',
      isDeleted: false,
      OR: [
        ...(Number.isInteger(uid) && uid > 0 ? [{ uid }] : []),
        { nickname: { contains: keyword } },
        { username: { contains: keyword } },
        { usernameNormalized: { contains: keyword.toLowerCase() } },
      ],
    },
    orderBy: [{ uid: 'asc' }],
    take: 20,
    select: { id: true, uid: true, nickname: true, username: true, Profile: { select: { displayName: true } } },
  })
}
