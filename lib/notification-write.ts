import { NotificationType, type Prisma, type PrismaClient } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { logNotificationError } from '@/lib/notification-errors'
import { queueMobilePushForNotificationData } from '@/lib/mobile-push'

/** The only Notification.type values that application code may persist. */
export const NOTIFICATION_TYPE_VALUES = [
  NotificationType.REPLY,
  NotificationType.LIKE,
  NotificationType.SYSTEM,
  NotificationType.MESSAGE,
  NotificationType.ACTIVITY,
  NotificationType.ADMIN,
  NotificationType.FOLLOW,
  NotificationType.BADGE,
  NotificationType.FRIEND_REQUEST,
  NotificationType.BIRTHDAY_GREETING,
  NotificationType.FEEDBACK,
  NotificationType.REVIEW,
  NotificationType.PROFILE_BACKGROUND_LIKE,
] as const satisfies readonly NotificationType[]

export type ValidNotificationType = typeof NOTIFICATION_TYPE_VALUES[number]

export type NotificationWriteContext = {
  operation: string
  userId?: string | null
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

function describeReceivedType(receivedType: unknown) {
  if (typeof receivedType === 'string') return receivedType
  if (receivedType === null) return 'null'
  if (receivedType === undefined) return 'undefined'
  return typeof receivedType
}

/**
 * Validate the value before Prisma sees it. Do not normalize arbitrary input
 * or silently fall back: a value not present in the generated enum is a write
 * error and must be fixed at its caller.
 */
export function normalizeNotificationType(value: unknown, context: NotificationWriteContext): ValidNotificationType {
  const matched = typeof value === 'string'
    ? NOTIFICATION_TYPE_VALUES.find((type) => type === value)
    : undefined
  if (matched) return matched

  const error = new InvalidNotificationTypeError(value, context.operation)
  logNotificationError('write.invalid-type', {
    operation: context.operation,
    userId: context.userId ?? null,
    receivedType: describeReceivedType(value),
  }, error)
  throw error
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
  // Keep type validation synchronous: existing callers rely on an immediate
  // InvalidNotificationTypeError, not a rejected promise.
  const data = normalizeCreateData(args.data, context)
  // Push delivery joins the notification's own transaction; dedupe happens on
  // the notification key, so retries can never double queue.
  return queueMobilePushForNotificationData(db, data)
    .then(() => db.notification.create({ ...args, data }))
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
  const normalized = items.map((item) => ({
    ...item,
    type: normalizeNotificationType(item.type, context),
  }))
  // createMany cannot return generated ids, so only key-carrying pushes queue.
  return Promise.all(normalized.map((item) => queueMobilePushForNotificationData(db, item, { requireKey: true })))
    .then(() => db.notification.createMany({
      ...args,
      data: normalized,
    }))
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
  const createData = normalizeCreateData(args.create, context)
  const updateData = normalizeUpdateData(args.update, context)
  // Only the create branch may enqueue: the update branch refreshes aggregate
  // state and would otherwise re-notify for an existing notification. The
  // key-based dedupe makes the queued row idempotent either way.
  return queueMobilePushForNotificationData(db, createData, { requireKey: true })
    .then(() => db.notification.upsert({
      ...args,
      create: createData,
      update: updateData,
    }))
}
