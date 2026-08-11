import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { buildGuessSongModeHighScores, type GuessSongModeHighScore } from '../lib/guess-song-leaderboard'
import type { GuessSongPublicMode } from '../lib/guess-song-config'

function source(path: string) {
  return readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
}

function score(mode: GuessSongPublicMode, value: number, userId = `${mode.toLowerCase()}-user`): GuessSongModeHighScore {
  const user = {
    id: userId,
    uid: 10001,
    username: `${mode.toLowerCase()}-username`,
    displayName: `${mode} display name`,
    nickname: `${mode} nickname`,
    name: `${mode} display name`,
    avatarUrl: `https://cdn.example.test/${mode.toLowerCase()}.png`,
  }
  return {
    mode,
    score: value,
    correctCount: 10,
    maxStreak: 10,
    totalPlayCount: 1,
    achievedAt: '2026-08-12T00:00:00.000Z',
    userId,
    uid: user.uid,
    username: user.username,
    displayName: user.displayName,
    nickname: user.name,
    avatarUrl: user.avatarUrl,
    user,
  }
}

test('四个模式分别保留历史最高记录及其对应用户', () => {
  const result = buildGuessSongModeHighScores([
    score('EASY', 12540),
    score('ADVANCED', 9800),
    score('HARD', 7200),
    score('EXPERT', 13800),
  ])

  assert.equal(result.status, 'ready')
  assert.equal(result.modes.EASY?.score, 12540)
  assert.equal(result.modes.EXPERT?.score, 13800)
  assert.equal(result.modes.EXPERT?.userId, result.modes.EXPERT?.user.id)
  assert.equal(result.modes.EXPERT?.user.name, 'EXPERT display name')
  assert.equal(result.modes.EXPERT?.user.avatarUrl, 'https://cdn.example.test/expert.png')
})

test('移动端从四模式中取分数最大的一条，最高分用户与分数来自同一记录', () => {
  const result = buildGuessSongModeHighScores([
    score('EASY', 100, 'easy-user'),
    score('ADVANCED', 800, 'advanced-user'),
    score('HARD', 300, 'hard-user'),
    score('EXPERT', 1200, 'expert-user'),
  ])

  assert.equal(result.mobileBest?.mode, 'EXPERT')
  assert.equal(result.mobileBest?.score, 1200)
  assert.equal(result.mobileBest?.userId, 'expert-user')
  assert.equal(result.mobileBest?.user.id, 'expert-user')
})

test('移动端同分按简单、进阶、困难、专家的固定顺序稳定选择', () => {
  const result = buildGuessSongModeHighScores([
    score('EXPERT', 1000, 'expert-user'),
    score('EASY', 1000, 'easy-user'),
    score('HARD', 1000, 'hard-user'),
  ])

  assert.equal(result.mobileBest?.mode, 'EASY')
  assert.equal(result.mobileBest?.userId, 'easy-user')
})

test('部分模式无成绩时保留其它模式，全部无成绩才是 empty', () => {
  const partial = buildGuessSongModeHighScores([score('EASY', 1000)])
  assert.equal(partial.status, 'ready')
  assert.equal(partial.mobileBest?.mode, 'EASY')
  assert.equal(partial.modes.ADVANCED, null)
  assert.equal(partial.modes.HARD, null)
  assert.equal(partial.modes.EXPERT, null)

  const empty = buildGuessSongModeHighScores([])
  assert.equal(empty.status, 'empty')
  assert.equal(empty.mobileBest, null)
  assert.equal(empty.modes.EASY, null)
  assert.equal(empty.modes.EXPERT, null)
})

test('首页消费历史四模式 service，区分查询失败并使用 no-store 请求', () => {
  const homeData = source('lib/home-data.ts')
  const service = source('lib/guess-song-leaderboard.ts')
  const surface = source('components/HomeLayoutSurface.tsx')
  const route = source('app/api/home/entertainment-ranking/route.ts')
  const styles = source('app/globals.css')

  assert.match(homeData, /getGuessSongModeHighScores\(userId\)/)
  assert.doesNotMatch(homeData, /getGuessSongPersonalBest\(\{ userId, mode:/)
  assert.match(service, /periodKey: 'ALL'/)
  assert.match(service, /emptyGuessSongModeHighScores\('unavailable'\)/)
  assert.match(service, /User: \{\s*select:/)
  assert.match(service, /\{ score: 'desc' \}/)
  assert.match(surface, /home-entertainment-desktop-scores/)
  assert.match(surface, /home-entertainment-mobile-score/)
  assert.match(surface, /<SafeAvatar/)
  assert.match(surface, /status === 'unavailable'/)
  assert.match(route, /dynamic = 'force-dynamic'/)
  assert.match(route, /Cache-Control.*no-store/)
  assert.match(styles, /home-entertainment-score-username[^\n]*text-overflow:ellipsis/)
})
