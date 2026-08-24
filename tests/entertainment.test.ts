import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { getBeijingDateKey, shiftBeijingDateKey } from '../lib/beijing-time'
import {
  DAILY_PRESCRIPTION_REWARD_WEIGHTS,
  DAILY_PRESCRIPTION_REWARD_WEIGHT_TOTAL,
  MAX_DAILY_PRESCRIPTION_REWARD,
  MIN_DAILY_PRESCRIPTION_REWARD,
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

test('每日处方使用单一全局整数权重表，权重总和为 100%', () => {
  assert.deepEqual(DAILY_PRESCRIPTION_REWARD_WEIGHTS, [
    { reward: 7, weight: 8024 },
    { reward: 8, weight: 7698 },
    { reward: 9, weight: 7371 },
    { reward: 10, weight: 7045 },
    { reward: 11, weight: 6719 },
    { reward: 12, weight: 6393 },
    { reward: 13, weight: 6067 },
    { reward: 14, weight: 5740 },
    { reward: 15, weight: 5414 },
    { reward: 16, weight: 5088 },
    { reward: 17, weight: 4762 },
    { reward: 18, weight: 4436 },
    { reward: 19, weight: 4110 },
    { reward: 20, weight: 3783 },
    { reward: 21, weight: 3457 },
    { reward: 22, weight: 3131 },
    { reward: 23, weight: 2805 },
    { reward: 24, weight: 2479 },
    { reward: 25, weight: 2152 },
    { reward: 26, weight: 1826 },
    { reward: 27, weight: 1500 },
  ])
  assert.equal(DAILY_PRESCRIPTION_REWARD_WEIGHT_TOTAL, 100_000)
  assert.equal(
    DAILY_PRESCRIPTION_REWARD_WEIGHTS.reduce((total, option) => total + option.weight, 0),
    DAILY_PRESCRIPTION_REWARD_WEIGHT_TOTAL,
  )
})

test('每日处方覆盖 7 到 27，且权重严格连续递减', () => {
  assert.deepEqual(
    DAILY_PRESCRIPTION_REWARD_WEIGHTS.map((option) => option.reward),
    Array.from({ length: MAX_DAILY_PRESCRIPTION_REWARD - MIN_DAILY_PRESCRIPTION_REWARD + 1 }, (_, index) => MIN_DAILY_PRESCRIPTION_REWARD + index),
  )
  assert.ok(DAILY_PRESCRIPTION_REWARD_WEIGHTS.every((option) => option.weight > 0))
  for (let index = 1; index < DAILY_PRESCRIPTION_REWARD_WEIGHTS.length; index += 1) {
    assert.ok(DAILY_PRESCRIPTION_REWARD_WEIGHTS[index - 1].weight > DAILY_PRESCRIPTION_REWARD_WEIGHTS[index].weight)
  }
  assert.ok(
    DAILY_PRESCRIPTION_REWARD_WEIGHTS.find((option) => option.reward === 20)!.weight
      > DAILY_PRESCRIPTION_REWARD_WEIGHTS.find((option) => option.reward === 21)!.weight,
  )
  assert.ok(
    DAILY_PRESCRIPTION_REWARD_WEIGHTS.find((option) => option.reward === 26)!.weight
      > DAILY_PRESCRIPTION_REWARD_WEIGHTS.find((option) => option.reward === 27)!.weight,
  )
})

test('每日处方的累计概率为 7–20 约 82.65%，21–27 约 17.35%', () => {
  const lowTotal = DAILY_PRESCRIPTION_REWARD_WEIGHTS
    .filter((option) => option.reward <= 20)
    .reduce((total, option) => total + option.weight, 0)
  const highTotal = DAILY_PRESCRIPTION_REWARD_WEIGHTS
    .filter((option) => option.reward >= 21)
    .reduce((total, option) => total + option.weight, 0)

  assert.equal(lowTotal, 82_650)
  assert.equal(highTotal, 17_350)
  assert.equal(lowTotal + highTotal, DAILY_PRESCRIPTION_REWARD_WEIGHT_TOTAL)
})

test('每日处方 24、25、26、27 的实际概率分别为 2.479%、2.152%、1.826%、1.500%', () => {
  assert.deepEqual(
    DAILY_PRESCRIPTION_REWARD_WEIGHTS.filter((option) => option.reward >= 24),
    [
      { reward: 24, weight: 2479 },
      { reward: 25, weight: 2152 },
      { reward: 26, weight: 1826 },
      { reward: 27, weight: 1500 },
    ],
  )
})

test('每日处方每个奖励都可由全局累计权重边界抽出，最低和最高边界有效', () => {
  let lowerBound = 0
  for (const option of DAILY_PRESCRIPTION_REWARD_WEIGHTS) {
    const upperBound = lowerBound + option.weight
    assert.equal(drawDailyPrescriptionReward(randomIntegerSequence(lowerBound)), option.reward)
    assert.equal(drawDailyPrescriptionReward(randomIntegerSequence(upperBound - 1)), option.reward)
    lowerBound = upperBound
  }

  assert.equal(drawDailyPrescriptionReward(randomIntegerSequence(0)), MIN_DAILY_PRESCRIPTION_REWARD)
  assert.equal(drawDailyPrescriptionReward(randomIntegerSequence(DAILY_PRESCRIPTION_REWARD_WEIGHT_TOTAL - 1)), MAX_DAILY_PRESCRIPTION_REWARD)
  assert.equal(lowerBound, DAILY_PRESCRIPTION_REWARD_WEIGHT_TOTAL)
})

test('每日处方使用一次全局 weighted random，不读取历史奖励或使用旧概率池', () => {
  const rewardSource = source('lib/daily-prescription-reward.ts')
  const wrapperSource = source('lib/entertainment-rewards.ts')
  const service = source('lib/entertainment.ts')
  let randomCalls = 0

  assert.equal(drawDailyPrescriptionReward((maxExclusive) => {
    randomCalls += 1
    assert.equal(maxExclusive, DAILY_PRESCRIPTION_REWARD_WEIGHT_TOTAL)
    return 0
  }), MIN_DAILY_PRESCRIPTION_REWARD)
  assert.equal(randomCalls, 1)
  assert.doesNotMatch(rewardSource, /DAILY_PRESCRIPTION_REWARD_RANGE|excludeLowRange|areRecentDailyPrescriptionRewardsAllLow/)
  assert.doesNotMatch(wrapperSource, /recentRewards|areRecentDailyPrescriptionRewardsAllLow|excludeLowRange/)
  assert.doesNotMatch(service, /recentRewardDraws|take:\s*3/)
  assert.match(service, /drawDailyPrescriptionReward\(\)/)
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
  assert.match(service, /drawDailyPrescriptionReward\(\)/)
  assert.doesNotMatch(service, /recentRewardDraws|take:\s*3/)
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
