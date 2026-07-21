/* 临时只读脚本:核对 uid=9 账号的签到数据 */
import { prisma } from '../lib/prisma'
import { calculateCheckinStreaks } from '../lib/checkin'

async function main() {
  const user = await prisma.user.findFirst({
    where: { uid: 9 },
    select: { id: true, uid: true, username: true, nickname: true, consecutiveDays: true },
  })
  if (!user) {
    console.log('uid=9 用户不存在')
    return
  }
  console.log(`UID: ${user.uid}`)
  console.log(`username: ${user.username}`)
  console.log(`nickname: ${user.nickname}`)
  console.log(`consecutiveDays(快照): ${user.consecutiveDays}`)

  const rows = await prisma.checkIn.findMany({
    where: { userId: user.id },
    orderBy: { checkinDateKey: 'asc' },
    select: { checkinDateKey: true, streakDay: true, isMakeUp: true, createdAt: true },
  })
  const keys = rows.map((r) => r.checkinDateKey)
  console.log(`checkinDateKey 全部(${keys.length} 条): ${keys.join(', ')}`)

  const streaks = calculateCheckinStreaks(keys)
  console.log(`calculateCheckinStreaks: currentStreak=${streaks.currentStreak} longestStreak=${streaks.longestStreak} totalDays=${streaks.totalDays}`)
  console.log(`max(streakDay): ${rows.length ? Math.max(...rows.map((r) => r.streakDay)) : '无记录'}`)
  console.log('明细 (key | streakDay | isMakeUp | createdAt):')
  for (const r of rows) {
    console.log(`  ${r.checkinDateKey} | ${r.streakDay} | ${r.isMakeUp} | ${r.createdAt.toISOString()}`)
  }
}

main().finally(() => prisma.$disconnect())
