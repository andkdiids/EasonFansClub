import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { getBeijingDateKey, shiftBeijingDateKey } from '../lib/beijing-time'
import {
  DAILY_PRESCRIPTION_REWARD_RANGE_WEIGHTS,
  DAILY_PRESCRIPTION_REWARD_RANGES,
  MAX_DAILY_PRESCRIPTION_REWARD,
  MIN_DAILY_PRESCRIPTION_REWARD,
  areRecentDailyPrescriptionRewardsAllLow,
  drawDailyPrescriptionReward,
} from '../lib/entertainment-rewards'
import { selectLyricCandidate, type LyricCandidate } from '../lib/entertainment'

function source(path: string) {
  return readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
}

const lyrics: LyricCandidate[] = [
  { id: 'a', text: '短句 A', songTitle: '歌曲 A', albumTitle: null },
  { id: 'b', text: '短句 B', songTitle: '歌曲 B', albumTitle: '专辑 B' },
  { id: 'c', text: '短句 C', songTitle: '歌曲 C', albumTitle: null },
]

function randomIntegerSequence(...rolls: number[]) {
  let index = 0
  return (maxExclusive: number) => {
    const roll = rolls[index]
    index += 1
    assert.ok(Number.isInteger(roll) && roll >= 0 && roll < maxExclusive)
    return roll
  }
}

test('每日处方连续大量抽取始终是 7 到 27 的整数', () => {
  const rewards = Array.from({ length: 10_000 }, () => drawDailyPrescriptionReward())
  assert.ok(rewards.every((reward) => Number.isInteger(reward)))
  assert.ok(rewards.every((reward) => reward >= MIN_DAILY_PRESCRIPTION_REWARD && reward <= MAX_DAILY_PRESCRIPTION_REWARD))
})

test('每日处方的 7 和 27 都是可达结果', () => {
  assert.equal(drawDailyPrescriptionReward([], randomIntegerSequence(0, 0)), MIN_DAILY_PRESCRIPTION_REWARD)
  assert.equal(drawDailyPrescriptionReward([], randomIntegerSequence(99, 5)), MAX_DAILY_PRESCRIPTION_REWARD)
})

test('每日处方区间权重固定为 27:46:27，左右相同且中间更高', () => {
  assert.deepEqual(DAILY_PRESCRIPTION_REWARD_RANGE_WEIGHTS, {
    low: 27,
    middle: 46,
    high: 27,
  })
  assert.equal(DAILY_PRESCRIPTION_REWARD_RANGE_WEIGHTS.low, DAILY_PRESCRIPTION_REWARD_RANGE_WEIGHTS.high)
  assert.ok(DAILY_PRESCRIPTION_REWARD_RANGE_WEIGHTS.middle > DAILY_PRESCRIPTION_REWARD_RANGE_WEIGHTS.low)
  assert.ok(DAILY_PRESCRIPTION_REWARD_RANGE_WEIGHTS.middle > DAILY_PRESCRIPTION_REWARD_RANGE_WEIGHTS.high)
})

test('每日处方中间区间的出现频率明显高于低位和高位区间', () => {
  const counts = { low: 0, middle: 0, high: 0 }
  for (let index = 0; index < 50_000; index += 1) {
    const reward = drawDailyPrescriptionReward()
    if (reward <= DAILY_PRESCRIPTION_REWARD_RANGES.low.max) counts.low += 1
    else if (reward <= DAILY_PRESCRIPTION_REWARD_RANGES.middle.max) counts.middle += 1
    else counts.high += 1
  }

  assert.ok(counts.middle > counts.low * 1.5)
  assert.ok(counts.middle > counts.high * 1.5)
})

test('每日处方只给区间设置权重，每个区间内部使用同一个等概率整数抽取', () => {
  for (let offset = 0; offset <= 4; offset += 1) {
    assert.equal(drawDailyPrescriptionReward([], randomIntegerSequence(0, offset)), 7 + offset)
  }
  for (let offset = 0; offset <= 9; offset += 1) {
    assert.equal(drawDailyPrescriptionReward([], randomIntegerSequence(27, offset)), 12 + offset)
  }
  for (let offset = 0; offset <= 5; offset += 1) {
    assert.equal(drawDailyPrescriptionReward([], randomIntegerSequence(73, offset)), 22 + offset)
  }

  const rewardSource = source('lib/daily-prescription-reward.ts')
  assert.doesNotMatch(rewardSource, /getRewardWeight|REWARD_WEIGHTS|28\s*-\s*reward/)
  assert.match(rewardSource, /const rangeSize = range\.max - range\.min \+ 1/)
  assert.match(rewardSource, /return range\.min \+ valueRoll/)
})

test('最近连续三次低位奖励时排除低位区间，出现中位奖励后恢复普通随机', () => {
  assert.equal(areRecentDailyPrescriptionRewardsAllLow([8, 10, 7]), true)
  assert.equal(drawDailyPrescriptionReward([8, 10, 7], randomIntegerSequence(0, 0)), 12)
  assert.equal(drawDailyPrescriptionReward([8, 10, 7], randomIntegerSequence(45, 9)), 21)
  assert.equal(drawDailyPrescriptionReward([8, 10, 7], randomIntegerSequence(46, 0)), 22)
  assert.equal(drawDailyPrescriptionReward([8, 10, 7], randomIntegerSequence(72, 5)), 27)

  assert.equal(areRecentDailyPrescriptionRewardsAllLow([16, 8, 10]), false)
  assert.equal(drawDailyPrescriptionReward([16, 8, 10], randomIntegerSequence(0, 0)), 7)
})

test('北京时间日期键在 UTC 跨日边界按 Asia/Shanghai 计算', () => {
  assert.equal(getBeijingDateKey(new Date('2026-07-26T15:59:59Z')), '2026-07-26')
  assert.equal(getBeijingDateKey(new Date('2026-07-26T16:00:00Z')), '2026-07-27')
  assert.equal(shiftBeijingDateKey('2026-08-01', -1), '2026-07-31')
})

test('歌词选择优先排除最近 7 天已展示内容', () => {
  const selected = selectLyricCandidate(lyrics, new Set(['a', 'b']), () => 0)
  assert.equal(selected?.id, 'c')
})

test('可用歌词不足时允许回退重复，不阻断抽奖', () => {
  const selected = selectLyricCandidate(lyrics, new Set(['a', 'b', 'c']), () => 1)
  assert.equal(selected?.id, 'b')
  assert.equal(selectLyricCandidate([], new Set(), () => 0), null)
})

test('数据库模型提供每日唯一约束、歌词快照与挂号费流水关联', () => {
  const schema = source('prisma/schema.prisma')
  assert.match(schema, /@@unique\(\[userId, dateKey\]\)/)
  assert.match(schema, /points\s+Int/)
  assert.match(schema, /lyricText\s+String\?/)
  assert.match(schema, /dailyDrawId\s+String\?\s+@unique/)
  assert.match(schema, /ENTERTAINMENT_DAILY_DRAW/)
})

test('抽奖服务在同一事务创建记录、通过统一服务增加挂号费与累计展示次数', () => {
  const service = source('lib/entertainment.ts')
  assert.match(service, /prisma\.\$transaction/)
  assert.match(service, /tx\.entertainmentDailyDraw\.create/)
  assert.match(service, /awardRegistrationFee\(tx/)
  assert.match(service, /drawDailyPrescriptionReward\(recentRewardDraws\.map\(\(draw\) => draw\.points\)\)/)
  assert.match(service, /take: 3/)
  assert.match(service, /requestedAmount: requestedPoints/)
  assert.doesNotMatch(service, /countsTowardDailyLimit|registrationFeeLimitReached/)
  assert.match(service, /points: requestedPoints/)
  assert.match(service, /feeAward\.awardedAmount !== requestedPoints/)
  assert.match(service, /data: \{ points: feeAward\.awardedAmount \}/)
  assert.match(service, /displayCount: \{ increment: 1 \}/)
  assert.match(service, /error\.code === 'P2002'/)
  assert.match(service, /findExistingDraw\(userId, dateKey\)/)
})

test('同一天重复领取复用已保存奖励，并由唯一约束处理并发请求', () => {
  const service = source('lib/entertainment.ts')
  const schema = source('prisma/schema.prisma')
  assert.match(service, /const existing = await findExistingDraw\(userId, dateKey\)/)
  assert.match(service, /return \{ created: false, draw: serializeDailyDraw\(existing, user\.points\) \}/)
  assert.match(service, /for \(let attempt = 0; attempt < 3; attempt \+= 1\)/)
  assert.match(service, /error\.code === 'P2002'/)
  assert.match(service, /const concurrentDraw = await findExistingDraw\(userId, dateKey\)/)
  assert.match(service, /return \{ created: false, draw: serializeDailyDraw\(concurrentDraw, user\.points\) \}/)
  assert.match(schema, /@@unique\(\[userId, dateKey\]\)/)
})

test('北京时间跨日生成新的 dateKey，历史奖励数字按原值动态显示', () => {
  const service = source('lib/entertainment.ts')
  const detail = source('components/games/DailyPrescriptionDetail.tsx')
  const center = source('app/entertainment/EntertainmentCenter.tsx')
  assert.notEqual(getBeijingDateKey(new Date('2026-07-26T15:59:59Z')), getBeijingDateKey(new Date('2026-07-26T16:00:00Z')))
  assert.match(service, /const dateKey = getBeijingDateKey\(now\)/)
  assert.match(service, /dateKey,\s*points: requestedPoints/)
  assert.match(detail, /\+\{status\.draw\.points\} 挂号费/)
  assert.match(center, /\+\{drawResult\.points\} 挂号费/)
  assert.doesNotMatch(detail, /\+1 挂号费/)
  assert.doesNotMatch(center, /\+1 挂号费/)
})

test('奖励只写入挂号费 points，不写入经验或听听排行榜', () => {
  const service = source('lib/entertainment.ts')
  const feeService = source('lib/registration-fee.ts')
  assert.match(feeService, /data: \{ points: \{ increment: requestedAmount \} \}/)
  assert.match(service, /action: 'ENTERTAINMENT_DAILY_DRAW'/)
  assert.doesNotMatch(service, /experience|GuessSong|leaderboard/i)
})

test('服务端使用 crypto.randomInt，客户端不自行随机或伪造失败奖励', () => {
  const rewardService = source('lib/entertainment-rewards.ts')
  const detail = source('components/games/DailyPrescriptionDetail.tsx')
  const center = source('app/entertainment/EntertainmentCenter.tsx')
  assert.match(rewardService, /from 'node:crypto'/)
  assert.match(rewardService, /randomInt\(maxExclusive\)/)
  assert.doesNotMatch(rewardService, /Math\.random/)
  assert.doesNotMatch(detail, /Math\.random/)
  assert.doesNotMatch(center, /Math\.random/)
  assert.match(detail, /throw new Error\(payload\.error \|\| '请求失败'\)/)
  assert.match(center, /throw new Error\(body\?\.error \|\| '请求失败，请稍后重试'\)/)
})

test('用户抽奖接口未登录返回 401 且不把异常堆栈返回前端', () => {
  const route = source('app/api/entertainment/daily-draw/route.ts')
  assert.match(route, /status: 401/)
  assert.match(route, /ok: false, data: null, error:/)
  assert.doesNotMatch(route, /error\.stack/)
})

test('后台歌词接口和页面都要求 entertainment_manage 权限', () => {
  const collectionRoute = source('app/api/admin/entertainment/lyrics/route.ts')
  const itemRoute = source('app/api/admin/entertainment/lyrics/[lyricId]/route.ts')
  const page = source('app/admin/entertainment/lyrics/page.tsx')
  for (const item of [collectionRoute, itemRoute, page]) assert.match(item, /entertainment_manage/)
})

test('歌词为空仍创建抽奖与挂号费流水，且处方卡提供 midnight 可读样式', () => {
  const service = source('lib/entertainment.ts')
  const styles = source('app/globals.css')
  assert.match(service, /lyricPrescriptionId: lyric\?\.id \?\? null/)
  assert.match(service, /awardRegistrationFee\(tx/)
  assert.match(styles, /:root\[data-theme='midnight'\] \.prescription-card/)
  assert.match(styles, /color:var\(--foreground\)/)
})
