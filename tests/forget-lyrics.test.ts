import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import {
  aggregateForgetLyricsEvents,
  FORGET_LYRICS_SKIPPED_OPTION,
  isForgetLyricsWrongAnswer,
  parseForgetLyricsLimit,
  selectForgetLyricsAggregates,
  TINGTING_SOURCE_SESSION_TYPE,
} from '../lib/forget-lyrics'

function source(path: string) {
  return readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
}

function event(input: Partial<Parameters<typeof isForgetLyricsWrongAnswer>[0]> = {}) {
  return {
    sourceSessionType: TINGTING_SOURCE_SESSION_TYPE,
    gameMode: 'EASY',
    songId: 'song-a',
    isCorrect: false,
    selectedOptionKey: 'wrong-option',
    answeredAt: new Date('2026-09-17T01:00:00.000Z'),
    ...input,
  }
}

test('忘记歌词只接受普通听听 GuessSongSession 的服务端错答', () => {
  assert.equal(isForgetLyricsWrongAnswer(event()), true)
  assert.equal(isForgetLyricsWrongAnswer(event({ isCorrect: true })), false)
  assert.equal(isForgetLyricsWrongAnswer(event({ selectedOptionKey: FORGET_LYRICS_SKIPPED_OPTION })), false)
  assert.equal(isForgetLyricsWrongAnswer(event({ sourceSessionType: 'GuessSongDuelMatch' })), false)
  assert.equal(isForgetLyricsWrongAnswer(event({ sourceSessionType: 'WantListenSession' })), false)
  assert.equal(isForgetLyricsWrongAnswer(event({ sourceSessionType: 'MakeupChallenge' })), false)
  assert.equal(isForgetLyricsWrongAnswer(event({ gameMode: 'FUTURE_SONG_GAME' })), false)
  assert.equal(isForgetLyricsWrongAnswer(event({ songId: null })), false)
  assert.equal(isForgetLyricsWrongAnswer(event({ answeredAt: null })), false)
})

test('同一首歌按真实听听错答事件累计，答对不减少且同日只保留一张聚合卡', () => {
  const rows = aggregateForgetLyricsEvents([
    event({ answeredAt: new Date('2026-09-15T01:00:00.000Z') }),
    event({ answeredAt: new Date('2026-09-17T01:00:00.000Z') }),
    event({ answeredAt: new Date('2026-09-17T02:00:00.000Z') }),
    event({ answeredAt: new Date('2026-09-17T03:00:00.000Z') }),
    event({ isCorrect: true, answeredAt: new Date('2026-09-17T04:00:00.000Z') }),
  ], '2026-09-17')

  assert.equal(rows.length, 1)
  assert.equal(rows[0].wrongCount, 4)
  assert.equal(rows[0].todayWrongCount, 3)
  assert.equal(rows[0].wrongCountByDate['2026-09-15'], 1)
  assert.equal(rows[0].wrongCountByDate['2026-09-17'], 3)
})

test('首页最多五首且排序稳定：今日次数、历史累计、最近时间、稳定 ID', () => {
  const rows = Array.from({ length: 8 }, (_, index) => event({
    songId: `song-${String(index + 1).padStart(2, '0')}`,
    answeredAt: new Date('2026-09-17T10:00:00.000Z'),
  }))
  rows.push(event({ songId: 'song-01', answeredAt: new Date('2026-09-17T10:00:00.000Z') }))
  rows.push(event({ songId: 'song-01', answeredAt: new Date('2026-09-17T10:00:00.000Z') }))

  const aggregates = aggregateForgetLyricsEvents(rows, '2026-09-17')
  const selected = selectForgetLyricsAggregates(aggregates, 'today', 'recent', '2026-09-17', 5, true)
  assert.equal(selected.length, 5)
  assert.equal(selected[0].songId, 'song-01')
  assert.deepEqual(selected.map((row) => row.songId), ['song-01', 'song-02', 'song-03', 'song-04', 'song-05'])
  assert.deepEqual(selectForgetLyricsAggregates(aggregates, 'today', 'recent', '2026-09-17', 5, true).map((row) => row.songId), selected.map((row) => row.songId))
})

test('近七天按日期过滤，全部页的错过次数仍是历史累计', () => {
  const aggregates = aggregateForgetLyricsEvents([
    event({ songId: 'song-a', answeredAt: new Date('2026-09-09T16:00:00.000Z') }),
    event({ songId: 'song-a', answeredAt: new Date('2026-09-11T16:00:00.000Z') }),
    event({ songId: 'song-a', answeredAt: new Date('2026-09-17T01:00:00.000Z') }),
    event({ songId: 'song-b', answeredAt: new Date('2026-09-10T16:00:00.000Z') }),
  ], '2026-09-17')

  const sevenDays = selectForgetLyricsAggregates(aggregates, '7d', 'recent', '2026-09-17')
  assert.deepEqual(sevenDays.map((row) => row.songId), ['song-a', 'song-b'])
  assert.equal(aggregates.find((row) => row.songId === 'song-a')?.wrongCount, 3)
  assert.equal(aggregates.find((row) => row.songId === 'song-a')?.wrongCountByDate['2026-09-10'], 1)
})

test('实现没有接入全局错答 hook，且 API 仅查询本人听听历史', () => {
  const service = source('lib/forget-lyrics.ts')
  const route = source('app/api/entertainment/forget-lyrics/route.ts')
  const client = source('components/games/ForgetLyrics.tsx')
  const query = service.slice(service.indexOf('prisma.guessSongSessionQuestion.findMany'), service.indexOf('}) as ForgetLyricsEventRow[]'))
  assert.match(service, /guessSongSessionQuestion\.findMany/)
  assert.match(service, /answeredAt: \{ not: null \}/)
  assert.match(service, /isCorrect: false/)
  assert.match(service, /mode: \{ in: \[\.\.\.TINGTING_SESSION_MODES\] \}/)
  assert.match(service, /GuessSongQuestion: \{ musicSongId: \{ not: null \} \}/)
  assert.match(service, /answeredAt: null/)
  assert.match(service, /status: \{ in: \['IN_PROGRESS', 'PAUSED'\] \}/)
  assert.match(route, /requireRequestUser\(request\)/)
  assert.match(route, /userId: guard\.user\.id/)
  assert.match(route, /'Cache-Control': 'private, no-store/)
  assert.match(client, /useMusicPlayer/)
  assert.match(client, /\/music\/song\/\$\{encodeURIComponent\(song\.id\)\}/)
  assert.doesNotMatch(query, /GuessSongDuelAnswer|MakeupChallenge|WantListenQuestion/)
})

test('首页限制默认只在显式传入时生效，完整历史页不会被缺省值截断', () => {
  assert.equal(parseForgetLyricsLimit(null), undefined)
  assert.equal(parseForgetLyricsLimit('5'), 5)
  assert.equal(parseForgetLyricsLimit('99'), 5)
  assert.equal(parseForgetLyricsLimit('-1'), undefined)
})

test('听听一级操作区提供忘记歌词入口，移动端同步提供且返回听听', () => {
  const detail = source('components/games/GuessSongDetail.tsx')
  const page = source('components/games/ForgetLyrics.tsx')
  const styles = source('app/globals.css')
  assert.match(detail, /<a href="#history">历史记录<\/a>\s*<Link href="\/games\/forget-lyrics">忘记歌词<\/Link>/)
  assert.equal((detail.match(/<Link href="\/games\/forget-lyrics">忘记歌词<\/Link>/g) || []).length, 2)
  assert.match(page, /href="\/games\/guess-song" className="forget-lyrics-back">← 返回听听/)
  assert.match(styles, /\.game-detail-mobile-top \{[^}]*flex-wrap:wrap/)
})
