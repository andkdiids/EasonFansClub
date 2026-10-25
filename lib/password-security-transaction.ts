import type { Prisma } from '@prisma/client'
import { normalizeStoredUserAgent } from './request-metadata'

type PasswordSecurityTransaction = Pick<
  Prisma.TransactionClient,
  'user' | 'passwordResetToken' | 'onlineSession' | 'mobileAuthSession' | 'accountSecurityLog'
>

export class PasswordChangeConflictError extends Error {
  constructor() {
    super('Password state changed during the operation')
    this.name = 'PasswordChangeConflictError'
  }
}

export type PasswordChangeAuditInput = {
  userId: string
  passwordHash: string
  action: string
  method: string
  ipAddress: string
  userAgent: string | null
  now?: Date
  expectedPasswordHash?: string
  mustSetupSecurity?: boolean
}

export async function commitPasswordChange(
  tx: PasswordSecurityTransaction,
  input: PasswordChangeAuditInput,
) {
  const now = input.now || new Date()
  const updated = await tx.user.updateMany({
    where: {
      id: input.userId,
      ...(input.expectedPasswordHash !== undefined ? { passwordHash: input.expectedPasswordHash } : {}),
    },
    data: {
      passwordHash: input.passwordHash,
      ...(input.mustSetupSecurity !== undefined ? { mustSetupSecurity: input.mustSetupSecurity } : {}),
    },
  })
  if (updated.count !== 1) throw new PasswordChangeConflictError()

  // Password changes invalidate outstanding recovery credentials and every
  // persisted session in the same transaction as the password/audit update.
  await tx.passwordResetToken.updateMany({
    where: { userId: input.userId, consumedAt: null },
    data: { consumedAt: now },
  })
  await tx.onlineSession.deleteMany({ where: { userId: input.userId } })
  await tx.mobileAuthSession.updateMany({
    where: { userId: input.userId, revokedAt: null },
    data: { revokedAt: now },
  })
  await tx.accountSecurityLog.create({
    data: {
      userId: input.userId,
      action: input.action,
      ipAddress: input.ipAddress,
      userAgent: normalizeStoredUserAgent(input.userAgent),
      metadata: { method: input.method },
      createdAt: now,
    },
  })
}

export async function consumeResetTokenAndChangePassword(
  tx: PasswordSecurityTransaction,
  input: Omit<PasswordChangeAuditInput, 'expectedPasswordHash'> & {
    resetTokenId: string
    resetTokenType: 'SECURITY_QUESTION' | 'EMAIL' | 'EMAIL_LINK'
    expectedPasswordHash: string
  },
) {
  const now = input.now || new Date()
  const claimed = await tx.passwordResetToken.updateMany({
    where: {
      id: input.resetTokenId,
      userId: input.userId,
      type: input.resetTokenType,
      stage: 'RESET_TOKEN',
      consumedAt: null,
      expiresAt: { gt: now },
    },
    data: { consumedAt: now },
  })
  if (claimed.count !== 1) return false

  await commitPasswordChange(tx, { ...input, now })
  return true
}
