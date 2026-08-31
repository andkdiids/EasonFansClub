import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'
import {
  ACTIVITY_LOTTERY_ALGORITHM_VERSION,
  calculateLotteryWinRate,
  getActivityLotteryWinnerRedemptionState,
  hasValidActivityLotteryCheckIn,
  normalizeActivityLotteryInput,
  secureShuffle,
  validateLotterySchedule,
} from '@/lib/activity-lottery'
import { ACTIVITY_LOTTERY_TIER_NAMES, MAX_ACTIVITY_LOTTERY_PRIZES, activityLotteryTierName } from '@/lib/activity-lottery-levels'

const root = process.cwd()
const read = (file: string) => readFileSync(join(root, file), 'utf8')

test('开奖时间只要求早于活动结束时间，不受报名截止时间限制', () => {
  const activityEndAt = new Date('2026-09-13T13:00:00.000Z')
  assert.equal(validateLotterySchedule(activityEndAt, new Date('2026-09-13T12:00:00.000Z')), null)
  assert.equal(validateLotterySchedule(activityEndAt, new Date('2026-09-13T12:30:00.000Z')), null)
  assert.equal(validateLotterySchedule(activityEndAt, new Date('2026-09-13T12:50:00.000Z')), null)
  assert.match(validateLotterySchedule(activityEndAt, activityEndAt) || '', /开奖时间必须早于活动结束时间/)
  assert.match(validateLotterySchedule(activityEndAt, new Date('2026-09-13T13:00:01.000Z')) || '', /开奖时间必须早于活动结束时间/)
  assert.match(validateLotterySchedule(null, new Date('2026-09-13T12:00:00.000Z')) || '', /先设置活动结束时间/)
})

test('中奖资格与兑奖资格分离，真实核销和活动结束自动核销结果不同', () => {
  const activityEndAt = new Date('2026-09-13T13:00:00.000Z')
  const unchecked = { status: 'ACTIVE', verifiedAt: null, checkedInAt: null, checkInSource: null }
  const realCheckIn = { status: 'ACTIVE', verifiedAt: new Date('2026-09-13T12:15:00.000Z'), checkedInAt: new Date('2026-09-13T12:15:00.000Z'), checkInSource: 'QR' }
  const autoCheckIn = { status: 'ACTIVE', verifiedAt: new Date('2026-09-13T13:00:00.000Z'), checkedInAt: new Date('2026-09-13T13:00:00.000Z'), checkInSource: 'AUTO_AFTER_ACTIVITY_END' }
  assert.equal(getActivityLotteryWinnerRedemptionState({ redemptionStatus: 'PENDING', registration: unchecked, activityEndAt, now: new Date('2026-09-13T12:00:00.000Z') }), 'WAITING_FOR_CHECK_IN')
  assert.equal(getActivityLotteryWinnerRedemptionState({ redemptionStatus: 'PENDING', registration: realCheckIn, activityEndAt, now: new Date('2026-09-13T12:20:00.000Z') }), 'REDEEMABLE')
  assert.equal(getActivityLotteryWinnerRedemptionState({ redemptionStatus: 'PENDING', registration: realCheckIn, activityEndAt, now: new Date('2026-09-13T13:10:00.000Z') }), 'REDEEMABLE')
  assert.equal(getActivityLotteryWinnerRedemptionState({ redemptionStatus: 'PENDING', registration: unchecked, activityEndAt, now: new Date('2026-09-13T13:00:00.000Z') }), 'EXPIRED')
  assert.equal(getActivityLotteryWinnerRedemptionState({ redemptionStatus: 'PENDING', registration: autoCheckIn, activityEndAt, now: new Date('2026-09-13T13:10:00.000Z') }), 'EXPIRED')
  assert.equal(getActivityLotteryWinnerRedemptionState({ redemptionStatus: 'PENDING', registration: { ...realCheckIn, checkedInAt: new Date('2026-09-13T13:30:00.000Z'), verifiedAt: new Date('2026-09-13T13:30:00.000Z') }, activityEndAt, now: new Date('2026-09-13T13:40:00.000Z') }), 'EXPIRED')
  assert.equal(getActivityLotteryWinnerRedemptionState({ redemptionStatus: 'REDEEMED', registration: autoCheckIn, activityEndAt, now: new Date('2026-09-13T13:10:00.000Z') }), 'REDEEMED')
  assert.equal(hasValidActivityLotteryCheckIn(realCheckIn, activityEndAt, new Date('2026-09-13T12:20:00.000Z')), true)
  assert.equal(hasValidActivityLotteryCheckIn(autoCheckIn, activityEndAt, new Date('2026-09-13T13:10:00.000Z')), false)
})

test('抽奖输入按数组顺序自动生成固定奖项等级，并支持图片、说明和数量校验', () => {
  const normalized = normalizeActivityLotteryInput({
    title: '滨海歌友之夜抽奖',
    description: '现场抽奖说明',
    drawAt: '2026-09-13T20:00',
    prizes: [
      { tierName: '重复一等奖', name: '周边礼包', imageUrl: 'https://media.ecfc.fans/prize.png', description: '限定礼盒', quantity: 2 },
      { tierName: '一等奖', name: '徽章', quantity: 8 },
    ],
  })
  assert.equal(normalized.valid, true)
  if (!normalized.valid) return
  assert.equal(normalized.value.prizes.length, 2)
  assert.deepEqual(normalized.value.prizes.map((prize) => prize.tierName), ['一等奖', '二等奖'])
  assert.equal(normalized.value.prizes[0]?.quantity, 2)
  assert.equal(normalized.value.prizes[0]?.imageUrl, 'https://media.ecfc.fans/prize.png')
  assert.equal(normalized.value.prizes[0]?.description, '限定礼盒')
  assert.equal(normalizeActivityLotteryInput({ title: '无效', drawAt: '2026-09-13T20:00', prizes: [{ tierName: '一等奖', name: '奖品', quantity: 0 }] }).valid, false)
  assert.equal(normalizeActivityLotteryInput({ title: '无效图片', drawAt: '2026-09-13T20:00', prizes: [{ name: '奖品', imageUrl: 'not-a-url', quantity: 1 }] }).valid, false)
  assert.equal(normalizeActivityLotteryInput({ title: '超出上限', drawAt: '2026-09-13T20:00', prizes: Array.from({ length: MAX_ACTIVITY_LOTTERY_PRIZES + 1 }, (_, index) => ({ name: `奖品${index + 1}`, quantity: 1 })) }).valid, false)
})

test('活动抽奖等级只包含四档并且按索引连续', () => {
  assert.deepEqual(ACTIVITY_LOTTERY_TIER_NAMES, ['一等奖', '二等奖', '三等奖', '参与奖'])
  assert.equal(MAX_ACTIVITY_LOTTERY_PRIZES, 4)
  assert.deepEqual(ACTIVITY_LOTTERY_TIER_NAMES.map((_, index) => activityLotteryTierName(index)), ['一等奖', '二等奖', '三等奖', '参与奖'])
  assert.equal(activityLotteryTierName(4), '')
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
  const candidateQuery = lottery.slice(lottery.indexOf('const registrations = await tx.activityRegistration.findMany('), lottery.indexOf('const shuffled = secureShuffle(registrations)'))
  assert.match(lottery, /activityRegistration\.findMany\(/)
  assert.match(lottery, /status: 'ACTIVE'/)
  assert.match(lottery, /User: \{ status: 'ACTIVE', isDeleted: false \}/)
  assert.doesNotMatch(candidateQuery, /checkedInAt|verifiedAt|checkInSource/)
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

test('管理员页面使用固定等级和活动图片上传组件编辑奖项', () => {
  const manager = read('components/activities/ActivityLotteryManager.tsx')
  const imageUploader = read('components/activities/ActivityImageUploader.tsx')
  assert.match(manager, /imageUrl: string/)
  assert.match(manager, /description: string/)
  assert.match(manager, /ActivityImageUploader/)
  assert.match(manager, /uploadActivityImage/)
  assert.match(manager, /activityLotteryTierName\(index\)/)
  assert.match(manager, /最多可设置 \$\{MAX_ACTIVITY_LOTTERY_PRIZES\} 个奖项/)
  assert.match(manager, /更换图片/)
  assert.match(manager, /删除图片/)
  assert.doesNotMatch(manager, /奖品图片 URL/)
  assert.doesNotMatch(manager, /updatePrize\(index, 'tierName'/)
  assert.match(imageUploader, /resetSignal/)
  assert.match(imageUploader, /errorMessage/)
  assert.match(manager, /↑/)
  assert.match(manager, /↓/)
  assert.match(manager, /prize\.imageUrl \|\| null/)
})

test('活动创建和编辑表单都提供现有抽奖管理入口，新活动先保存草稿避免孤儿抽奖', () => {
  const admin = read('app/admin/activities/ActivityAdminManager.tsx')
  const entry = read('components/activities/ActivityLotteryEntry.tsx')
  const manager = read('components/activities/ActivityLotteryManager.tsx')
  assert.match(admin, /ActivityLotteryEntry/)
  assert.match(admin, /keepEditing: true/)
  assert.match(admin, /activityEndAt=/)
  assert.match(admin, /请先设置活动结束时间，再添加自动抽奖/)
  assert.match(entry, /活动抽奖（可选）/)
  assert.match(entry, /\+ 添加抽奖/)
  assert.match(entry, /ActivityLotteryManager/)
  assert.match(entry, /activityEndAt/)
  assert.match(entry, /开奖时间必须早于活动结束时间/)
  assert.match(manager, /openOnMount\?: boolean/)
  assert.match(manager, /activityEndAt/)
  assert.match(manager, /\+ 添加抽奖/)
})

test('编辑活动时不能把活动结束时间改到未开奖抽奖的开奖时间之前', () => {
  const route = read('app/api/admin/activities/[activityId]/route.ts')
  assert.match(route, /assertLotterySchedulesFitActivityEnd/)
  assert.match(route, /status: \{ in: \['DRAFT', 'SCHEDULED'\] \}/)
  assert.match(route, /drawAt: activityEndAt \? \{ gte: activityEndAt \} : \{ not: null \}/)
  assert.match(route, /活动结束时间必须晚于已有抽奖开奖时间/)
  assert.doesNotMatch(route, /报名结束时间不能晚于已有抽奖开奖时间/)
})

test('中奖后兑奖服务端强制检查真实核销、有效期和已兑奖状态', () => {
  const redemption = read('lib/activity-redemption.ts')
  const registration = read('lib/activity-registration.ts')
  assert.match(redemption, /getActivityLotteryWinnerRedemptionState/)
  assert.match(redemption, /LOTTERY_WINNER_WAITING_FOR_CHECK_IN/)
  assert.match(redemption, /LOTTERY_WINNER_EXPIRED/)
  assert.match(redemption, /winner\.registrationId && winner\.registrationId !== registration\.id/)
  assert.match(redemption, /userId: registration\.userId/)
  assert.match(redemption, /redemptionStatus: 'PENDING'/)
  assert.match(redemption, /registration\.Activity\.endsAt/)
  assert.match(redemption, /checkInSource/)
  assert.match(registration, /AUTO_AFTER_ACTIVITY_END/)
})

test('中奖通知提示使用活动现有核销码，不携带中奖码', () => {
  const lottery = read('lib/activity-lottery.ts')
  assert.match(lottery, /请使用该活动现有核销码领取/)
  assert.doesNotMatch(lottery, /中奖二维码|中奖码|领奖二维码/)
})
