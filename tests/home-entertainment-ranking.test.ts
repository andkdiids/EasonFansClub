import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { buildGuessSongModeHighScores, type GuessSongModeHighScore } from '../lib/guess-song-leaderboard'
import type { GuessSongPublicMode } from '../lib/guess-song-config'
import { getRankableEntertainmentLeaderboardTargets } from '../lib/entertainment-leaderboard-registry'

function source(path: string) {
  return readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
}

function score(mode: GuessSongPublicMode, value: number, userId = `${mode.toLowerCase()}-user`): GuessSongModeHighScore {
  const user = {
    id: userId,
    uid: 10001,
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

test('首页消费 registry 中所有公开榜单的 THIS_WEEK 榜首，区分查询失败并使用 no-store 请求', () => {
  const homeData = source('lib/home-data.ts')
  const service = source('lib/entertainment-leaderboard.ts')
  const registry = source('lib/entertainment-leaderboard-registry.ts')
  const surface = source('components/HomeLayoutSurface.tsx')
  const route = source('app/api/home/entertainment-ranking/route.ts')
  const styles = source('app/globals.css')

  assert.match(homeData, /getEntertainmentLeaderboard/)
  assert.match(homeData, /getRankableEntertainmentLeaderboardTargets/)
  assert.match(homeData, /range: 'THIS_WEEK'/)
  assert.match(homeData, /periodType: 'THIS_WEEK'/)
  assert.doesNotMatch(homeData, /getGuessSongModeHighScores\(\)/)
  assert.match(service, /resolveGameRankingRange/)
  assert.match(registry, /getRankableEntertainmentLeaderboardTargets/)
  assert.deepEqual(getRankableEntertainmentLeaderboardTargets().map((item) => item.key), [
    'WANT_LISTEN',
    'CANTONESE_FRAGMENT',
    'FALSE_TITLE',
    'LISTEN:EASY',
    'LISTEN:ADVANCED',
    'LISTEN:HARD',
    'LISTEN:EXPERT',
  ])
  assert.match(surface, /home-entertainment-ranking-list/)
  assert.match(surface, /homeText\.rankingBest/)
  assert.match(surface, /暂无成绩/)
  assert.match(surface, /<SafeAvatar/)
  assert.match(surface, /status === 'unavailable'/)
  assert.match(route, /dynamic = 'force-dynamic'/)
  assert.match(route, /Cache-Control.*no-store/)
  assert.match(styles, /grid-template-columns: repeat\(3, minmax\(0, 1fr\)\)/)
  assert.match(styles, /home-entertainment-mode-empty/)
})

test('首页娱乐天空排行玩家列只显示固定头像和昵称，并为长昵称保留分数列', () => {
  const surface = source('components/HomeLayoutSurface.tsx')
  const styles = source('app/globals.css')
  const playerStart = surface.indexOf('function EntertainmentScoreUser')
  const playerEnd = surface.indexOf('function HomeDailyMusicPreview', playerStart)
  assert.ok(playerStart >= 0)
  assert.ok(playerEnd > playerStart)

  const player = surface.slice(playerStart, playerEnd)
  assert.match(player, /<SafeAvatar/)
  assert.match(player, /home-entertainment-score-avatar-slot/)
  assert.match(player, /home-entertainment-score-avatar-fallback/)
  assert.match(player, /home-entertainment-score-name"[^>]*>\{name\}<\/Link>/)
  assert.match(player, /title=\{name\}/)
  assert.doesNotMatch(player, /home-entertainment-score-user|UserDisplayName|equippedBadge|Badge|badge/)
  assert.match(surface, /home-entertainment-player-cell home-entertainment-score-cell/)
  assert.match(surface, /ranking\.modes\.map/)
  assert.match(surface, /fmt\(item\.score\)/)

  assert.match(styles, /\.home-secondary-columns \.home-entertainment-mode-score \{[\s\S]*grid-template-columns: 72px minmax\(0, 1fr\) 72px;/)
  assert.match(styles, /\.home-secondary-columns \.home-entertainment-player-cell \{[\s\S]*display: grid;[\s\S]*grid-column: 2;[\s\S]*grid-template-columns: 20px minmax\(0, 1fr\);[\s\S]*align-items: center;[\s\S]*column-gap: 6px;[\s\S]*width: 100%;[\s\S]*min-width: 0;/)
  assert.match(styles, /\.home-secondary-columns \.home-entertainment-score-avatar-slot \{[\s\S]*display: flex;[\s\S]*align-items: center;[\s\S]*justify-content: center;[\s\S]*width: 20px;[\s\S]*min-width: 20px;[\s\S]*max-width: 20px;[\s\S]*height: 20px;[\s\S]*min-height: 20px;[\s\S]*max-height: 20px;[\s\S]*aspect-ratio: 1 \/ 1;[\s\S]*margin: 0;[\s\S]*transform: none;/)
  assert.match(styles, /\.home-secondary-columns \.home-entertainment-score-avatar-slot > \* \{[\s\S]*width: 100%;[\s\S]*height: 100%;[\s\S]*margin: 0;[\s\S]*transform: none;/)
  assert.match(styles, /\.home-secondary-columns \.home-entertainment-score-name \{[\s\S]*display: block;[\s\S]*grid-column: 2;[\s\S]*min-width: 0;[\s\S]*width: 100%;[\s\S]*margin: 0;[\s\S]*overflow: hidden;[\s\S]*line-height: 1\.2;[\s\S]*text-overflow: ellipsis;[\s\S]*white-space: nowrap;/)
  assert.match(styles, /\.home-secondary-columns \.home-entertainment-player-cell > \.home-entertainment-mode-empty \{[\s\S]*grid-column: 1 \/ -1;/)
  assert.doesNotMatch(styles, /home-entertainment-score-user/)
  assert.match(styles, /\.home-secondary-columns \.home-entertainment-mode-score-value \{[\s\S]*justify-self: end;[\s\S]*text-align: right;[\s\S]*white-space: nowrap;/)
  assert.match(styles, /@media \(max-width:767px\) \{[\s\S]*grid-template-columns: 36px minmax\(0, 1fr\) 60px;/)
})
