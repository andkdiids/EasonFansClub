import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { getWantListenPeriod, parseWantListenLeaderboardPeriod } from '../lib/want-listen-period'
import {
  ENTERTAINMENT_LEADERBOARDS,
  getEntertainmentLeaderboardDefinition,
} from '../lib/entertainment-leaderboard-registry'

const read = (path: string) => readFileSync(path, 'utf8')

function iso(value: Date | null) {
  return value?.toISOString()
}

test('想听月榜使用北京时间自然月，并包含完整月份边界', () => {
  const august = getWantListenPeriod('MONTH', new Date('2026-08-31T15:59:59Z'))
  assert.equal(august.periodKey, '2026-08')
  assert.equal(iso(august.start), '2026-07-31T16:00:00.000Z')
  assert.equal(iso(august.endExclusive), '2026-08-31T16:00:00.000Z')

  const september = getWantListenPeriod('MONTH', new Date('2026-08-31T16:00:00Z'))
  assert.equal(september.periodKey, '2026-09')
  assert.equal(iso(september.start), '2026-08-31T16:00:00.000Z')
  assert.equal(iso(september.endExclusive), '2026-09-30T16:00:00.000Z')
})

test('想听月榜正确处理 28/29/30/31 天及跨年月份', () => {
  const cases = [
    ['2025-02-15T04:00:00Z', '2025-02-28T16:00:00.000Z'],
    ['2028-02-15T04:00:00Z', '2028-02-29T16:00:00.000Z'],
    ['2026-04-15T04:00:00Z', '2026-04-30T16:00:00.000Z'],
    ['2026-01-15T04:00:00Z', '2026-01-31T16:00:00.000Z'],
    ['2025-12-31T16:00:00Z', '2026-01-31T16:00:00.000Z'],
  ] as const
  for (const [value, expectedEnd] of cases) {
    assert.equal(iso(getWantListenPeriod('MONTH', new Date(value)).endExclusive), expectedEnd)
  }
  assert.equal(parseWantListenLeaderboardPeriod('MONTH'), 'MONTH')
})

test('月榜边界采用左闭右开，月初包含、下月月初排除', () => {
  const range = getWantListenPeriod('MONTH', new Date('2026-08-20T04:00:00Z'))
  assert.ok(range.start && range.endExclusive)
  const before = new Date(range.start!.getTime() - 1)
  const atStart = range.start!
  const atEnd = range.endExclusive!
  assert.ok(before < range.start!)
  assert.ok(atStart >= range.start! && atStart < range.endExclusive!)
  assert.ok(!(atEnd >= range.start! && atEnd < range.endExclusive!))
})

test('想听月榜保持原有成绩字段与排序规则', () => {
  const period = read('lib/want-listen-period.ts')
  const leaderboard = read('lib/want-listen-leaderboard.ts')
  assert.match(period, /compareWantListenScores/)
  assert.match(period, /right\.score - left\.score/)
  assert.match(period, /right\.correctCount - left\.correctCount/)
  assert.match(period, /right\.maxStreak - left\.maxStreak/)
  assert.match(period, /left\.completionTimeMs - right\.completionTimeMs/)
  assert.match(period, /left\.achievedAt\.getTime\(\) - right\.achievedAt\.getTime\(\)/)
  assert.match(leaderboard, /getWantListenLeaderboardSourceRows/)
  assert.match(leaderboard, /period\.start/)
  assert.match(leaderboard, /ROW_NUMBER\(\) OVER/)
  assert.match(leaderboard, /s\.completedAt >= \$\{input\.start\}/)
  assert.match(leaderboard, /s\.completedAt < \$\{input\.endExclusive\}/)
  assert.match(leaderboard, /s\.score DESC[\s\S]*s\.correctCount DESC[\s\S]*s\.maxStreak DESC/)
  assert.match(leaderboard, /LIMIT \$\{input\.limit \+ 1\}/)
})

test('统一 registry 将想听置于顶层，且不注册想听自模式', () => {
  const wantListen = getEntertainmentLeaderboardDefinition('WANT_LISTEN')
  assert.ok(wantListen)
  assert.equal(wantListen.modes, null)
  assert.equal(wantListen.defaultMode, null)
  assert.deepEqual(wantListen.periods.map((item) => item.key), ['DAY', 'WEEK', 'MONTH', 'ALL'])
  assert.equal(wantListen.sourceMode, 'WANT_LISTEN')
  assert.equal(wantListen.periods.some((item) => item.key === 'MONTH'), true)

  assert.equal(wantListen.modes, null, '想听不能出现自模式选择器')

  const listen = getEntertainmentLeaderboardDefinition('LISTEN')
  assert.ok(listen)
  assert.deepEqual(listen.modes?.map((item) => item.key), ['EASY', 'ADVANCED', 'HARD', 'EXPERT'])
  assert.deepEqual(listen.periods.map((item) => item.key), ['WEEK', 'MONTH', 'YEAR'])
})

test('正式游戏和无排行榜游戏都注册到统一中心', () => {
  assert.deepEqual(
    ENTERTAINMENT_LEADERBOARDS.map((item) => item.gameKey),
    ['WANT_LISTEN', 'CANTONESE_FRAGMENT', 'FALSE_TITLE', 'LISTEN', 'LISTEN_DUEL', 'UNDERCOVER_STAR'],
  )
  const unavailable = ENTERTAINMENT_LEADERBOARDS.filter((item) => item.source === null)
  assert.deepEqual(unavailable.map((item) => item.name), ['听听 1v1', '卧底巨星'])
  assert.ok(unavailable.every((item) => item.periods.length === 0))
})

test('首页和游戏内部榜单都复用现有 leaderboard service，首页只请求当前选择项', () => {
  const center = read('components/games/EntertainmentLeaderboardCenter.tsx')
  const home = read('components/games/GameCenter.tsx')
  const adapter = read('lib/entertainment-leaderboard.ts')
  const wantPage = read('app/games/want-listen/WantListenLeaderboard.tsx')
  const guessPage = read('app/entertainment/guess-song/leaderboard/GuessSongLeaderboard.tsx')
  assert.match(home, /<EntertainmentLeaderboardCenter \/>/)
  assert.match(center, /fetch\(`\/api\/entertainment\/leaderboard\?\$\{params\.toString\(\)\}`/)
  assert.doesNotMatch(center, /cacheKey\(gameKey, mode, period\)/)
  assert.doesNotMatch(center, /cache\.current/)
  assert.doesNotMatch(center, /Promise\.all\(/)
  assert.match(adapter, /getWantListenLeaderboard/)
  assert.match(adapter, /getGuessSongLeaderboard/)
  assert.match(wantPage, /\/api\/entertainment\/want-listen\/leaderboard/)
  assert.match(guessPage, /\/api\/entertainment\/guess-song\/leaderboard/)
  assert.match(adapter, /getWantListenLeaderboard\(/)
  assert.match(adapter, /getGuessSongLeaderboard\(/)
})

test('统一榜单提供 Top10、空榜、未开放、错误和移动端布局状态', () => {
  const center = read('components/games/EntertainmentLeaderboardCenter.tsx')
  const styles = read('app/globals.css')
  assert.match(center, /slice\(0, 10\)/)
  assert.match(center, /暂无排行榜数据/)
  assert.match(center, /该游戏暂未开放排行榜/)
  assert.match(center, /排行榜加载中/)
  assert.match(center, /排行榜加载失败，请稍后重试/)
  assert.match(center, /UID \{String\(row\.user\.uid\)\.padStart\(5, '0'\)\}/)
  assert.match(center, /重试/)
  assert.match(styles, /\.entertainment-leaderboard-tabs[^\n]*overflow-x:auto/)
  assert.match(styles, /\.entertainment-leaderboard-tabs::-webkit-scrollbar[^\n]*display:none/)
  assert.match(styles, /\.entertainment-leaderboard-row \{[^}]*grid-template-columns:64px/)
  assert.match(styles, /\.entertainment-leaderboard-row \{ grid-template-columns:42px minmax\(0,1fr\) 78px/)
})

test('想听原榜新增月榜按钮，Hero 以容器高度压缩而非 transform 缩放', () => {
  const wantPage = read('app/games/want-listen/WantListenLeaderboard.tsx')
  const styles = read('app/globals.css')
  assert.match(wantPage, /\['MONTH', '本月'\]/)
  assert.match(styles, /\.game-banner \{[\s\S]*height:140px;[\s\S]*min-height:140px;/)
  assert.match(styles, /\.game-banner-copy \{[\s\S]*padding:10px clamp\(20px,3vw,32px\)/)
  assert.match(styles, /@media \(max-width:767px\)[\s\S]*\.game-banner \{ height:160px; min-height:160px;/)
  assert.doesNotMatch(styles, /\.game-banner[^}]*transform:\s*scale\(\.5\)/)
  assert.doesNotMatch(styles, /\.game-banner[^}]*transform:\s*scale\(0\.5\)/)
})

test('统一榜单 API 仅接受 game/mode/period，服务端固定 Top10 且 no-store', () => {
  const route = read('app/api/entertainment/leaderboard/route.ts')
  assert.match(route, /params\.get\('game'\)/)
  assert.match(route, /params\.get\('mode'\)/)
  assert.match(route, /params\.get\('period'\)/)
  assert.match(route, /limit: 10/)
  assert.match(route, /Cache-Control': 'private, no-store'/)
  assert.match(route, /requireUser\(\)/)
})
