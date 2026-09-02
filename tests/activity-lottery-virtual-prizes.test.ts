import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import assert from 'node:assert/strict'
import test from 'node:test'
import {
  ACTIVITY_LOTTERY_PRIZE_TYPES,
  ACTIVITY_LOTTERY_VIRTUAL_PRIZE_TYPES,
  MAX_ACTIVITY_LOTTERY_REGISTRATION_FEE,
  normalizeActivityLotteryInput,
} from '@/lib/activity-lottery'

const root = process.cwd()
const read = (file: string) => readFileSync(join(root, file), 'utf8')
const base = { title: '现场抽奖', drawAt: '2026-09-13T20:00', prizes: [{ name: '奖品', quantity: 1 }] }

function normalize(prize: Record<string, unknown>) {
  const result = normalizeActivityLotteryInput({ ...base, prizes: [prize] })
  assert.equal(result.valid, true)
  if (!result.valid) throw new Error('测试输入未通过规范化')
  return result.value.prizes[0]
}

test('旧奖品输入默认按实物处理', () => assert.equal(normalize({ name: '旧奖品', quantity: 1 })?.prizeType, 'PHYSICAL'))
test('实物奖品不需要虚拟子类型', () => {
  const prize = normalize({ name: '礼盒', quantity: 2, prizeType: 'PHYSICAL' })
  assert.equal(prize?.virtualPrizeType, null)
  assert.equal(prize?.badgeId, null)
  assert.equal(prize?.registrationFeeAmount, null)
})
test('虚拟奖品支持勋章类型', () => {
  const prize = normalize({ name: '勋章奖励', quantity: 1, prizeType: 'VIRTUAL', virtualPrizeType: 'BADGE', badgeId: 'badge_123' })
  assert.equal(prize?.prizeType, 'VIRTUAL')
  assert.equal(prize?.virtualPrizeType, 'BADGE')
  assert.equal(prize?.badgeId, 'badge_123')
})
test('虚拟奖品支持挂号费类型', () => {
  const prize = normalize({ name: '挂号费奖励', quantity: 1, prizeType: 'VIRTUAL', virtualPrizeType: 'REGISTRATION_FEE', registrationFeeAmount: 88 })
  assert.equal(prize?.registrationFeeAmount, 88)
})
test('虚拟奖品必须选择子类型', () => assert.equal(normalizeActivityLotteryInput({ ...base, prizes: [{ name: '虚拟', quantity: 1, prizeType: 'VIRTUAL' }] }).valid, false))
test('勋章奖品必须选择勋章 ID', () => assert.equal(normalizeActivityLotteryInput({ ...base, prizes: [{ name: '勋章', quantity: 1, prizeType: 'VIRTUAL', virtualPrizeType: 'BADGE' }] }).valid, false))
test('勋章 ID 拒绝不安全字符', () => assert.equal(normalizeActivityLotteryInput({ ...base, prizes: [{ name: '勋章', quantity: 1, prizeType: 'VIRTUAL', virtualPrizeType: 'BADGE', badgeId: '../badge' }] }).valid, false))
test('挂号费必须是正整数', () => assert.equal(normalizeActivityLotteryInput({ ...base, prizes: [{ name: '费用', quantity: 1, prizeType: 'VIRTUAL', virtualPrizeType: 'REGISTRATION_FEE', registrationFeeAmount: 0 }] }).valid, false))
test('挂号费拒绝小数', () => assert.equal(normalizeActivityLotteryInput({ ...base, prizes: [{ name: '费用', quantity: 1, prizeType: 'VIRTUAL', virtualPrizeType: 'REGISTRATION_FEE', registrationFeeAmount: 1.5 }] }).valid, false))
test('挂号费拒绝负数', () => assert.equal(normalizeActivityLotteryInput({ ...base, prizes: [{ name: '费用', quantity: 1, prizeType: 'VIRTUAL', virtualPrizeType: 'REGISTRATION_FEE', registrationFeeAmount: -1 }] }).valid, false))
test('挂号费支持安全上限内的字符串整数', () => assert.equal(normalize({ name: '费用', quantity: 1, prizeType: 'VIRTUAL', virtualPrizeType: 'REGISTRATION_FEE', registrationFeeAmount: '120' })?.registrationFeeAmount, 120))
test('挂号费拒绝超过配置上限', () => assert.equal(normalizeActivityLotteryInput({ ...base, prizes: [{ name: '费用', quantity: 1, prizeType: 'VIRTUAL', virtualPrizeType: 'REGISTRATION_FEE', registrationFeeAmount: MAX_ACTIVITY_LOTTERY_REGISTRATION_FEE + 1 }] }).valid, false))
test('奖品类型常量只包含实物和虚拟', () => assert.deepEqual(ACTIVITY_LOTTERY_PRIZE_TYPES, ['PHYSICAL', 'VIRTUAL']))
test('虚拟奖品类型常量只包含勋章和挂号费', () => assert.deepEqual(ACTIVITY_LOTTERY_VIRTUAL_PRIZE_TYPES, ['BADGE', 'REGISTRATION_FEE']))
test('schema 为旧 LotteryPrize 提供实物默认值并记录履约状态', () => {
  const schema = read('prisma/schema.prisma')
  assert.match(schema, /prizeType\s+ActivityLotteryPrizeType\s+@default\(PHYSICAL\)/)
  assert.match(schema, /fulfillmentStatus\s+ActivityLotteryFulfillmentStatus\s+@default\(NOT_REQUIRED\)/)
})
test('开奖时虚拟中奖记录进入待履约状态', () => assert.match(read('lib/activity-lottery.ts'), /fulfillmentStatus: winner\.prize\.prizeType === 'VIRTUAL' \? 'PENDING' : 'NOT_REQUIRED'/))
test('虚拟履约复用现有勋章事务服务', () => assert.match(read('lib/activity-lottery-fulfillment.ts'), /grantBadgeWithTransaction\(tx/))
test('挂号费奖励复用现有账本服务', () => assert.match(read('lib/activity-lottery-fulfillment.ts'), /awardRegistrationFee\(tx/))
test('挂号费使用中奖记录稳定业务键', () => {
  const source = read('lib/activity-lottery-fulfillment.ts')
  assert.match(source, /activityLotteryPrizeBusinessKey/)
  assert.match(source, /return `activity-lottery-prize:\$\{winnerId\}`/)
})
test('虚拟履约使用中奖行锁保证并发幂等', () => {
  const source = read('lib/activity-lottery-fulfillment.ts')
  assert.match(source, /LotteryEntry.*FOR UPDATE/)
  assert.match(source, /fulfillmentStatus === 'FULFILLED'/)
})
test('履约失败保留中奖记录并写入 FAILED', () => {
  const source = read('lib/activity-lottery-fulfillment.ts')
  assert.match(source, /fulfillmentStatus: 'FAILED'/)
  assert.match(source, /fulfillmentError: message/)
})
test('重试服务接收原 winnerId，不重新抽奖', () => {
  const source = read('lib/activity-lottery-fulfillment.ts')
  assert.match(source, /fulfillActivityLotteryPrize\(winnerId/)
  assert.match(source, /fulfillActivityLotteryWinners\(lotteryId/)
  assert.doesNotMatch(source, /drawActivityLottery/)
  assert.match(source, /Lottery: \{ select: \{[\s\S]*status: true[\s\S]*Activity: \{ select: \{ title: true, status: true \}/)
  assert.match(source, /winner\.Lottery\.status === 'CANCELLED' \|\| winner\.Lottery\.Activity\?\.status === 'CANCELLED'/)
  assert.match(source, /FULFILLMENT_BLOCKED/)
  assert.match(source, /if \(winner\.fulfillmentStatus === 'FULFILLED'\)/)
})
test('虚拟中奖结果不发送物理核销通知', () => assert.match(read('lib/activity-lottery.ts'), /if \(winner\?\.prizeType === 'VIRTUAL'\) return null/))
test('虚拟奖品不进入现场核销权益列表', () => assert.match(read('lib/activity-redemption.ts'), /winners\.filter\(\(winner\) => winner\.LotteryPrize\?\.prizeType !== 'VIRTUAL'\)/))
test('现场核销接口拒绝虚拟奖品', () => assert.match(read('lib/activity-redemption.ts'), /虚拟奖品已自动发放，无需现场兑奖/))
test('管理端提供虚拟奖品配置选择器', () => {
  const manager = read('components/activities/ActivityLotteryManager.tsx')
  assert.match(manager, /实物奖品/)
  assert.match(manager, /虚拟奖品/)
  assert.match(manager, /选择已启用勋章/)
  assert.match(manager, /挂号费金额/)
})
test('管理端提供失败后重新发放入口', () => {
  assert.match(read('components/activities/ActivityLotteryManager.tsx'), /重新发放/)
  assert.match(read('app/api/admin/activities/[activityId]/lotteries/[lotteryId]/winners/[winnerId]/fulfill/route.ts'), /fulfillActivityLotteryPrize/)
})
test('公开端把虚拟奖品展示为自动到账状态', () => {
  const panel = read('components/activities/ActivityLotteryPanel.tsx')
  assert.match(panel, /勋章.*已自动发放/)
  assert.match(panel, /挂号费已自动到账/)
  assert.doesNotMatch(panel, /虚拟.*待核销后兑奖/)
})
test('抽奖包装服务在开奖后统一触发履约，已开奖也可修复', () => {
  const source = read('lib/activity-lottery.ts')
  assert.match(source, /result\.status !== 'DRAWN' && result\.status !== 'ALREADY_DRAWN'/)
  assert.match(source, /fulfillActivityLotteryWinners\(result\.lotteryId/)
})
test('虚拟奖励流水使用独立的抽奖动作类型', () => {
  assert.match(read('prisma/schema.prisma'), /ACTIVITY_LOTTERY_PRIZE/)
  assert.match(read('lib/activity-lottery-fulfillment.ts'), /action: 'ACTIVITY_LOTTERY_PRIZE'/)
})
