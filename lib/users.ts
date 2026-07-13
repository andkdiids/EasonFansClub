import type { Prisma, User } from '@prisma/client'
import { prisma } from '@/lib/prisma'

export const inactiveUserStatuses = ['BANNED', 'DELETED', 'MERGED', 'DISABLED'] as const

export function publicUserSelect() {
  return {
    id: true,
    uid: true,
    username: true,
    nickname: true,
    avatarUrl: true,
    backgroundUrl: true,
    bio: true,
    role: true,
    status: true,
    level: true,
    exp: true,
    points: true,
    createdAt: true,
    profile: true,
  } satisfies Prisma.UserSelect
}

export function ownerPrivateUserSelect() {
  return {
    email: true,
    phone: true,
  } satisfies Prisma.UserSelect
}

export function isCompleteActiveUser(
  user: Pick<User, 'uid' | 'status' | 'isDeleted'> & { profile?: unknown | null },
) {
  return Boolean(user.uid && user.status === 'ACTIVE' && !user.isDeleted && user.profile)
}

export async function findCompleteActiveUserByIdentifier(identifier: string) {
  const normalized = identifier.trim()
  const lower = normalized.toLowerCase()

  const user = await prisma.user.findFirst({
    where: {
      status: 'ACTIVE',
      isDeleted: false,
      OR: [{ phone: normalized }, { email: lower }, { username: normalized }],
    },
    select: {
      id: true,
      uid: true,
      username: true,
      nickname: true,
      role: true,
      status: true,
      isDeleted: true,
      passwordHash: true,
      profile: { select: { id: true } },
    },
  })

  if (!user || !isCompleteActiveUser(user)) return null
  return user
}

export async function findCompleteUserByLoginIdentifier(identifierType: 'phone' | 'email', identifier: string) {
  const normalized = identifier.trim()
  const lookup = identifierType === 'email' ? normalized.toLowerCase() : normalized

  const user = await prisma.user.findFirst({
    where: {
      isDeleted: false,
      ...(identifierType === 'email' ? { email: lookup } : { phone: lookup }),
    },
    select: {
      id: true,
      uid: true,
      username: true,
      nickname: true,
      role: true,
      status: true,
      isDeleted: true,
      passwordHash: true,
      email: true,
      phone: true,
      emailVerifiedAt: true,
      profile: { select: { id: true } },
    },
  })

  if (!user || !user.profile || !user.uid || user.isDeleted) return null
  return user
}

export async function findActiveConflict(input: { phone?: string | null; email?: string | null; username?: string | null }) {
  return prisma.user.findFirst({
    where: {
      status: 'ACTIVE',
      isDeleted: false,
      OR: [
        ...(input.phone ? [{ phone: input.phone }] : []),
        ...(input.email ? [{ email: input.email.toLowerCase() }] : []),
        ...(input.username ? [{ username: input.username }] : []),
      ],
    },
    select: { id: true, phone: true, email: true, username: true },
  })
}
