import { loadEnvFile } from 'node:process'

if (!process.env.DATABASE_URL) loadEnvFile('.env')

import { prisma } from '../lib/prisma'

const uidIndex = process.argv.indexOf('--uid')
const idIndex = process.argv.indexOf('--user-id')
const uidValue = uidIndex >= 0 ? Number(process.argv[uidIndex + 1]) : Number.NaN
const idValue = idIndex >= 0 ? process.argv[idIndex + 1] : ''

if (!Number.isSafeInteger(uidValue) && !idValue) {
  throw new Error('只读审计用法：pnpm checkin:makeup-audit --uid <uid> 或 --user-id <id>')
}

async function main() {
  const user = await prisma.user.findFirst({
    where: Number.isSafeInteger(uidValue) ? { uid: uidValue } : { id: idValue },
    select: {
      id: true,
      uid: true,
      username: true,
      nickname: true,
      CheckIn: {
        orderBy: { checkinDateKey: 'asc' },
        select: { id: true, checkinDateKey: true, type: true, streakDay: true, madeUpAt: true, createdAt: true },
      },
      PointLog: {
        where: { action: 'CONTINUOUS_CHECK_IN_BONUS' },
        orderBy: { createdAt: 'asc' },
        select: { id: true, points: true, before: true, after: true, reason: true, checkInId: true, businessKey: true, createdAt: true },
      },
    },
  })
  if (!user) throw new Error('用户不存在')

  const checkInById = new Map(user.CheckIn.map((row) => [row.id, row]))
  const makeup = user.CheckIn.filter((row) => row.type !== 'NORMAL')
  const rewardsByCheckIn = new Map<string, typeof user.PointLog>()
  for (const reward of user.PointLog) {
    if (!reward.checkInId) continue
    const rows = rewardsByCheckIn.get(reward.checkInId) || []
    rows.push(reward)
    rewardsByCheckIn.set(reward.checkInId, rows)
  }

  const makeupAudit = makeup.map((record) => {
    const rewards = rewardsByCheckIn.get(record.id) || []
    return {
      checkInId: record.id,
      dateKey: record.checkinDateKey,
      type: record.type,
      madeUpAt: record.madeUpAt?.toISOString() || null,
      finalStreakDay: record.streakDay,
      expectedRewardCountAfterFix: record.streakDay >= 7 ? 1 : 0,
      actualRewardCount: rewards.length,
      actualRewardAmount: rewards.reduce((sum, reward) => sum + reward.points, 0),
      rewards: rewards.map((reward) => ({
        id: reward.id,
        points: reward.points,
        reason: reward.reason,
        businessKey: reward.businessKey,
        createdAt: reward.createdAt.toISOString(),
      })),
      classification: rewards.length <= (record.streakDay >= 7 ? 1 : 0) ? '合法或未多发' : '疑似重复',
    }
  })

  const makeupTimes = makeup.map((record) => record.madeUpAt || record.createdAt).sort((left, right) => left.getTime() - right.getTime())
  const earliestMakeupAt = makeupTimes[0]
  const suspectedHistoricalReplay = earliestMakeupAt
    ? user.PointLog
      .filter((reward) => reward.createdAt >= earliestMakeupAt && reward.checkInId && checkInById.get(reward.checkInId)?.type === 'NORMAL')
      .map((reward) => {
        const checkIn = checkInById.get(reward.checkInId!)!
        return {
          pointLogId: reward.id,
          checkInId: checkIn.id,
          dateKey: checkIn.checkinDateKey,
          points: reward.points,
          businessKey: reward.businessKey,
          rewardCreatedAt: reward.createdAt.toISOString(),
          earliestMakeupAt: earliestMakeupAt.toISOString(),
          classification: '疑似补签重算时回放历史连续奖励，需结合操作时间人工确认',
        }
      })
    : []

  const output = {
    mode: 'dry-run',
    readOnly: true,
    user: { id: user.id, uid: user.uid, username: user.username, nickname: user.nickname },
    makeupCount: makeup.length,
    makeup: makeupAudit,
    continuousRewardLogCount: user.PointLog.length,
    continuousRewardTotal: user.PointLog.reduce((sum, reward) => sum + reward.points, 0),
    suspectedHistoricalReplay,
    note: '本脚本只读，不删除流水、不扣余额、不修改签到、不追回奖励。expectedRewardCountAfterFix 按现有“第7天起每日+7”规则，仅针对补签新创建记录计算。',
  }
  console.info(JSON.stringify(output, null, 2))
}

main()
  .catch((error) => {
    console.error('补签奖励审计失败:', error)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
