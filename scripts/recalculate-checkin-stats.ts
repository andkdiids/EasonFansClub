import { calculateCheckinStreaks, parseBeijingDate } from '../lib/checkin'
import { prisma } from '../lib/prisma'

const args = new Set(process.argv.slice(2))
const userIdIndex = process.argv.indexOf('--user-id')
const userId = userIdIndex >= 0 ? process.argv[userIdIndex + 1] : undefined
const all = args.has('--all')
const apply = args.has('--apply')

if (!all && !userId) throw new Error('请使用 --user-id <id> 或 --all 指定范围')

async function main() {
  const users = await prisma.user.findMany({
    where: userId ? { id: userId } : { isDeleted: false },
    select: { id: true, consecutiveDays: true, lastCheckInDate: true, checkIns: { select: { checkinDateKey: true }, orderBy: { checkinDateKey: 'asc' } } },
  })
  const changes = users.flatMap((user) => {
    const stats = calculateCheckinStreaks(user.checkIns.map((item) => item.checkinDateKey))
    const lastKey = user.checkIns.at(-1)?.checkinDateKey
    const lastCheckInDate = lastKey ? parseBeijingDate(lastKey) : null
    if (stats.currentStreak === user.consecutiveDays && lastCheckInDate?.getTime() === user.lastCheckInDate?.getTime()) return []
    return [{ userId: user.id, before: user.consecutiveDays, after: stats.currentStreak, longestStreak: stats.longestStreak, totalDays: stats.totalDays, lastCheckInDate }]
  })

  console.info(JSON.stringify({ mode: apply ? 'apply' : 'dry-run', usersScanned: users.length, usersChanged: changes.length, changes }, null, 2))
  if (!apply) return
  for (const change of changes) {
    await prisma.user.update({ where: { id: change.userId }, data: { consecutiveDays: change.after, lastCheckInDate: change.lastCheckInDate } })
  }
}

main().finally(() => prisma.$disconnect())
