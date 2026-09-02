import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import {
  calculateGuessSongAdminCompensation,
  GuessSongAdminLeaderboardError,
  GUESS_SONG_ADMIN_MAX_CORRECT_ANSWERS,
} from '../lib/guess-song-admin-leaderboard'
import { collectGuessSongDeletedSessionIds } from '../lib/guess-song-leaderboard'
import { getGuessSongPeriod } from '../lib/guess-song-period'

const root = process.cwd()
const source = (path: string) => readFileSync(`${root}/${path}`, 'utf8')

test('sticker long-press preview is portaled and does not participate in the grid layout', () => {
  const picker = source('components/StickerPicker.tsx')
  assert.match(picker, /createPortal\(previewLayer, document\.body\)/)
  assert.match(picker, /position:\s*'fixed'/)
  assert.match(picker, /getBoundingClientRect\(\)/)
  assert.match(picker, /setTimeout\(\(\) =>[\s\S]*?500\)/)
  assert.doesNotMatch(picker, /previewing\?\s*\(/)
})

test('feedback notification formats the submission time in Beijing local time', () => {
  const route = source('app/api/feedback/route.ts')
  assert.match(route, /formatBeijingMonthDayTime\(now\)/)
  assert.doesNotMatch(route, /提交时间：\$\{now\.toISOString\(\)\}/)
})

test('guess-song uses a sliding inactivity deadline and settles expired confirmed scores', () => {
  const session = source('lib/guess-song-session.ts')
  const leaderboard = source('lib/guess-song-leaderboard.ts')
  assert.match(session, /expiresAt: sessionExpiry\(playable\.sessionQuestion\.GuessSongSession\.mode, now\)/)
  assert.match(session, /expiresAt: sessionExpiry\(question\.GuessSongSession\.mode, now\)/)
  assert.match(session, /data: \{ status: 'EXPIRED', completedAt: now, activeKey: null \}/)
  assert.match(session, /if \(expired\.count === 1\) await recordGuessSongLeaderboard\(sessionId, tx\)/)
  assert.match(leaderboard, /\['COMPLETED', 'EXPIRED'\]/)
  assert.match(leaderboard, /s\.status IN \('COMPLETED', 'EXPIRED'\)/)
})

test('guess-song leaderboard admin actions are permissioned, rule-based and audited', () => {
  const route = source('app/api/admin/entertainment/guess-song/leaderboard/route.ts')
  const service = source('lib/guess-song-admin-leaderboard.ts')
  const ui = source('app/admin/entertainment/guess-song/GuessSongLeaderboardManager.tsx')
  assert.match(route, /requireAdmin\('entertainment_manage'\)/)
  assert.match(route, /action !== 'ADD_SCORE'/)
  assert.match(service, /calculateGuessSongScore/)
  assert.match(service, /tx\.adminActionLog\.create/)
  assert.match(service, /tx\.\$transaction|prisma\.\$transaction/)
  assert.doesNotMatch(route, /body\?\.score/)
  assert.match(ui, /type="number"/)
  assert.match(ui, /GUESS_SONG_ADMIN_MAX_BONUS_CORRECT_ANSWERS/)
  assert.match(ui, /补回答对题数/)
})

test('guess-song leaderboard administration is a standalone page with all three periods', () => {
  const questionBank = source('app/admin/entertainment/guess-song/page.tsx')
  const leaderboardPage = source('app/admin/entertainment/guess-song/leaderboard/page.tsx')
  const navigation = source('lib/admin-navigation.ts')
  const permissions = source('lib/admin-permission-config.ts')
  const manager = source('app/admin/entertainment/guess-song/GuessSongLeaderboardManager.tsx')
  assert.doesNotMatch(questionBank, /GuessSongLeaderboardManager/)
  assert.match(leaderboardPage, /GuessSongLeaderboardManager/)
  assert.match(leaderboardPage, /guess-song\/leaderboard/)
  assert.match(navigation, /guess-song\/leaderboard/)
  assert.match(permissions, /'\/admin\/entertainment\/guess-song\/leaderboard': 'entertainment_manage'/)
  assert.match(manager, /type Period = 'WEEK' \| 'MONTH' \| 'YEAR'/)
  assert.match(manager, /value: 'YEAR'/)
})

test('补分上限放宽但仍只接受合法整数，且每十题连击奖励保持不变', () => {
  assert.ok(GUESS_SONG_ADMIN_MAX_CORRECT_ANSWERS >= 1000)
  const compensation = calculateGuessSongAdminCompensation({ mode: 'EASY', correctAnswers: 21, startingStreak: 0 })
  assert.equal(compensation.baseScore, 2100)
  assert.equal(compensation.comboBonus, 540)
  assert.equal(compensation.totalScore, 2640)

  for (const correctAnswers of [20, 21, 50, 100, 200, 500, GUESS_SONG_ADMIN_MAX_CORRECT_ANSWERS]) {
    assert.equal(calculateGuessSongAdminCompensation({ mode: 'EASY', correctAnswers, startingStreak: 0 }).correctAnswers, correctAnswers)
  }
  for (const correctAnswers of [0, -1, 20.5, Number.NaN, Number.POSITIVE_INFINITY, GUESS_SONG_ADMIN_MAX_CORRECT_ANSWERS + 1]) {
    assert.throws(
      () => calculateGuessSongAdminCompensation({ mode: 'EASY', correctAnswers, startingStreak: 0 }),
      GuessSongAdminLeaderboardError,
    )
  }
})

test('补分更新源会话并通过原有记录服务同步周榜月榜，年榜使用同一源数据', () => {
  const service = source('lib/guess-song-admin-leaderboard.ts')
  const leaderboard = source('lib/guess-song-leaderboard.ts')
  assert.match(service, /tx\.guessSongSession\.update\(/)
  assert.match(service, /recordGuessSongLeaderboard\(sourceSession\.id, tx\)/)
  assert.match(service, /const affectedPeriods = \['WEEK', 'MONTH'\]/)
  assert.match(service, /periodType: 'YEAR'/)
  assert.match(leaderboard, /s\.score/)
  assert.match(leaderboard, /getGuessSongDeletedYearSessionIds\(yearKey\)/)
})

test('管理员删除只排除被删源 Session，重建时允许回退到下一条有效成绩且不接受补分日志作为删除', () => {
  const deleted = collectGuessSongDeletedSessionIds([
    {
      action: 'GUESS_SONG_DELETE_SCORE',
      detail: {
        mode: 'EASY',
        periodType: 'WEEK',
        periodKey: '2026-08-24',
        sessionIds: ['highest-session'],
      },
    },
    {
      action: 'GUESS_SONG_ADD_SCORE',
      detail: {
        mode: 'EASY',
        periodType: 'WEEK',
        periodKey: '2026-08-24',
        sourceSessionId: '補分来源不应被删除',
      },
    },
    {
      action: 'GUESS_SONG_DELETE_SCORE',
      detail: {
        mode: 'EASY',
        periodType: 'MONTH',
        periodKey: '2026-08',
        sessionId: 'other-period-session',
      },
    },
  ])
  assert.equal(deleted.has('highest-session'), true)
  assert.equal(deleted.has('fallback-session'), false)
  assert.equal(deleted.has('補分来源不应被删除'), false)

  const service = source('lib/guess-song-admin-leaderboard.ts')
  const leaderboard = source('lib/guess-song-leaderboard.ts')
  assert.match(service, /const source = entries\.reduce\(/)
  assert.match(service, /sessionIds: \[source\.sessionId\]/)
  assert.match(service, /const fallback = await tx\.guessSongSession\.findFirst\(/)
  assert.match(service, /if \(fallback\) await recordGuessSongLeaderboard\(fallback\.id, tx\)/)
  assert.match(service, /getGuessSongDeletedSessionIds\([\s\S]*periodType[\s\S]*periodKey[\s\S]*, tx\)/)
  assert.match(leaderboard, /getGuessSongDeletedSessionIds\([\s\S]*periodType[\s\S]*periodKey/)
  assert.match(leaderboard, /if \(deletedSessionIds\.has\(session\.id\)\) continue/)
  assert.match(leaderboard, /sessionId: \{ notIn: \[\.\.\.deletedSessionIds\] \}/)
})

test('听听周月年周期统一按北京时间计算并在周期切换后使用新 periodKey', () => {
  const instant = new Date('2026-08-12T00:30:00Z')
  assert.equal(getGuessSongPeriod('WEEK', instant).periodKey, '2026-08-10')
  assert.equal(getGuessSongPeriod('MONTH', instant).periodKey, '2026-08')
  assert.equal(getGuessSongPeriod('YEAR', instant).periodKey, '2026')
  assert.equal(getGuessSongPeriod('WEEK', new Date('2026-08-16T15:59:59Z')).periodKey, '2026-08-10')
  assert.equal(getGuessSongPeriod('WEEK', new Date('2026-08-16T16:00:00Z')).periodKey, '2026-08-17')
  assert.equal(getGuessSongPeriod('MONTH', new Date('2026-08-31T15:59:59Z')).periodKey, '2026-08')
  assert.equal(getGuessSongPeriod('MONTH', new Date('2026-08-31T16:00:00Z')).periodKey, '2026-09')
})
