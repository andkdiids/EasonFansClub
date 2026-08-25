import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { logNotificationError } from '@/lib/notification-errors'

/**
 * Notification writes are secondary side effects. Keep their transactions
 * bounded so a slow summary/query path cannot leave a Prisma interactive
 * transaction open until the default five-second timeout.
 */
export const NOTIFICATION_TRANSACTION_OPTIONS = {
  timeout: 15_000,
  maxWait: 5_000,
} as const

export type NotificationOperationContext = {
  operation: string
  userId?: string | null
  notificationType?: string | null
}

function logNotificationTransaction(context: NotificationOperationContext, startedAt: number) {
  console.info('[notifications.transaction]', {
    operation: context.operation,
    durationMs: Date.now() - startedAt,
    userId: context.userId ?? null,
    notificationType: context.notificationType ?? null,
  })
}

/** Run a notification-only interactive transaction with explicit bounds. */
export async function runNotificationTransaction<T>(
  operation: (tx: Prisma.TransactionClient) => Promise<T>,
  context: NotificationOperationContext,
): Promise<T> {
  const startedAt = Date.now()
  try {
    return await prisma.$transaction(operation, NOTIFICATION_TRANSACTION_OPTIONS)
  } finally {
    logNotificationTransaction(context, startedAt)
  }
}

/**
 * Notification delivery must never turn a successful core operation into a
 * failed request. The caller gets null on a failed secondary write and the
 * failure is logged with enough context to diagnose it in production.
 */
export async function safeNotificationWrite<T>(
  operation: () => Promise<T>,
  context: NotificationOperationContext,
): Promise<T | null> {
  const startedAt = Date.now()
  try {
    return await operation()
  } catch (error) {
    logNotificationError('write', {
      operation: context.operation,
      durationMs: Date.now() - startedAt,
      userId: context.userId ?? null,
      notificationType: context.notificationType ?? null,
    }, error)
    return null
  } finally {
    console.info('[notifications.write]', {
      operation: context.operation,
      durationMs: Date.now() - startedAt,
      userId: context.userId ?? null,
      notificationType: context.notificationType ?? null,
    })
  }
}

/** Safe wrapper for maintenance/reconciliation notification transactions. */
export async function safeNotificationTransaction<T>(
  operation: (tx: Prisma.TransactionClient) => Promise<T>,
  context: NotificationOperationContext,
): Promise<T | null> {
  try {
    return await runNotificationTransaction(operation, context)
  } catch (error) {
    logNotificationError('transaction', {
      operation: context.operation,
      userId: context.userId ?? null,
      notificationType: context.notificationType ?? null,
    }, error)
    return null
  }
}
