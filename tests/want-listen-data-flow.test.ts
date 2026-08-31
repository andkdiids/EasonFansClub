import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  isWantListenLeaderboardEligibleRecord,
  normalizeWantListenMaxStreak,
  pickBestWantListenRecord,
} from '@/lib/want-listen-score'

const root = join(process.cwd())
function source(relativePath: string) {
  return readFileSync(join(root, relativePath), 'utf8')
}

const leaderboard = source('lib/want-listen-leaderboard.ts')
const admin = source('lib/want-listen-admin-leaderboard.ts')
const game = source('lib/want-listen.ts')
const center = source('components/games/EntertainmentLeaderboardCenter.tsx')

const completed = {
  status: 'COMPLETED',
  antiCheatStatus: 'CLEAN',
  excludedFromLeaderboard: false,
  completedAt: new Date('2026-08-31T00:00:00.000Z'),
  completionTimeMs: 1000,
}

test('排行榜合法性只接受已完成、CLEAN、未排除且有完成时间的 Session', () => {
  assert.equal(isWantListenLeaderboardEligibleRecord(completed), true)
  for (const status of ['EXPIRED', 'ABANDONED', 'IN_PROGRESS']) {
    assert.equal(isWantListenLeaderboardEligibleRecord({ ...completed, status }), false, status)
  }
  assert.equal(isWantListenLeaderboardEligibleRecord({ ...completed, antiCheatStatus: 'SUSPICIOUS' }), false)
  assert.equal(isWantListenLeaderboardEligibleRecord({ ...completed, excludedFromLeaderboard: true }), false)
  assert.equal(isWantListenLeaderboardEligibleRecord({ ...completed, completedAt: null }), false)
  assert.equal(isWantListenLeaderboardEligibleRecord({ ...completed, completionTimeMs: null }), false)
})

test('最高连击区分真实 0、真实非零和无法从历史恢复的未知值', () => {
  assert.equal(normalizeWantListenMaxStreak(12, 20), 12)
  assert.equal(normalizeWantListenMaxStreak(0, 0), 0)
  assert.equal(normalizeWantListenMaxStreak(0, 20), null)
  assert.equal(normalizeWantListenMaxStreak(null, 20), null)

  const best = pickBestWantListenRecord([
    { score: 1000, correctCount: 10, maxStreak: 4, totalQuestions: 20, completionTimeMs: 1200, achievedAt: new Date('2026-08-31T01:00:00.000Z') },
    { score: 2000, correctCount: 15, maxStreak: 7, totalQuestions: 20, completionTimeMs: 1100, achievedAt: new Date('2026-08-31T02:00:00.000Z') },
  ])
  assert.equal(best?.score, 2000)
  assert.equal(best?.correctCount, 15)
  assert.equal(best?.maxStreak, 7)
  assert.equal(best?.totalQuestions, 20)
})

test('所有公开周期从同一 Session 源读取，按用户先选单局最佳且不读取过期成绩', () => {
  assert.match(leaderboard, /getWantListenLeaderboardSourceRows/)
  assert.match(leaderboard, /FROM \\`WantListenSession\\` AS s/)
  assert.match(leaderboard, /s\.status = 'COMPLETED'/)
  assert.match(leaderboard, /s\.antiCheatStatus = 'CLEAN'/)
  assert.match(leaderboard, /s\.excludedFromLeaderboard = FALSE/)
  assert.match(leaderboard, /s\.completedAt IS NOT NULL/)
  assert.match(leaderboard, /s\.completionTimeMs IS NOT NULL/)
  assert.match(leaderboard, /PARTITION BY s\.userId/)
  assert.match(leaderboard, /s\.id ASC/)
  assert.match(leaderboard, /s\.score,\s*s\.correctCount AS correct_count/)
  assert.match(leaderboard, /s\.maxStreak AS max_streak/)
})

test('清空排行榜先排除源 Session 再删除投影，并保留显式恢复/补录入口', () => {
  const exclude = admin.indexOf("data: { excludedFromLeaderboard: true }")
  const deleteProjection = admin.indexOf('tx.wantListenLeaderboardEntry.deleteMany', exclude)
  assert.ok(exclude >= 0)
  assert.ok(deleteProjection > exclude)
  assert.doesNotMatch(admin, /tx\.wantListenSession\.delete/)
  assert.match(admin, /excludedSessionCount/)
  assert.match(admin, /excludedFromLeaderboard: false/)
})

test('重复 finalize 使用条件 updateMany，只允许一个请求认领 IN_PROGRESS Session', () => {
  assert.match(game, /const claimed = await database\.wantListenSession\.updateMany/)
  assert.match(game, /where: \{ id: active\.id, userId, status: 'IN_PROGRESS' \}/)
  assert.match(game, /if \(claimed\.count !== 1\)/)
  assert.match(game, /updateWantListenStats\(database, updated, ''/)
})

test('排行榜客户端不保留旧 Map，切换/重试始终重新请求 no-store 数据', () => {
  assert.match(center, /cache: 'no-store'/)
  assert.doesNotMatch(center, /const cache = useRef/)
  assert.doesNotMatch(center, /cache\.current/)
})
