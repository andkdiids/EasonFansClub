import type { Prisma, User } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { getPhoneLookupVariants, type PhoneCountryCode } from '@/lib/phone-number'

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
    nicknameModerationStatus: true,
    nicknameViolationDisplay: true,
    Profile: true,
  } satisfies Prisma.UserSelect
}

export function ownerPrivateUserSelect() {
  return {
    email: true,
    phone: true,
  } satisfies Prisma.UserSelect
}

export function isCompleteActiveUser(
  user: Pick<User, 'uid' | 'status' | 'isDeleted'> & { Profile?: unknown | null },
) {
  return Boolean(user.uid && user.status === 'ACTIVE' && !user.isDeleted && user.Profile)
}

export async function findCompleteActiveUserByIdentifier(identifier: string) {
  const normalized = identifier.trim()
  const lower = normalized.toLowerCase()
  const phoneVariants = getPhoneLookupVariants(normalized)

  const user = await prisma.user.findFirst({
    where: {
      status: 'ACTIVE',
      isDeleted: false,
      OR: [...phoneVariants.map((phone) => ({ phone })), { email: lower }],
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
      Profile: { select: { id: true } },
    },
  })

  if (!user || !isCompleteActiveUser(user)) return null
  return user
}

export async function findCompleteUserByLoginIdentifier(identifierType: 'phone' | 'email', identifier: string, phoneCountry: PhoneCountryCode = 'CN') {
  const normalized = identifier.trim()
  const lookup = identifierType === 'email' ? normalized.toLowerCase() : normalized
  const phoneVariants = identifierType === 'phone' ? getPhoneLookupVariants(identifier, phoneCountry) : []

  const user = await prisma.user.findFirst({
    where: {
      isDeleted: false,
      ...(identifierType === 'email' ? { email: lookup } : { phone: { in: phoneVariants.length ? phoneVariants : [lookup] } }),
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
      usernameModerationStatus: true,
      nicknameModerationStatus: true,

      nicknameViolationDisplay: true,
      Profile: { select: { id: true, displayName: true, displayNameModerationStatus: true } },
    },
  })

  if (!user || !user.Profile || !user.uid || user.isDeleted) return null
  return user
}

export async function findActiveConflict(input: { phone?: string | null; email?: string | null }) {
  const phoneVariants = input.phone ? getPhoneLookupVariants(input.phone) : []
  return prisma.user.findFirst({
    where: {
      status: 'ACTIVE',
      isDeleted: false,
      OR: [
        ...phoneVariants.map((phone) => ({ phone })),
        ...(input.email ? [{ email: input.email.toLowerCase() }] : []),
      ],
    },
    select: { id: true, phone: true, email: true, username: true },
  })
}

export async function findLoginAccountConflict(usernameNormalized: string) {
  if (!usernameNormalized) return null
  return prisma.user.findUnique({
    where: { usernameNormalized },
    select: { id: true },
  })
}
