import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'
import {
  ACTIVITY_LOTTERY_ALGORITHM_VERSION,
  calculateLotteryWinRate,
  normalizeActivityLotteryInput,
  secureShuffle,
  validateLotterySchedule,
} from '@/lib/activity-lottery'

const root = process.cwd()
const read = (file: string) => readFileSync(join(root, file), 'utf8')

test('抽奖开奖时间必须不早于活动报名结束时间，并且没有报名截止时间不能创建', () => {
  const registrationEndAt = new Date('2026-09-13T10:00:00.000Z')
  assert.equal(validateLotterySchedule(registrationEndAt, new Date('2026-09-13T12:00:00.000Z')), null)
  assert.match(validateLotterySchedule(registrationEndAt, new Date('2026-09-13T09:59:59.000Z')) || '', /不能早于活动报名结束/)
  assert.match(validateLotterySchedule(null, new Date('2026-09-13T12:00:00.000Z')) || '', /先设置活动报名结束时间/)
})

test('抽奖输入支持多个奖项、图片、说明和数量校验', () => {
  const normalized = normalizeActivityLotteryInput({
    title: '滨海歌友之夜抽奖',
    description: '现场抽奖说明',
    drawAt: '2026-09-13T20:00',
    prizes: [
      { tierName: '一等奖', name: '周边礼包', imageUrl: 'https://media.ecfc.fans/prize.png', description: '限定礼盒', quantity: 2 },
      { tierName: '二等奖', name: '徽章', quantity: 8 },
    ],
  })
  assert.equal(normalized.valid, true)
  if (!normalized.valid) return
  assert.equal(normalized.value.prizes.length, 2)
  assert.equal(normalized.value.prizes[0]?.quantity, 2)
  assert.equal(normalized.value.prizes[0]?.imageUrl, 'https://media.ecfc.fans/prize.png')
  assert.equal(normalized.value.prizes[0]?.description, '限定礼盒')
  assert.equal(normalizeActivityLotteryInput({ title: '无效', drawAt: '2026-09-13T20:00', prizes: [{ tierName: '一等奖', name: '奖品', quantity: 0 }] }).valid, false)
})

test('中奖率按当前有效报名计算并且最高为 100%', () => {
  assert.equal(calculateLotteryWinRate(40, 270), (40 / 270) * 100)
  assert.equal(calculateLotteryWinRate(40, 200), 20)
  assert.equal(calculateLotteryWinRate(40, 30), 100)
  assert.equal(calculateLotteryWinRate(0, 30), 0)
})

test('开奖使用安全随机 Fisher-Yates，不使用 Math.random', () => {
  const shuffled = secureShuffle(['a', 'b', 'c'], () => 0)
  assert.deepEqual(shuffled, ['b', 'c', 'a'])
  assert.deepEqual([...shuffled].sort(), ['a', 'b', 'c'])
  assert.doesNotMatch(read('lib/activity-lottery.ts'), /Math\.random\s*\(/)
  assert.match(read('lib/activity-lottery.ts'), new RegExp(ACTIVITY_LOTTERY_ALGORITHM_VERSION))
})

test('抽奖模型允许一个活动多个抽奖，但同一抽奖一人最多中奖一次', () => {
  const schema = read('prisma/schema.prisma')
  assert.match(schema, /model Activity[\s\S]*?Lottery\s+Lottery\[\]/)
  assert.match(schema, /model LotteryEntry[\s\S]*?@@unique\(\[lotteryId, userId\]\)/)
  assert.doesNotMatch(schema, /model LotteryParticipant/)
})

test('抽奖资格在开奖时直接读取有效活动报名，不复制参与名单', () => {
  const lottery = read('lib/activity-lottery.ts')
  assert.match(lottery, /activityRegistration\.findMany\(/)
  assert.match(lottery, /status: 'ACTIVE'/)
  assert.match(lottery, /User: \{ status: 'ACTIVE', isDeleted: false \}/)
  assert.doesNotMatch(lottery, /LotteryParticipant/)
  assert.match(lottery, /registrationId: winner\.registration\.id/)
})

test('开奖和报名取消使用相同的活动锁顺序，开奖后取消被服务端拒绝', () => {
  const lottery = read('lib/activity-lottery.ts')
  const cancel = read('app/api/activities/[activityId]/register/cancel/route.ts')
  assert.match(lottery, /lockActivity\(tx, initial\.activityId\)/)
  assert.match(cancel, /FOR UPDATE/)
  assert.match(cancel, /status: 'DRAWN'/)
  assert.match(cancel, /isActivityRegistrationCancellationOpen\(activity, now\)/)
})

test('活动开奖只允许服务端调度触发，结果落库并且重复执行幂等', () => {
  const lottery = read('lib/activity-lottery.ts')
  const server = read('server.ts')
  const dailyJob = read('app/api/internal/daily-jobs/activity-auto-checkin/route.ts')
  assert.match(lottery, /tx\.lotteryEntry\.create\(/)
  assert.match(lottery, /status: 'DRAWN'/)
  assert.match(lottery, /if \(lottery\.status === 'DRAWN'\)/)
  assert.match(lottery, /drawDueActivityLotteries/)
  assert.match(server, /drawDueActivityLotteries/)
  assert.match(dailyJob, /drawDueActivityLotteries/)
})

test('管理员扫码接口只查询，确认接口才执行选中权益核销', () => {
  const lookupRoute = read('app/api/admin/activities/[activityId]/verify/route.ts')
  const confirmRoute = read('app/api/admin/activities/[activityId]/redemption-confirm/route.ts')
  const redemption = read('lib/activity-redemption.ts')
  assert.match(lookupRoute, /scanOnly: true/)
  assert.doesNotMatch(lookupRoute, /verifyActivityRegistration\(/)
  assert.match(confirmRoute, /confirmActivityRedemption\(/)
  assert.match(redemption, /LOTTERY_PRIZE/)
  assert.match(redemption, /redeemLotteryWinnerInTransaction\(/)
  assert.match(redemption, /redemptionStatus: 'REDEEMED'/)
  assert.match(redemption, /updateMany\(/)
})

test('统一核销权益按当前活动隔离，并且中奖不生成独立二维码', () => {
  const redemption = read('lib/activity-redemption.ts')
  const qr = read('components/activities/ActivityRegistrationQr.tsx')
  assert.match(redemption, /Lottery: \{ activityId, status: 'DRAWN' \}/)
  assert.match(redemption, /type: 'LOTTERY_PRIZE'/)
  assert.match(qr, /ActivityRegistrationQr/)
  assert.doesNotMatch(qr, /lottery|winner/i)
})

test('管理员页面支持多个抽奖的奖项图片、说明和排序编辑', () => {
  const manager = read('components/activities/ActivityLotteryManager.tsx')
  assert.match(manager, /imageUrl: string/)
  assert.match(manager, /description: string/)
  assert.match(manager, /奖品图片 URL/)
  assert.match(manager, /↑/)
  assert.match(manager, /↓/)
  assert.match(manager, /prize\.imageUrl \|\| null/)
})

test('中奖通知提示使用活动现有核销码，不携带中奖码', () => {
  const lottery = read('lib/activity-lottery.ts')
  assert.match(lottery, /请使用该活动现有核销码领取/)
  assert.doesNotMatch(lottery, /中奖二维码|中奖码|领奖二维码/)
})
