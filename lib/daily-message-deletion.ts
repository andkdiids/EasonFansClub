import { Prisma } from '@prisma/client'
import { invalidateCheckInMessagesCache } from '@/lib/checkin-messages'
import { invalidateHomeDataCache } from '@/lib/home-data'
import { prisma } from '@/lib/prisma'

// DailyMessage uses Prisma cuid() values. Keep the validation deliberately
// compatible with existing persisted IDs while rejecting whitespace, slashes,
// control characters, and oversized path segments before querying Prisma.
export const DAILY_MESSAGE_ID_PATTERN = /^[A-Za-z0-9_-]{1,191}$/

export function isValidDailyMessageId(value: unknown): value is string {
  return typeof value === 'string' && DAILY_MESSAGE_ID_PATTERN.test(value)
}

type DailyMessageDeletionSource = {
  id: string
  userId: string
  checkInId: string | null
  content: string
}

/**
 * Keep the denormalized CheckIn.message and FriendActivity.content projection
 * in sync with the soft-deleted DailyMessage. The CheckIn row itself is never
 * deleted, so dates, streaks, rewards, and makeup records remain untouched.
 */
export async function syncDailyMessageDeletionEffects(
  tx: Prisma.TransactionClient,
  message: DailyMessageDeletionSource,
  isDeleted: boolean,
) {
  if (message.checkInId) {
    await tx.checkIn.updateMany({
      where: { id: message.checkInId, userId: message.userId },
      data: { message: isDeleted ? null : message.content },
    })
  }

  await tx.friendActivity.updateMany({
    where: { dailyMessageId: message.id },
    data: { content: isDeleted ? null : message.content },
  })
}

export async function deleteDailyMessageForOwner(messageId: string, userId: string) {
  const result = await prisma.$transaction(async (tx) => {
    const existing = await tx.dailyMessage.findUnique({
      where: { id: messageId },
      // Ownership is checked from the database row, never from client input.
      select: { id: true, userId: true, isDeleted: true, deletedAt: true, checkInId: true, content: true },
    })

    if (!existing) {
      return { status: 404 as const, message: '挂号留言不存在' }
    }
    if (existing.userId !== userId) {
      return { status: 403 as const, message: '只能删除自己的挂号留言' }
    }

    // updateMany makes a repeated/concurrent request harmless even if another
    // request has already changed the row between findUnique and the update.
    await tx.dailyMessage.updateMany({
      where: { id: messageId, userId },
      data: { isDeleted: true, deletedAt: existing.deletedAt || new Date() },
    })
    await syncDailyMessageDeletionEffects(tx, existing, true)

    return {
      status: 200 as const,
      message: '留言已删除',
      alreadyDeleted: existing.isDeleted,
    }
  })

  if (result.status === 200) {
    invalidateCheckInMessagesCache()
    invalidateHomeDataCache()
  }

  return result
}
