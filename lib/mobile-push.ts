import { NotificationType, Prisma, type PrismaClient } from '@prisma/client'
import { randomUUID } from 'node:crypto'
import { logNotificationError } from '@/lib/notification-errors'

/**
 * Push is an additional delivery channel on top of the in-app notification
 * system, never a second notification business. Delivery rows are created
 * through the same db handle (and transaction) as the notification or message
 * they belong to, and are drained asynchronously by the guarded dispatch
 * worker in `lib/mobile-push-sender.ts`.
 */

export const MOBILE_PUSH_TYPES = new Set<string>([
  NotificationType.FRIEND_REQUEST,
  NotificationType.BADGE,
  NotificationType.SYSTEM,
])

/** 顺大师 pushes ride on the SYSTEM type with a namespaced key. */
export const MOBILE_PUSH_SYSTEM_KEY_PREFIX = 'shun:'

export function shouldPushNotification(notification: { type: string; key?: unknown }): boolean {
  if (!MOBILE_PUSH_TYPES.has(notification.type)) return false
  if (notification.type === NotificationType.SYSTEM) {
    return typeof notification.key === 'string' && notification.key.startsWith(MOBILE_PUSH_SYSTEM_KEY_PREFIX)
  }
  return true
}

function clamp(value: string, max: number, fallback: string): string {
  const trimmed = value.trim()
  if (!trimmed) return fallback
  return trimmed.length <= max ? trimmed : `${trimmed.slice(0, max - 1)}…`
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

export type MobilePushDeliveryDb = PrismaClient | Prisma.TransactionClient

export type RawNotificationWriteData = {
  type: string
  recipientId?: unknown
  title?: unknown
  content?: unknown
  link?: unknown
  key?: unknown
}

function buildDeliveryInput(dedupeKey: string, data: RawNotificationWriteData): Prisma.MobilePushDeliveryCreateInput {
  const title = clamp(text(data.title), 120, '私家E院通知')
  const body = data.type === NotificationType.SYSTEM
    ? // Anonymous letters and capture replies stay generic on the lock screen:
      // the payload only carries routing markers, never the letter content.
      clamp(text(data.title), 160, '你有新的通知')
    : clamp(text(data.content), 160, title || '你有新的通知')
  return {
    dedupeKey,
    userId: String(data.recipientId),
    title,
    body,
    payload: {
      type: data.type,
      ...(typeof data.key === 'string' ? { key: data.key } : {}),
      ...(typeof data.link === 'string' && data.link.startsWith('/') ? { link: data.link } : {}),
    },
  }
}

/**
 * Queues the push delivery row for notification data that is about to be (or
 * has just been) persisted through the same db handle. Deduplicates on the
 * notification key so transaction retries or aggregate upserts never double
 * queue. Push failures are logged, never thrown: they must not disturb the
 * business transaction.
 */
export async function queueMobilePushForNotificationData(
  db: MobilePushDeliveryDb,
  data: RawNotificationWriteData,
  options: { requireKey?: boolean } = {},
): Promise<void> {
  const recipientId = typeof data.recipientId === 'string' && data.recipientId ? data.recipientId : null
  if (!recipientId) return
  if (!shouldPushNotification(data)) return
  if (options.requireKey && typeof data.key !== 'string') return
  const dedupeKey = `notif:${typeof data.key === 'string' ? data.key : randomUUID()}`
  try {
    await db.mobilePushDelivery.create({ data: buildDeliveryInput(dedupeKey, { ...data, recipientId }) })
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') return
    logNotificationError('push.queue-failed', {
      operation: 'mobile-push.queue',
      userId: recipientId,
      notificationType: data.type,
    }, error instanceof Error ? error : new Error(String(error)))
  }
}

/** Text or sticker direct message push. The body never contains the message. */
export async function queueDirectMessagePush(
  db: MobilePushDeliveryDb,
  input: { userId: string; messageId: string; conversationId: string },
): Promise<void> {
  try {
    await db.mobilePushDelivery.create({
      data: {
        dedupeKey: `dm:${input.messageId}`,
        userId: input.userId,
        title: '你收到一条新私信',
        body: '打开私家E院查看新私信',
        payload: { type: NotificationType.MESSAGE, link: `/messages/${input.conversationId}` },
      },
    })
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') return
    logNotificationError('push.queue-failed', {
      operation: 'mobile-push.queue-dm',
      userId: input.userId,
      messageId: input.messageId,
    }, error instanceof Error ? error : new Error(String(error)))
  }
}
