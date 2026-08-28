import { Prisma } from '@prisma/client'
import { describeNotificationError } from '../lib/notification-errors'
import { prisma } from '../lib/prisma'

type EmptyTypeCountRow = {
  emptyTypeCount: bigint | number | string
}

/**
 * Read-only production smoke check for the historical MySQL enum failure.
 * This script deliberately never updates or deletes Notification rows.
 */
async function main() {
  try {
    const rows = await prisma.$queryRaw<EmptyTypeCountRow[]>(Prisma.sql`
      SELECT COUNT(*) AS emptyTypeCount
      FROM \`Notification\`
      WHERE CAST(\`type\` AS CHAR) = ''
    `)
    const rawCount = rows[0]?.emptyTypeCount ?? 0
    const emptyTypeCount = Number(rawCount)
    if (!Number.isSafeInteger(emptyTypeCount) || emptyTypeCount < 0) {
      throw new Error('Notification.type integrity check returned an invalid count')
    }
    if (emptyTypeCount > 0) {
      console.error(`[notifications.integrity] Notification.type contains ${emptyTypeCount} empty enum value(s)`)
      process.exitCode = 1
      return
    }
    console.info('[notifications.integrity] Notification.type empty-string count: 0')
  } finally {
    await prisma.$disconnect()
  }
}

void main().catch((error: unknown) => {
  console.error('[notifications.integrity] check failed', describeNotificationError(error))
  process.exitCode = 1
})
