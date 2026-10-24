import type { Prisma } from '@prisma/client'

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

export type PasswordChangeStage =
  | 'PASSWORD_UPDATE'
  | 'RECOVERY_CREDENTIAL_REVOCATION'
  | 'WEB_SESSION_REVOCATION'
  | 'MOBILE_SESSION_REVOCATION'
  | 'ACCOUNT_SECURITY_AUDIT'

export async function commitPasswordChange(
  tx: PasswordSecurityTransaction,
  input: PasswordChangeAuditInput & { onStage?: (stage: PasswordChangeStage) => void },
) {
  const now = input.now || new Date()
  input.onStage?.('PASSWORD_UPDATE')
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
  input.onStage?.('RECOVERY_CREDENTIAL_REVOCATION')
  await tx.passwordResetToken.updateMany({
    where: { userId: input.userId, consumedAt: null },
    data: { consumedAt: now },
  })
  input.onStage?.('WEB_SESSION_REVOCATION')
  await tx.onlineSession.deleteMany({ where: { userId: input.userId } })
  input.onStage?.('MOBILE_SESSION_REVOCATION')
  await tx.mobileAuthSession.updateMany({
    where: { userId: input.userId, revokedAt: null },
    data: { revokedAt: now },
  })
  input.onStage?.('ACCOUNT_SECURITY_AUDIT')
  await tx.accountSecurityLog.create({
    data: {
      userId: input.userId,
      action: input.action,
      ipAddress: input.ipAddress,
      userAgent: input.userAgent,
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
