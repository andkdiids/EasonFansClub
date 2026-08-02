import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { getBeijingDateKey, shiftBeijingDateKey } from '../lib/beijing-time'
import {
  DAILY_PRESCRIPTION_REWARD_TOTAL_WEIGHT,
  DAILY_PRESCRIPTION_REWARD_WEIGHTS,
  MAX_DAILY_PRESCRIPTION_REWARD,
  MIN_DAILY_PRESCRIPTION_REWARD,
  drawDailyPrescriptionReward,
  getRewardWeight,
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

test('每日处方连续大量抽取始终是 7 到 27 的整数', () => {
  const rewards = Array.from({ length: 10_000 }, () => drawDailyPrescriptionReward())
  assert.ok(rewards.every((reward) => Number.isInteger(reward)))
  assert.ok(rewards.every((reward) => reward >= MIN_DAILY_PRESCRIPTION_REWARD && reward <= MAX_DAILY_PRESCRIPTION_REWARD))
})

test('每日处方的 7 和 27 都是可达结果', () => {
  assert.equal(drawDailyPrescriptionReward(() => 0), MIN_DAILY_PRESCRIPTION_REWARD)
  assert.equal(drawDailyPrescriptionReward(() => DAILY_PRESCRIPTION_REWARD_TOTAL_WEIGHT - 1), MAX_DAILY_PRESCRIPTION_REWARD)
})

test('每日处方权重严格递减并符合 28 - reward', () => {
  for (let reward = MIN_DAILY_PRESCRIPTION_REWARD; reward < MAX_DAILY_PRESCRIPTION_REWARD; reward += 1) {
    assert.ok(getRewardWeight(reward) > getRewardWeight(reward + 1))
  }
  assert.deepEqual(
    DAILY_PRESCRIPTION_REWARD_WEIGHTS.map((item) => item.weight),
    Array.from({ length: 21 }, (_, index) => 21 - index),
  )
  assert.equal(DAILY_PRESCRIPTION_REWARD_TOTAL_WEIGHT, 231)
})

test('每日处方按整数权重区间的左右边界抽取', () => {
  let start = 0
  for (const item of DAILY_PRESCRIPTION_REWARD_WEIGHTS) {
    assert.equal(drawDailyPrescriptionReward(() => start), item.reward)
    assert.equal(drawDailyPrescriptionReward(() => start + item.weight - 1), item.reward)
    start += item.weight
  }
  assert.equal(start, DAILY_PRESCRIPTION_REWARD_TOTAL_WEIGHT)
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
