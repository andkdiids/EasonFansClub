import type { NotificationType, Prisma, PrismaClient } from '@prisma/client'
import { prisma } from '@/lib/prisma'

/** The only Notification.type values that application code may persist. */
export const NOTIFICATION_TYPE_VALUES = [
  'REPLY',
  'LIKE',
  'SYSTEM',
  'MESSAGE',
  'ACTIVITY',
  'ADMIN',
  'FOLLOW',
  'BADGE',
  'FRIEND_REQUEST',
  'BIRTHDAY_GREETING',
] as const satisfies readonly NotificationType[]

export type ValidNotificationType = typeof NOTIFICATION_TYPE_VALUES[number]

export type NotificationWriteContext = {
  operation: string
  userId?: string | null
  /** Only activity-class callers may convert an unknown type to ACTIVITY. */
  activityFallback?: boolean
}

type NotificationDb = PrismaClient | Prisma.TransactionClient

export class InvalidNotificationTypeError extends Error {
  readonly code = 'INVALID_NOTIFICATION_TYPE'
  readonly receivedType: unknown

  constructor(receivedType: unknown, operation: string) {
    super(`Invalid Notification.type for ${operation}`)
    this.name = 'InvalidNotificationTypeError'
    this.receivedType = receivedType
  }
}

function typeGuardLog(context: NotificationWriteContext, receivedType: unknown, fallbackType: ValidNotificationType | null) {
  return {
    code: 'INVALID_NOTIFICATION_TYPE',
    operation: context.operation,
    userId: context.userId ?? null,
    receivedType: typeof receivedType === 'string' ? receivedType : String(receivedType ?? ''),
    fallbackType,
  }
}

/**
 * Validate the value before Prisma sees it. Invalid activity-class values may
 * be safely represented as ACTIVITY; all other invalid values are rejected.
 */
export function normalizeNotificationType(value: unknown, context: NotificationWriteContext): ValidNotificationType {
  const candidate = typeof value === 'string' ? value.trim().toUpperCase() : ''
  if ((NOTIFICATION_TYPE_VALUES as readonly string[]).includes(candidate)) return candidate as ValidNotificationType

  const details = typeGuardLog(context, value, context.activityFallback ? 'ACTIVITY' : null)
  console.error('[notifications.type-guard]', details)
  if (context.activityFallback) return 'ACTIVITY'
  throw new InvalidNotificationTypeError(value, context.operation)
}

function normalizeCreateData(
  data: Prisma.NotificationCreateArgs['data'],
  context: NotificationWriteContext,
) {
  return {
    ...data,
    type: normalizeNotificationType(data.type, context),
  } as Prisma.NotificationCreateArgs['data']
}

function normalizeUpdateData(
  data: Prisma.NotificationUpsertArgs['update'],
  context: NotificationWriteContext,
) {
  if (!data || typeof data !== 'object' || !('type' in data) || data.type === undefined) return data

  const rawType = data.type
  const type = rawType && typeof rawType === 'object' && 'set' in rawType
    ? { ...rawType, set: normalizeNotificationType(rawType.set, context) }
    : normalizeNotificationType(rawType, context)
  return { ...data, type } as Prisma.NotificationUpsertArgs['update']
}

export function createNotification(
  args: Prisma.NotificationCreateArgs,
  context: NotificationWriteContext = { operation: 'notification.create' },
) {
  return createNotificationWithDb(prisma, args, context)
}

export function createNotificationWithDb(
  db: NotificationDb,
  args: Prisma.NotificationCreateArgs,
  context: NotificationWriteContext = { operation: 'notification.create' },
) {
  return db.notification.create({
    ...args,
    data: normalizeCreateData(args.data, context),
  })
}

export function createManyNotifications(
  args: Prisma.NotificationCreateManyArgs,
  context: NotificationWriteContext = { operation: 'notification.createMany' },
) {
  return createManyNotificationsWithDb(prisma, args, context)
}

export function createManyNotificationsWithDb(
  db: NotificationDb,
  args: Prisma.NotificationCreateManyArgs,
  context: NotificationWriteContext = { operation: 'notification.createMany' },
) {
  const items: Prisma.NotificationCreateManyInput[] = Array.isArray(args.data) ? args.data : [args.data]
  return db.notification.createMany({
    ...args,
    data: items.map((item) => ({
      ...item,
      type: normalizeNotificationType(item.type, context),
    })),
  })
}

export function upsertNotification(
  args: Prisma.NotificationUpsertArgs,
  context: NotificationWriteContext = { operation: 'notification.upsert' },
) {
  return upsertNotificationWithDb(prisma, args, context)
}

export function upsertNotificationWithDb(
  db: NotificationDb,
  args: Prisma.NotificationUpsertArgs,
  context: NotificationWriteContext = { operation: 'notification.upsert' },
) {
  return db.notification.upsert({
    ...args,
    create: normalizeCreateData(args.create, context),
    update: normalizeUpdateData(args.update, context),
  })
}
