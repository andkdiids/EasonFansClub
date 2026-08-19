import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'
import assert from 'node:assert/strict'

// 想听排行榜补录一致性测试（不连真实数据库）：
//   - 统一计分函数（calculateWantListenBackfillScore 与前台 scoreForWantListenAnswer 同公式）
//   - 成绩一致性校验（score / correctCount / completedCount / maxStreak 必须来自同一局真实游戏）
//   - 人工补题预览 / 异常 Session 恢复 / 排行榜单局最高完整记录 / audit / repair dry-run

import { scoreForWantListenAnswer } from '@/lib/want-listen-config'
import {
  calculateWantListenBackfillScore,
  computeWantListenManualBackfill,
  validateWantListenScoreConsistency,
  pickBestWantListenRecord,
} from '@/lib/want-listen-score'

const root = join(process.cwd())
function source(relativePath: string) {
  return readFileSync(join(root, relativePath), 'utf8')
}

const service = source('lib/want-listen-admin-leaderboard.ts')
const route = source('app/api/admin/entertainment/want-listen/leaderboard/route.ts')
const manager = source('app/admin/entertainment/want-listen/leaderboard/WantListenLeaderboardManager.tsx')
const auditScript = source('scripts/leaderboard-audit-want-listen.ts')
const repairScript = source('scripts/leaderboard-repair-want-listen.ts')
const leaderboardSource = source('lib/want-listen-leaderboard.ts')

test('1/正常游戏结果：score/correctCount/completedCount/maxStreak 符合规则', () => {
  // 模拟前台真实结算路径：答对 +100、每连续 10 题 +270，答错清零连击且 +0
  const answers = ['correct', 'correct', 'correct', 'correct', 'correct', 'correct', 'correct', 'correct', 'correct', 'correct', 'wrong', 'correct', 'correct']
  let score = 0
  let correctCount = 0
  let streak = 0
  let maxStreak = 0
  let total = 0
  for (const answer of answers) {
    total += 1
    const isCorrect = answer === 'correct'
    const nextStreak = isCorrect ? streak + 1 : 0
    score += scoreForWantListenAnswer(isCorrect, nextStreak)
    if (isCorrect) {
      correctCount += 1
      streak = nextStreak
      if (streak > maxStreak) maxStreak = streak
    } else {
      streak = 0
    }
  }
  // 10 连击 = 1000 + 270，答错 +0，再接 2 题 = +200
  assert.equal(score, 1470)
  assert.equal(correctCount, 12)
  assert.equal(maxStreak, 10)
  assert.equal(total, 13)
  const validation = validateWantListenScoreConsistency({ score, correctCount, maxStreak, totalQuestions: total })
  assert.equal(validation.ok, true)
})

test('2/后台补 10 道正确题：系统自动计算 score（1000 基础分 + 270 连击奖励 = 1270）', () => {
  const compensation = calculateWantListenBackfillScore({ correctAnswers: 10, startingStreak: 0 })
  assert.equal(compensation.baseScore, 1000)
  assert.equal(compensation.comboBonus, 270)
  assert.equal(compensation.milestones, 1)
  assert.equal(compensation.totalScore, 1270)
  assert.equal(compensation.endStreak, 10)
})

test('3/补题跨越连击奖励节点：从连击 89 补 5 题，逐题模拟 90/91/92/93/94', () => {
  const compensation = calculateWantListenBackfillScore({ correctAnswers: 5, startingStreak: 89 })
  // 第 90 连击触发 +270，其余每题 +100
  assert.equal(compensation.milestones, 1)
  assert.equal(compensation.totalScore, 5 * 100 + 270)
  assert.equal(compensation.baseScore, 500)
  assert.equal(compensation.comboBonus, 270)
  assert.equal(compensation.endStreak, 94)
  // 不能简单 5 × 基础分（500）——必须把第 90 连击的 270 计入
  assert.notEqual(compensation.totalScore, 5 * 100)
})

test('4/异常 Session 恢复：完全复制原 Session 合法成绩，不重新计算', () => {
  const session = { score: 28770, correctCount: 231, maxStreak: 89, totalQuestions: 234 }
  const validation = validateWantListenScoreConsistency(session)
  assert.equal(validation.ok, true)
  // 服务端：恢复采用 Session 权威数据（不重算），日志标记 SESSION_RECOVERY
  assert.match(service, /WANT_LISTEN_SESSION_RECOVERY/)
  assert.match(service, /采用该 Session 权威成绩/)
  assert.match(service, /validateWantListenScoreConsistency\(authoritative/)
})

test('5/管理员无法直接提交 score=50000 绕过计算器', () => {
  // 直接手填分数的非法成绩 → 一致性校验拒绝
  const invalid = validateWantListenScoreConsistency({ score: 50000, correctCount: 10, maxStreak: 10, totalQuestions: 10 })
  assert.equal(invalid.ok, false)
  // 服务端不再有 score 入参，路由不再读取 body.score，UI 不再出现分数输入
  assert.doesNotMatch(service, /score: unknown/)
  assert.match(service, /correctDelta\?: unknown/)
  assert.doesNotMatch(route, /body\.score/)
  assert.doesNotMatch(manager, /请输入补录分数/)
  assert.doesNotMatch(manager, /最终成绩/)
  assert.doesNotMatch(manager, /补分成绩/)
})

test('6/correctCount > completedCount 必须拒绝', () => {
  const invalid = validateWantListenScoreConsistency({ score: 1000, correctCount: 60, maxStreak: 10, totalQuestions: 50 })
  assert.equal(invalid.ok, false)
  // 服务端一致性校验失败返回 400 INVALID_SCORE_ADJUSTMENT
  assert.match(service, /INVALID_SCORE_ADJUSTMENT/)
  assert.match(service, /补录后的成绩与游戏计分规则不一致/)
})

test('7/排行榜最高分字段来自同一 Result：聚合写入整行，不做独立 MAX', () => {
  assert.match(leaderboardSource, /data: \{ userId: session\.userId, sessionId: session\.id[\s\S]*?\.\.\.score \}/)
  assert.doesNotMatch(leaderboardSource, /aggregate\(/)
  assert.doesNotMatch(leaderboardSource, /_max/)
})

test('8/两个 Result：A 分数高、B 连击高，排行榜必须完整采用 A，不混用 B 的连击', () => {
  const a = { score: 30000, correctCount: 240, maxStreak: 120, totalQuestions: 250, completionTimeMs: 1800000, achievedAt: new Date('2026-08-18T10:00:00+08:00') }
  const b = { score: 28770, correctCount: 231, maxStreak: 89, totalQuestions: 234, completionTimeMs: 1800000, achievedAt: new Date('2026-08-18T10:00:00+08:00') }
  const best = pickBestWantListenRecord([a, b])
  assert.equal(best, a, '应完整采用 A')
  assert.equal(best?.score, a.score)
  assert.equal(best?.correctCount, a.correctCount)
  assert.equal(best?.maxStreak, a.maxStreak, '不能混用 B 的最高连击')
  assert.equal(best?.totalQuestions, a.totalQuestions)
})

test('9/历史错误数据 audit 可识别（截图案例：28770 分 / 答对 64 / 最高连击 35 / 完成 67）', () => {
  const screenshotCase = validateWantListenScoreConsistency({ score: 28770, correctCount: 64, maxStreak: 35, totalQuestions: 67 })
  assert.equal(screenshotCase.ok, false)
  assert.match(screenshotCase.reason || '', /连击奖励规则不符|可行区间/)
  // audit 脚本输出异常原因字段
  assert.match(auditScript, /SCORE_NOT_MATCH_RULES/)
  assert.match(auditScript, /CORRECT_GREATER_THAN_COMPLETED/)
  assert.match(auditScript, /FIELD_MISMATCH_WITH_SESSION/)
  assert.match(auditScript, /SESSION_MISSING/)
  assert.match(auditScript, /resultId/)
})

test('10/repair dry-run 不修改数据库，默认 dry-run、--apply 才写库', () => {
  assert.match(repairScript, /const dryRun = !args\.apply/)
  assert.match(repairScript, /DRY-RUN/)
  assert.match(repairScript, /NEEDS_MANUAL_REVIEW/)
  assert.match(repairScript, /FABRICATED_SCORE_NO_QUESTION_HISTORY/)
  assert.match(repairScript, /recomputeFromQuestions/)
  // 写库操作只在 apply 分支内
  const applySection = repairScript.split('if (dryRun)')[1] || ''
  assert.match(applySection, /wantListenLeaderboardEntry\.update/)
  assert.match(applySection, /wantListenSession\.update/)
})

test('11/人工补题预览：28470 + 补 3 题 = 28770（需求第 8 节示例）', () => {
  const result = computeWantListenManualBackfill({
    base: { score: 28470, correctCount: 228, maxStreak: 89, totalQuestions: 231 },
    correctDelta: 3,
    wrongDelta: 0,
    startingStreak: 0,
  })
  assert.equal(result.afterScore, 28770)
  assert.equal(result.afterCorrect, 231)
  assert.equal(result.afterTotal, 234)
  assert.equal(result.afterMaxStreak, 89)
  assert.equal(result.validation.ok, true)
  // 与截图错误记录对比：同样的 28770 但答题数据不同 → 截图记录不合法
  const screenshotCase = validateWantListenScoreConsistency({ score: 28770, correctCount: 64, maxStreak: 35, totalQuestions: 67 })
  assert.equal(screenshotCase.ok, false)
})

test('12/已有 Session 时优先自动读取当前连击，不让管理员手填', () => {
  assert.match(service, /已有 Session 时优先自动读取当前连击/)
  assert.match(service, /baseSession[\s\S]*?\.currentStreak/)
})

test('13/补录审计日志字段完整（SESSION_RECOVERY / MANUAL_QUESTION_ADJUSTMENT，不再用 MANUAL_SCORE）', () => {
  assert.match(service, /SESSION_RECOVERY/)
  assert.match(service, /MANUAL_QUESTION_ADJUSTMENT/)
  assert.match(service, /beforeScore/)
  assert.match(service, /afterScore/)
  assert.match(service, /beforeCorrectCount/)
  assert.match(service, /afterCorrectCount/)
  assert.match(service, /beforeCompletedCount/)
  assert.match(service, /afterCompletedCount/)
  assert.match(service, /beforeMaxStreak/)
  assert.match(service, /afterMaxStreak/)
  assert.match(service, /sourceSessionId/)
  assert.match(service, /playedAt/)
  assert.doesNotMatch(service, /WANT_LISTEN_ADD_SCORE/)
  assert.doesNotMatch(service, /MANUAL_SCORE/)
})

test('14/预览（PREVIEW_BACKFILL）与确认（BACKFILL）共用同一入口，均不允许直接写 score', () => {
  assert.match(route, /body\?\.action === 'PREVIEW_BACKFILL' \|\| body\?\.action === 'BACKFILL'/)
  assert.doesNotMatch(route, /ADD_SCORE/)
  assert.match(service, /previewOrApplyWantListenBackfill/)
  assert.match(service, /dryRun === true/)
})

test('15/UI 说明文案与按钮符合需求第 18 节', () => {
  assert.match(manager, /想听排行榜按完整单局成绩排名。/)
  assert.match(manager, /系统将按照当前模式计分规则自动计算分数/)
  assert.match(manager, /确保分数、答对题数、完成题数和连击一致/)
  assert.match(manager, /从异常游戏恢复/)
  assert.match(manager, /人工补题/)
  assert.match(manager, /补录成绩/)
  assert.match(manager, /补回答对题数/)
  assert.match(manager, /补回答错题数/)
})
