import type { Prisma } from '@prisma/client'

export type UserOperationCategory =
  | 'ACCOUNT'
  | 'CHECKIN'
  | 'CONTENT'
  | 'SOCIAL'
  | 'GAME'
  | 'REWARD'
  | 'BADGE'
  | 'ACTIVITY'
  | 'RISK'
  | 'ADMIN'

export type UserOperationOperatorType = 'USER' | 'SYSTEM' | 'ADMIN'

export type UserOperationLogInput = {
  userId: string
  category: UserOperationCategory
  action: string
  summary: string
  metadata?: Prisma.InputJsonValue | null
  source: string
  operatorType: UserOperationOperatorType
  operatorUserId?: string | null
  targetType?: string | null
  targetId?: string | null
  riskLevel?: string | null
  occurredAt?: Date
}

/**
 * Write only durable audit facts that cannot be reconstructed from an
 * existing business table. Callers pass a Prisma transaction client so the
 * audit row commits or rolls back with the profile mutation.
 */
export async function writeUserOperationLog(
  tx: Prisma.TransactionClient,
  input: UserOperationLogInput,
) {
  return tx.userOperationLog.create({
    data: {
      userId: input.userId,
      category: input.category,
      action: input.action,
      summary: input.summary.slice(0, 500),
      metadata: input.metadata ?? undefined,
      source: input.source.slice(0, 32),
      operatorType: input.operatorType,
      operatorUserId: input.operatorUserId || null,
      targetType: input.targetType || null,
      targetId: input.targetId || null,
      riskLevel: input.riskLevel || null,
      occurredAt: input.occurredAt || new Date(),
    },
  })
}
