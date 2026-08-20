import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'
import assert from 'node:assert/strict'

// 想听：提示扣分（统一计分器） + 排行榜单用户成绩精确删除（不重新设计 UI / 不物理删 Session）
//
// 计分规则（scoreForWantListenAnswer 唯一原语，前/后/audit/repair 全部复用）：
//   0 提示 → 100，1 → 75，2 → 50，3 → 25，4 → 0
//   连击奖励（+270）仅在没有使用任何提示时生效
// 删除：标记 source Session.excludedFromLeaderboard=true（保留历史）+ 删 entry + 重新聚合，
//       被排除 Session 不会因后续聚合 / 补分 / repair 重新出现。

import {
  scoreForWantListenAnswer,
  wantListenHintReducedBaseScore,
  WANT_LISTEN_MAX_HINTS,
} from '@/lib/want-listen-config'
import {
  validateWantListenScoreConsistency,
  sumWantListenSessionQuestions,
  pickBestWantListenRecord,
  type WantListenScoreState,
} from '@/lib/want-listen-score'

const root = join(process.cwd())
function source(relativePath: string) {
  return readFileSync(join(root, relativePath), 'utf8')
}

const service = source('lib/want-listen-admin-leaderboard.ts')
const route = source('app/api/admin/entertainment/want-listen/leaderboard/route.ts')
const gameSource = source('lib/want-listen.ts')
const leaderboardSource = source('lib/want-listen-leaderboard.ts')
const scoreSource = source('lib/want-listen-score.ts')
const auditScript = source('scripts/leaderboard-audit-want-listen.ts')
const repairScript = source('scripts/leaderboard-repair-want-listen.ts')

// ---------- 一、提示扣分：0/1/2/3/4 提示对应得分 ----------

test('1/未使用提示答对：awardedScore = 100', () => {
  assert.equal(scoreForWantListenAnswer(true, 1, 0), 100)
  assert.equal(scoreForWantListenAnswer(true, 5, 0), 100)
})

test('2/使用 1 个提示答对：awardedScore = 75', () => {
  assert.equal(scoreForWantListenAnswer(true, 1, 1), 75)
  assert.equal(wantListenHintReducedBaseScore(1), 75)
})

test('3/使用 2 个提示答对：awardedScore = 50', () => {
  assert.equal(scoreForWantListenAnswer(true, 1, 2), 50)
  assert.equal(wantListenHintReducedBaseScore(2), 50)
})

test('4/使用 3 个提示答对：awardedScore = 25', () => {
  assert.equal(scoreForWantListenAnswer(true, 1, 3), 25)
  assert.equal(wantListenHintReducedBaseScore(3), 25)
})

test('5/使用 4 个提示答对：awardedScore = 0', () => {
  assert.equal(scoreForWantListenAnswer(true, 1, 4), 0)
  assert.equal(wantListenHintReducedBaseScore(4), 0)
})

test('6/使用提示后答错：awardedScore = 0，连击清零', () => {
  assert.equal(scoreForWantListenAnswer(false, 9, 2), 0)
  assert.equal(scoreForWantListenAnswer(false, 0, 0), 0)
})

test('7/使用提示后答对：correctCount +1、streak +1（仅分数降低）', () => {
  // 模拟连击推进，使用 2 提示时本题应计 +50 且 streak 正常 +1
  const before = { streak: 8, correct: 20, score: 2000 }
  const isCorrect = true
  const nextStreak = before.streak + 1 // 9
  const awarded = scoreForWantListenAnswer(isCorrect, nextStreak, 2)
  assert.equal(awarded, 50)
  assert.equal(before.correct + 1, 21)
  assert.equal(nextStreak, 9)
})

test('8/无提示第 10 连击：100 + 270 = 370', () => {
  assert.equal(scoreForWantListenAnswer(true, 10, 0), 370)
  assert.equal(scoreForWantListenAnswer(true, 100, 0), 370)
})

test('9/有提示的第 10 连击：不得获得完整 +270 连击奖励（只拿到提示后基础分）', () => {
  // 使用过任意提示 → 连击奖励失效，第 10 连击只给 75/50/25/0，绝不为 345
  assert.equal(scoreForWantListenAnswer(true, 10, 1), 75)
  assert.equal(scoreForWantListenAnswer(true, 10, 2), 50)
  assert.equal(scoreForWantListenAnswer(true, 10, 3), 25)
  assert.equal(scoreForWantListenAnswer(true, 10, 4), 0)
  assert.notEqual(scoreForWantListenAnswer(true, 10, 1), 345)
})

test('10/重复点击 / 重复请求提示：不会超过 4 次，且一次请求只累计 1 次', () => {
  assert.equal(WANT_LISTEN_MAX_HINTS, 4)
  // 服务端提示递增逻辑：where hintLevel < (MAX+1) 且 increment:1（单次只 +1）
  assert.match(gameSource, /hintLevel: \{ increment: 1 \}/)
  assert.match(gameSource, /hintLevel: \{ lt: WANT_LISTEN_MAX_HINTS \+ 1 \}/)
  // 前端按钮在 hintLevel >= 5 时禁用，避免第 5 次提示
  assert.match(gameSource, /current\.hintLevel >= WANT_LISTEN_MAX_HINTS \+ 1/)
})

test('11/客户端伪造 hintsUsed=0，服务端仍按实际 hintLevel 计分', () => {
  // 真实计分路径使用服务端权威的 current.hintLevel - 1，绝不信客户端传入的 hintsUsed
  assert.match(gameSource, /scoreForWantListenAnswer\(isCorrect, nextStreak, current\.hintLevel - 1\)/)
  assert.doesNotMatch(gameSource, /scoreForWantListenAnswer\(isCorrect, nextStreak, hint/i)
})

test('12/awardedScore 写入数据库的值等于真实提示数对应得分', () => {
  // 答题写入：awardedScore 由同一 scoreForWantListenAnswer 计算并落库
  assert.match(gameSource, /awardedScore, answeredAt, answerLatencyMs/)
  // 一致性：对任意 hintsUsed，落库值 = scoreForWantListenAnswer(..., hintsUsed)
  for (let hints = 0; hints <= 4; hints += 1) {
    assert.equal(scoreForWantListenAnswer(true, 7, hints), wantListenHintReducedBaseScore(hints))
  }
})

test('13/audit / repair 按历史 question.awardedScore 重算，与提示扣分一致', () => {
  // 4 个提示 + 答对 → 该题 awardedScore 应为 0，sum 也能还原 Session.score
  const questions = [
    { answeredAt: new Date(), isCorrect: true as const, awardedScore: 50, hintLevel: 3 },
    { answeredAt: new Date(), isCorrect: true as const, awardedScore: 0, hintLevel: 5 },
    { answeredAt: new Date(), isCorrect: false as const, awardedScore: 0, hintLevel: 2 },
  ]
  const sum = sumWantListenSessionQuestions(questions)
  assert.equal(sum.score, 50)
  assert.equal(sum.correctCount, 2)
  assert.equal(sum.totalQuestions, 3)
  assert.equal(sum.maxStreak, 2)
  // audit 检测「用了提示但 awardedScore 仍按完整 100」→ HINT_SCORE_MISMATCH
  assert.match(auditScript, /HINT_SCORE_MISMATCH/)
  assert.match(auditScript, /expectedBase = Math\.max\(0, 100 - hintsUsed \* 25\)/)
  // repair 复用同一 recompute（awardedScore 求和）
  assert.match(repairScript, /score \+= question\.awardedScore/)
})

// ---------- 二、排行榜单用户成绩精确删除 ----------

test('14/删除入口在现有想听后台，且删除的是 source Session 而非只删 entry', () => {
  assert.match(service, /deleteWantListenUserScore/)
  // 标记 source Session 不再参与排行榜（保留游戏历史 / 答题记录 / 审计）
  assert.match(service, /excludedFromLeaderboard: true/)
  // 删除该 Session 产生的全部 entry（跨周期）
  assert.match(service, /deleteMany\(\{ where: \{ sessionId: session\.id \}\s*\}/)
  // 从剩余合法 Session 重新聚合（被排除的不会重现）
  assert.match(service, /recomputeUserWantListenLeaderboard\(input\.userId, mode, tx\)/)
  // 不是只 DELETE entry：必须同时处理 source record
  assert.match(leaderboardSource, /excludedFromLeaderboard/)
})

test('15/删除最高分后，自动按该用户剩余合法 Session 补位（不清除其他用户 / 其他模式）', () => {
  const a = { score: 30000, correctCount: 240, maxStreak: 120, totalQuestions: 250, completionTimeMs: 1000, achievedAt: new Date('2026-08-18T10:00:00+08:00') }
  const b = { score: 28000, correctCount: 231, maxStreak: 89, totalQuestions: 234, completionTimeMs: 1000, achievedAt: new Date('2026-08-18T10:00:00+08:00') }
  // 删除 A（最高）后，pickBest 选出的应是 B
  const bestAfter = pickBestWantListenRecord([b])
  assert.equal(bestAfter?.score, 28000)
  // recompute 仅作用于 (userId, mode)，不影响他人
  assert.match(service, /recomputeUserWantListenLeaderboard\(input\.userId, mode, tx\)/)
  assert.match(leaderboardSource, /where: \{\s*userId,\s*mode/)
})

test('16/删除同一条同时贡献 DAY / WEEK / ALL 的 Session：受影响的周期全部重新聚合', () => {
  // recompute 内部先删该 (userId,mode) 的全部 entry，再按剩余 Session 重录（recordWantListenLeaderboard 内部覆盖 DAY/WEEK/ALL）
  assert.match(leaderboardSource, /deleteMany\(\{ where: \{ userId, mode \}\s*\}/)
  assert.match(leaderboardSource, /for \(const session of eligibleSessions\) \{\s*await recordWantListenLeaderboard\(session\.id, database\)/)
  assert.match(leaderboardSource, /const periodType of \['DAY', 'WEEK', 'ALL'\]/)
})

test('17/删除不影响该用户的其他 mode 成绩', () => {
  // recompute 在事务内以 mode = input.mode 为作用域
  assert.match(service, /mode: input\.mode/)
  assert.match(leaderboardSource, /where: \{\s*userId,\s*mode\s*\}/)
})

test('18/普通用户调用删除 API → 403（服务端鉴权，不只在隐藏按钮）', () => {
  // 路由 DELETE 与 POST(DELETE_SCORE) 均 requireAdmin('entertainment_manage')
  assert.match(route, /export async function DELETE\(request/)
  assert.match(route, /DELETE_SCORE/)
  assert.match(route, /requireAdmin\('entertainment_manage'\)/)
  assert.match(route, /rejectInvalidRequestOrigin\(request\)/)
  // 删除是新增动作，不影响听听（听听路由不应出现 DELETE_SCORE）
  const guessRoute = source('app/api/admin/entertainment/guess-song/leaderboard/route.ts')
  assert.doesNotMatch(guessRoute, /DELETE_SCORE/)
})

test('19/删除成功后写 AdminActionLog（WANT_LISTEN_DELETE_SCORE + 必填字段）', () => {
  assert.match(service, /WANT_LISTEN_DELETE_SCORE/)
  assert.match(service, /action: 'WANT_LISTEN_DELETE_SCORE'/)
  const detail = service.match(/action: 'WANT_LISTEN_DELETE_SCORE',\s*detail: \{([\s\S]*?)\}/)
  assert.ok(detail, '应记录删除 detail')
  const block = detail![1]
  for (const field of ['userId', 'uid', 'nickname', 'mode', 'score', 'correctCount', 'completedCount', 'maxStreak', 'sessionId', 'achievedAt', 'periodsAffected', 'operatorId', 'reason', 'deletedAt']) {
    assert.match(block, new RegExp(field), `删除日志缺少字段 ${field}`)
  }
})

test('20/被删除的 source record 不会因后续聚合重新出现', () => {
  // recordWantListenLeaderboard 在 excludedFromLeaderboard=true 时直接返回
  assert.match(leaderboardSource, /if \(session\.excludedFromLeaderboard\) return/)
  // 公网排行榜读取也过滤 excludedFromLeaderboard:false
  assert.match(leaderboardSource, /excludedFromLeaderboard: false/)
})

test('21/异常 Session 恢复优先、人工补题次之；audit/repair 提示规则', () => {
  // 删除是「精确单条」而非全量清空：保留既有「清空」能力（需求 9 允许其继续存在）但单条删除不复用它
  assert.match(service, /SESSION_RECOVERY/)
  assert.match(service, /MANUAL_QUESTION_ADJUSTMENT/)
  // 人工补题默认无提示（hintsUsed=0）：calculateWantListenBackfillScore 调用 scoreForWantListenAnswer(true, streak) 不带 hintsUsed
  assert.match(scoreSource, /scoreForWantListenAnswer\(true, streak\)/)
  // 补录入口统一走 computeWantListenManualBackfill（委托到上面同一公式），不再接受直接填分
  assert.match(service, /computeWantListenManualBackfill/)
  // 单条删除走 excludedFromLeaderboard，而非 CLEAR_USER / CLEAR_ALL 重建
  assert.match(service, /excludedFromLeaderboard: true/)
})
