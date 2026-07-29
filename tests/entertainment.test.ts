import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { getBeijingDateKey, shiftBeijingDateKey } from '../lib/beijing-time'
import { selectEntertainmentReward } from '../lib/entertainment-rewards'
import { selectLyricCandidate, type LyricCandidate } from '../lib/entertainment'

function source(path: string) {
  return readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
}

const lyrics: LyricCandidate[] = [
  { id: 'a', text: '短句 A', songTitle: '歌曲 A', albumTitle: null },
  { id: 'b', text: '短句 B', songTitle: '歌曲 B', albumTitle: '专辑 B' },
  { id: 'c', text: '短句 C', songTitle: '歌曲 C', albumTitle: null },
]

test('挂号费奖励池严格对应 35/30/20/10/5 权重边界', () => {
  assert.equal(selectEntertainmentReward(0), 1)
  assert.equal(selectEntertainmentReward(34), 1)
  assert.equal(selectEntertainmentReward(35), 3)
  assert.equal(selectEntertainmentReward(64), 3)
  assert.equal(selectEntertainmentReward(65), 5)
  assert.equal(selectEntertainmentReward(84), 5)
  assert.equal(selectEntertainmentReward(85), 7)
  assert.equal(selectEntertainmentReward(94), 7)
  assert.equal(selectEntertainmentReward(95), 10)
  assert.equal(selectEntertainmentReward(99), 10)
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
  assert.match(schema, /lyricText\s+String\?/)
  assert.match(schema, /dailyDrawId\s+String\?\s+@unique/)
  assert.match(schema, /ENTERTAINMENT_DAILY_DRAW/)
})

test('抽奖服务在同一事务创建记录、通过统一服务增加挂号费与累计展示次数', () => {
  const service = source('lib/entertainment.ts')
  assert.match(service, /prisma\.\$transaction/)
  assert.match(service, /tx\.entertainmentDailyDraw\.create/)
  assert.match(service, /awardRegistrationFee\(tx/)
  assert.match(service, /requestedAmount: requestedPoints/)
  assert.match(service, /displayCount: \{ increment: 1 \}/)
  assert.match(service, /error\.code === 'P2002'/)
  assert.match(service, /findExistingDraw\(userId, dateKey\)/)
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
