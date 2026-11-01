import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import {
  GameRankingRangeError,
  GAME_RANKING_RANGE_OPTIONS,
  parseGameRankingRangeKey,
  readGameRankingRangeDates,
  resolveGameRankingRange,
  writeGameRankingRangeDates,
} from '../lib/game-ranking-range'
import { ENTERTAINMENT_LEADERBOARDS } from '../lib/entertainment-leaderboard-registry'

function source(path: string) {
  return readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
}

function iso(value: Date) {
  return value.toISOString()
}

test('所有娱乐天空游戏统一显示五个范围，顺序固定为本周、上周、本月、上月、日期', () => {
  assert.deepEqual(
    GAME_RANKING_RANGE_OPTIONS.map((item) => item.key),
    ['this-week', 'last-week', 'this-month', 'last-month', 'date'],
  )
  assert.deepEqual(
    GAME_RANKING_RANGE_OPTIONS.map((item) => item.label),
    ['本周', '上周', '本月', '上月', '日期'],
  )
  assert.equal(ENTERTAINMENT_LEADERBOARDS.length, 6)
  assert.ok(ENTERTAINMENT_LEADERBOARDS.every((item) => item.ranges.map((range) => range.key).join(',') === 'this-week,last-week,this-month,last-month,date'))
  const rankable = ENTERTAINMENT_LEADERBOARDS.filter((item) => item.source !== null)
  assert.ok(rankable.length > 0)
  assert.ok(rankable.every((item) => item.ranges.map((range) => range.key).join(',') === 'this-week,last-week,this-month,last-month,date'))
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

test('上周是完整的上一个上海自然周，并与本周使用相同周界', () => {
  const now = new Date('2026-11-02T02:00:00.000Z') // Shanghai Monday, 10:00
  const current = resolveGameRankingRange({ range: 'this-week', now })
  const previous = resolveGameRankingRange({ range: 'last-week', now })
  assert.equal(iso(current.startAt), '2026-11-01T16:00:00.000Z')
  assert.equal(iso(previous.startAt), '2026-10-25T16:00:00.000Z')
  assert.equal(iso(previous.endAt), iso(current.startAt))
  assert.equal(previous.startDate, '2026-10-26')
  assert.equal(previous.endDate, '2026-11-01')
  assert.equal(previous.periodKey, '2026-10-26')
  assert.equal(previous.endAt.getTime() - previous.startAt.getTime(), 7 * 86_400_000)
  assert.equal(parseGameRankingRangeKey('LAST_WEEK'), 'last-week')
})

test('上周正确覆盖跨年自然周', () => {
  const previous = resolveGameRankingRange({ range: 'last-week', now: new Date('2026-01-05T04:00:00.000Z') })
  assert.equal(previous.startDate, '2025-12-29')
  assert.equal(previous.endDate, '2026-01-04')
  assert.equal(iso(previous.startAt), '2025-12-28T16:00:00.000Z')
  assert.equal(iso(previous.endAt), '2026-01-04T16:00:00.000Z')
})

test('日期榜使用 [startAt,endAt) 单日边界，并返回稳定缓存键', () => {
  const range = resolveGameRankingRange({ range: 'date', date: '2026-08-31', now: new Date('2026-09-01T00:30:00.000Z') })
  assert.equal(iso(range.startAt), '2026-08-30T16:00:00.000Z')
  assert.equal(iso(range.endAt), '2026-08-31T16:00:00.000Z')
  assert.equal(range.date, '2026-08-31')
  assert.equal(range.startDate, '2026-08-31')
  assert.equal(range.endDate, '2026-08-31')
  assert.equal(range.cacheKey, 'date:2026-08-31')
  assert.equal(range.endAt.getTime() > range.startAt.getTime(), true)
})

test('自定义多日区间包含结束日全天，跨月结束边界为次日零点', () => {
  const range = resolveGameRankingRange({
    range: 'date',
    startDate: '2026-10-25',
    endDate: '2026-11-01',
    now: new Date('2026-11-02T02:00:00.000Z'),
  })
  assert.equal(iso(range.startAt), '2026-10-24T16:00:00.000Z')
  assert.equal(iso(range.endAt), '2026-11-01T16:00:00.000Z') // 2026-11-02 00:00 Shanghai
  assert.equal(range.periodKey, '2026-10-25..2026-11-01')
  assert.equal(range.date, null)
  assert.equal(range.label, '2026/10/25 — 2026/11/01')
  const lastInstantOfEndDate = new Date('2026-11-01T15:59:59.999Z')
  assert.ok(lastInstantOfEndDate >= range.startAt && lastInstantOfEndDate < range.endAt)
  const firstInstantOfFollowingDate = new Date('2026-11-01T16:00:00.000Z')
  assert.ok(!(firstInstantOfFollowingDate >= range.startAt && firstInstantOfFollowingDate < range.endAt))
})

test('自定义区间覆盖单日、跨年，并拒绝逆序、未来、不完整和非法日期', () => {
  const now = new Date('2026-11-02T02:00:00.000Z')
  const sameDay = resolveGameRankingRange({ range: 'date', startDate: '2026-11-01', endDate: '2026-11-01', now })
  assert.equal(sameDay.date, '2026-11-01')
  assert.equal(sameDay.cacheKey, 'date:2026-11-01')
  assert.equal(iso(sameDay.endAt), '2026-11-01T16:00:00.000Z')

  const yearBoundary = resolveGameRankingRange({ range: 'date', startDate: '2025-12-31', endDate: '2026-01-01', now })
  assert.equal(yearBoundary.label, '2025/12/31 — 2026/01/01')
  assert.equal(iso(yearBoundary.endAt), '2026-01-01T16:00:00.000Z')

  const expectCode = (params: Parameters<typeof resolveGameRankingRange>[0], code: string) => assert.throws(
    () => resolveGameRankingRange({ ...params, now }),
    (error: unknown) => error instanceof GameRankingRangeError && error.code === code,
  )
  expectCode({ range: 'date', startDate: '2026-11-02', endDate: '2026-11-01' }, 'INVALID_DATE_RANGE')
  expectCode({ range: 'date', startDate: '2026-11-01', endDate: '2026-11-03' }, 'FUTURE_DATE')
  expectCode({ range: 'date', startDate: '2026-11-01' }, 'INVALID_DATE_RANGE')
  expectCode({ range: 'date', startDate: '2026/10/25', endDate: '2026-10-26' }, 'INVALID_DATE')
})

test('URL 日期范围支持刷新恢复、游戏切换保留和旧 date 单日参数', () => {
  const legacy = readGameRankingRangeDates(new URLSearchParams('date=2026-11-01'))
  assert.deepEqual(legacy, { startDate: '2026-11-01', endDate: '2026-11-01' })
  const restored = readGameRankingRangeDates(new URLSearchParams('startDate=2026-10-25&endDate=2026-11-01'))
  assert.deepEqual(restored, { startDate: '2026-10-25', endDate: '2026-11-01' })
  const partial = readGameRankingRangeDates(new URLSearchParams('startDate=2026-10-25'))
  assert.deepEqual(partial, { startDate: '2026-10-25', endDate: null })

  const params = new URLSearchParams('game=WANT_LISTEN&range=date')
  writeGameRankingRangeDates(params, 'date', '2026-10-25', '2026-11-01')
  params.set('game', 'LISTEN')
  assert.equal(params.get('startDate'), '2026-10-25')
  assert.equal(params.get('endDate'), '2026-11-01')
  assert.equal(params.get('date'), null)
  writeGameRankingRangeDates(params, 'this-week', null, null)
  assert.equal(params.get('startDate'), null)
  assert.equal(params.get('endDate'), null)
  assert.equal(params.get('date'), null)
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

test('三个榜单 API 接受 startDate/endDate，所有数据查询仍按 completedAt 服务端筛选', () => {
  const guessRoute = source('app/api/entertainment/guess-song/leaderboard/route.ts')
  const wantRoute = source('app/api/entertainment/want-listen/leaderboard/route.ts')
  const centerRoute = source('app/api/entertainment/leaderboard/route.ts')
  const guessService = source('lib/guess-song-leaderboard.ts')
  const wantService = source('lib/want-listen-leaderboard.ts')
  const rangeTabs = source('components/games/GameRankingRangeTabs.tsx')

  for (const item of [guessRoute, wantRoute, centerRoute]) {
    assert.match(item, /range/)
    assert.match(item, /date/)
    assert.match(item, /startDate/)
    assert.match(item, /endDate/)
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

test('独立榜单页和娱乐天空中心复用范围组件与 URL 状态，旧单日链接仍兼容', () => {
  const guessPage = source('app/entertainment/guess-song/leaderboard/GuessSongLeaderboard.tsx')
  const wantPage = source('app/games/want-listen/WantListenLeaderboard.tsx')
  const center = source('components/games/EntertainmentLeaderboardCenter.tsx')
  for (const item of [guessPage, wantPage, center]) {
    assert.match(item, /GameRankingRangeTabs/)
    assert.match(item, /pushState/)
  }
  assert.match(guessPage, /writeGameRankingRangeDates/)
  assert.match(wantPage, /writeGameRankingRangeDates/)
  assert.match(center, /writeGameRankingRangeDates/)
  assert.match(center, /setGameKey\(nextGame\.gameKey\)/)
  assert.match(center, /nextGame\.ranges\.some\(\(item\) => item\.key === range\)/)
  assert.match(source('lib/game-ranking-range.ts'), /readGameRankingRangeDates/)
  assert.match(guessPage, /暂无榜单数据/)
})
