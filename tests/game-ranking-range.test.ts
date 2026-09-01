import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import {
  GameRankingRangeError,
  GAME_RANKING_RANGE_OPTIONS,
  parseGameRankingRangeKey,
  resolveGameRankingRange,
} from '../lib/game-ranking-range'
import { ENTERTAINMENT_LEADERBOARDS } from '../lib/entertainment-leaderboard-registry'

function source(path: string) {
  return readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
}

function iso(value: Date) {
  return value.toISOString()
}

test('所有游戏榜统一使用四个范围，顺序固定为本周、本月、上月、日期', () => {
  assert.deepEqual(
    GAME_RANKING_RANGE_OPTIONS.map((item) => item.key),
    ['this-week', 'this-month', 'last-month', 'date'],
  )
  assert.deepEqual(
    GAME_RANKING_RANGE_OPTIONS.map((item) => item.label),
    ['本周', '本月', '上月', '日期'],
  )
  const rankable = ENTERTAINMENT_LEADERBOARDS.filter((item) => item.source !== null)
  assert.ok(rankable.length > 0)
  assert.ok(rankable.every((item) => item.ranges.map((range) => range.key).join(',') === 'this-week,this-month,last-month,date'))
})

test('本周保留北京时间周一 00:00 语义，本月使用完整自然月', () => {
  const now = new Date('2026-09-01T00:30:00.000Z')
  const week = resolveGameRankingRange({ range: 'this-week', now })
  const month = resolveGameRankingRange({ range: 'this-month', now })

  assert.equal(iso(week.startAt), '2026-08-30T16:00:00.000Z')
  assert.equal(iso(week.endAt), '2026-09-06T16:00:00.000Z')
  assert.equal(week.periodKey, '2026-08-31')
  assert.equal(iso(month.startAt), '2026-08-31T16:00:00.000Z')
  assert.equal(iso(month.endAt), '2026-09-30T16:00:00.000Z')
  assert.equal(month.periodKey, '2026-09')
})

test('上月覆盖跨年、28/29/30/31 天完整自然月', () => {
  const newYear = resolveGameRankingRange({ range: 'last-month', now: new Date('2026-01-05T04:00:00.000Z') })
  assert.equal(newYear.periodKey, '2025-12')
  assert.equal(iso(newYear.startAt), '2025-11-30T16:00:00.000Z')
  assert.equal(iso(newYear.endAt), '2025-12-31T16:00:00.000Z')

  const leapFebruary = resolveGameRankingRange({ range: 'last-month', now: new Date('2024-03-15T04:00:00.000Z') })
  assert.equal(leapFebruary.periodKey, '2024-02')
  assert.equal(iso(leapFebruary.endAt), '2024-02-29T16:00:00.000Z')

  const april = resolveGameRankingRange({ range: 'last-month', now: new Date('2026-05-15T04:00:00.000Z') })
  assert.equal(iso(april.endAt), '2026-04-30T16:00:00.000Z')
})

test('日期榜使用 [startAt,endAt) 单日边界，并返回稳定缓存键', () => {
  const range = resolveGameRankingRange({ range: 'date', date: '2026-08-31', now: new Date('2026-09-01T00:30:00.000Z') })
  assert.equal(iso(range.startAt), '2026-08-30T16:00:00.000Z')
  assert.equal(iso(range.endAt), '2026-08-31T16:00:00.000Z')
  assert.equal(range.date, '2026-08-31')
  assert.equal(range.cacheKey, 'date:2026-08-31')
  assert.equal(range.endAt.getTime() > range.startAt.getTime(), true)
})

test('未来日期、伪日期和未知范围由服务端拒绝，支持大小写内部别名', () => {
  assert.equal(parseGameRankingRangeKey('THIS_WEEK'), 'this-week')
  assert.equal(parseGameRankingRangeKey('DATE'), 'date')
  assert.equal(parseGameRankingRangeKey('7d'), null)

  assert.throws(
    () => resolveGameRankingRange({ range: 'date', date: '2026-02-30', now: new Date('2026-09-01T00:00:00Z') }),
    (error: unknown) => error instanceof GameRankingRangeError && error.code === 'INVALID_DATE',
  )
  assert.throws(
    () => resolveGameRankingRange({ range: 'date', date: '2026-09-02', now: new Date('2026-09-01T00:00:00Z') }),
    (error: unknown) => error instanceof GameRankingRangeError && error.code === 'FUTURE_DATE',
  )
  assert.throws(
    () => resolveGameRankingRange({ range: 'date', now: new Date('2026-09-01T00:00:00Z') }),
    (error: unknown) => error instanceof GameRankingRangeError && error.code === 'INVALID_DATE',
  )
  assert.throws(
    () => resolveGameRankingRange({ range: 'unknown', now: new Date('2026-09-01T00:00:00Z') }),
    (error: unknown) => error instanceof GameRankingRangeError && error.code === 'INVALID_RANGE',
  )
})

test('两个公共榜单 API 和页面只发送 range/date，日期查询仍按 completedAt 服务端筛选', () => {
  const guessRoute = source('app/api/entertainment/guess-song/leaderboard/route.ts')
  const wantRoute = source('app/api/entertainment/want-listen/leaderboard/route.ts')
  const centerRoute = source('app/api/entertainment/leaderboard/route.ts')
  const guessService = source('lib/guess-song-leaderboard.ts')
  const wantService = source('lib/want-listen-leaderboard.ts')
  const rangeTabs = source('components/games/GameRankingRangeTabs.tsx')

  for (const item of [guessRoute, wantRoute, centerRoute]) {
    assert.match(item, /range/)
    assert.match(item, /date/)
  }
  assert.match(guessService, /resolveGameRankingRange/)
  assert.match(wantService, /resolveGameRankingRange/)
  assert.match(guessService, /s\.completedAt >= \$\{input\.start\}/)
  assert.match(guessService, /s\.completedAt < \$\{input\.end\}/)
  assert.match(wantService, /s\.completedAt >= \$\{input\.start\}/)
  assert.match(wantService, /s\.completedAt < \$\{input\.endExclusive\}/)
  assert.match(guessService, /guess-song:\$\{input\.mode\}:\$\{range\.cacheKey\}/)
  assert.match(wantService, /want-listen:\$\{input\.mode\}:\$\{resolvedRange\.cacheKey\}/)
  assert.match(rangeTabs, /max=\{todayDate\}/)
  assert.match(rangeTabs, /GAME_RANKING_RANGE_OPTIONS/)
})

test('独立榜单页和娱乐天空中心复用同一范围组件，并清理离开日期时的 date 参数', () => {
  const guessPage = source('app/entertainment/guess-song/leaderboard/GuessSongLeaderboard.tsx')
  const wantPage = source('app/games/want-listen/WantListenLeaderboard.tsx')
  const center = source('components/games/EntertainmentLeaderboardCenter.tsx')
  for (const item of [guessPage, wantPage, center]) {
    assert.match(item, /GameRankingRangeTabs/)
    assert.match(item, /pushState/)
  }
  assert.match(guessPage, /params\.delete\('date'\)/)
  assert.match(wantPage, /params\.delete\('date'\)/)
  assert.match(center, /params\.delete\('date'\)/)
  assert.match(guessPage, /暂无榜单数据/)
})
