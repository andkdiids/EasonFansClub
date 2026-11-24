import type { Prisma } from '@prisma/client'
import { getPublicUserDisplayName } from '@/lib/friend-display'

/**
 * One public projection of a Shun participant.
 *
 * It lives in its own module so the letter reader can reuse the exact same
 * identity rules as the record list without importing the whole Shun service
 * (which would create an import cycle: the service already imports the letter
 * module for notification copy).
 */

export const shunPersonFields = {
  uid: true, nickname: true, avatarUrl: true, nicknameModerationStatus: true, nicknameViolationDisplay: true,
} as const

export type ShunPerson = {
  uid: number
  nickname: string
  avatarUrl: string | null
}

/** Public face of one account: hidden when the account is gone or inactive. */
export async function shunPerson(tx: Prisma.TransactionClient, id: string): Promise<ShunPerson | null> {
  const user = await tx.user.findFirst({ where: { id, isDeleted: false, status: 'ACTIVE' }, select: shunPersonFields })
  return user && { uid: user.uid, nickname: getPublicUserDisplayName(user), avatarUrl: user.avatarUrl }
}
