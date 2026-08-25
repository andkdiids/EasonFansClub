import { parseBeijingDate } from '../lib/checkin'
import { reconcileCheckInDerivedState } from '../lib/checkin-derived-reconcile'
import { prisma } from '../lib/prisma'

const dateKeyIndex = process.argv.indexOf('--date-key')
const dateKey = dateKeyIndex >= 0 ? process.argv[dateKeyIndex + 1] : undefined
const userIdIndex = process.argv.indexOf('--user-id')
const userId = userIdIndex >= 0 ? process.argv[userIdIndex + 1] : undefined
const limitIndex = process.argv.indexOf('--limit')
const limit = Math.min(10_000, Math.max(1, Number(limitIndex >= 0 ? process.argv[limitIndex + 1] : 500)))
const apply = process.argv.includes('--apply')

if (!dateKey || !parseBeijingDate(dateKey)) throw new Error('请提供有效的 --date-key YYYY-MM-DD')
const validatedDateKey = dateKey

async function main() {
const users = userId
    ? [{ userId: userId as string }]
    : await prisma.checkIn.findMany({
        where: { checkinDateKey: validatedDateKey },
        select: { userId: true },
        distinct: ['userId'],
        take: limit,
      })
  const results = []
  for (const item of users) {
    results.push(await reconcileCheckInDerivedState({ userId: item.userId, dateKey: validatedDateKey, apply }))
  }
  console.info(JSON.stringify({
    event: 'checkin.derived_reconcile',
    mode: apply ? 'apply' : 'dry-run',
    dateKey: validatedDateKey,
    userId: userId || undefined,
    usersScanned: users.length,
    results,
  }, null, 2))
}

main().finally(() => prisma.$disconnect())
