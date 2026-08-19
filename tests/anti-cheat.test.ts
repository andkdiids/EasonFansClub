import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'
import assert from 'node:assert/strict'

// 娱乐天空反作弊加固测试（纯函数 + 源码结构校验，不连真实数据库）：
//   1) 选项 key 随机化，杜绝「违规昵称」式答案泄露（想听/粤语残片/防不胜防）
//   2) 服务端计时：耗时 = answeredAt - questionStartedAt，不信任客户端
//   3) 快速答题判定：单题 <1s 记录异常；连续 5 题 <1s / 平均 <2s → SUSPICIOUS
//   4) 排行榜只读 CLEAN 场次；写入侧也拦截非 CLEAN
//   5) 答题接口只接受 questionId + optionKey，不接受 score/correct/elapsed
//   6) duel 结算对可疑获胜方取消奖金与胜场
//   7) 统一 GameAntiCheatLog 落库

const root = join(process.cwd())

function source(relativePath: string) {
  return readFileSync(join(root, relativePath), 'utf8')
}

import {
  ANTI_CHEAT_AVERAGE_FAST_MS,
  ANTI_CHEAT_CONSECUTIVE_FAST_COUNT,
  ANTI_CHEAT_MIN_SAMPLES,
  assessWantListenLatencies,
  averageAnswerTime,
  computeServerElapsedMs,
  fastestAnswerTime,
  isAverageAnswerTooFast,
  isSingleAnswerTooFast,
  maxConsecutiveFastAnswers,
  recordAntiCheatLog,
} from '@/lib/anti-cheat'
import { buildFalseTitleQuestion } from '@/lib/want-listen-questions'

const wantListenSource = source('lib/want-listen.ts')
const questionsSource = source('lib/want-listen-questions.ts')
const leaderboardSource = source('lib/want-listen-leaderboard.ts')
const answerRouteSource = source('app/api/entertainment/want-listen/sessions/[sessionId]/answer/route.ts')
const duelServiceSource = source('lib/guess-song-duel-service.ts')
const schemaSource = source('prisma/schema.prisma')
const migrationSource = source('prisma/migrations/20260819140000_add_game_anti_cheat_fields/migration.sql')

test('1/选项 key 必须是随机串，杜绝语义化 key 泄露答案', () => {
  const q1 = buildFalseTitleQuestion(['真实一', '真实二', '真实三', '真实四', '真实五', '多余真实'], '不存在之歌', 'HARD', () => 0.41)
  const q2 = buildFalseTitleQuestion(['真实一', '真实二', '真实三', '真实四', '真实五', '多余真实'], '不存在之歌', 'HARD', () => 0.41)
  assert.ok(q1)
  assert.ok(q2)
  // 每道题的 key 不同（随机）
  assert.notEqual(q1.correctOptionKey, q2.correctOptionKey)
  // 不是语义化 key
  assert.ok(q1.data.options.every((option) => !/^(correct|wrong-\d|real-\d|fake)$/.test(option.key)))
  // correctOptionKey 必须能对应到选项（服务端校验链路成立）
  const correctLabel = q1.data.options.find((option) => option.key === q1.correctOptionKey)?.label
  assert.equal(correctLabel, '不存在之歌')
  // 生成源码中不得再出现固定 key 字面量
  assert.doesNotMatch(questionsSource, /key:\s*'correct'|correctOptionKey:\s*'correct'|correctOptionKey:\s*'fake'/)
})

test('2/服务端计时：耗时完全由服务端两个时间点计算，不信任客户端', () => {
  const startedAt = new Date('2026-08-19T10:00:00.000Z')
  const answeredAt = new Date('2026-08-19T10:00:00.400Z')
  assert.equal(computeServerElapsedMs(startedAt, answeredAt), 400)
  assert.equal(computeServerElapsedMs(startedAt, null), null)
  assert.equal(computeServerElapsedMs(null, answeredAt), null)
  // 单题 <1 秒判定
  assert.equal(isSingleAnswerTooFast(400), true)
  assert.equal(isSingleAnswerTooFast(999), true)
  assert.equal(isSingleAnswerTooFast(1000), false)
  assert.equal(isSingleAnswerTooFast(null), false)
  // want-listen 答题链路必须记录 questionStartedAt 与 answerLatencyMs
  assert.match(wantListenSource, /questionStartedAt/)
  assert.match(wantListenSource, /answerLatencyMs/)
  assert.match(wantListenSource, /computeServerElapsedMs\(current\.questionStartedAt, answeredAt\)/)
})

test('3/连续 5 题 <1 秒标记高风险', () => {
  const latencies = [1200, 800, 500, 700, 600, 900, 1100]
  assert.equal(maxConsecutiveFastAnswers(latencies), 5)
  const assessment = assessWantListenLatencies(latencies)
  assert.equal(assessment.suspicious, true)
  assert.ok(assessment.reasons.some((reason) => reason.includes('连续 5 题')))
})

test('4/平均答题 <2 秒（样本 ≥ 5）直接 SUSPICIOUS', () => {
  const latencies = [1500, 1800, 1600, 1700, 1400]
  assert.equal(averageAnswerTime(latencies), 1600)
  assert.equal(isAverageAnswerTooFast(latencies), true)
  const assessment = assessWantListenLatencies(latencies)
  assert.equal(assessment.suspicious, true)
  // 样本不足时平均规则不触发，避免首题误判
  assert.equal(isAverageAnswerTooFast([1500]), false)
  assert.ok(ANTI_CHEAT_MIN_SAMPLES >= 3)
})

test('5/正常玩家耗时不会被误伤', () => {
  // 单题偶发快（1 次 <1s）不升级会话
  const latencies = [800, 5000, 4200, 3800, 6100]
  assert.equal(maxConsecutiveFastAnswers(latencies), 1)
  assert.equal(isAverageAnswerTooFast(latencies), false)
  assert.equal(assessWantListenLatencies(latencies).suspicious, false)
  // 平均 >2s 的正常玩家
  const normal = [2500, 3100, 2800, 3400, 2900]
  assert.equal(assessWantListenLatencies(normal).suspicious, false)
  assert.ok(ANTI_CHEAT_AVERAGE_FAST_MS === 2000)
  assert.ok(ANTI_CHEAT_CONSECUTIVE_FAST_COUNT === 5)
})

test('6/答题接口只接受 questionId + optionKey，不接受 score/correct/elapsed', () => {
  assert.doesNotMatch(answerRouteSource, /body\?\.score|body\?\.correct|body\?\.elapsed/)
  assert.match(answerRouteSource, /body\?\.optionKey/)
  // 服务端根据 session 内题目比对待选项，不信任客户端结果
  assert.match(wantListenSource, /isCorrect = optionKey === current\.correctOptionKey/)
})

test('6b/重复提交同一题记录 REPEATED_SUBMIT 异常', () => {
  assert.match(wantListenSource, /suspiciousType: 'REPEATED_SUBMIT'/)
  assert.match(wantListenSource, /重复提交第/)
})

test('7/排行榜只读 antiCheatStatus = CLEAN 的场次，写入侧也拦截', () => {
  assert.match(leaderboardSource, /WantListenSession: \{ is: \{ antiCheatStatus: 'CLEAN'/)
  assert.match(leaderboardSource, /antiCheatStatus !== 'CLEAN'/)
  assert.match(wantListenSource, /antiCheatStatus: 'SUSPICIOUS'/)
})

test('8/duel 结算对可疑获胜方取消奖金与胜场', () => {
  assert.match(duelServiceSource, /winnerSuspicious/)
  assert.match(duelServiceSource, /input\.winnerId === player\.userId && !winnerSuspicious/)
})

test('9/统一 GameAntiCheatLog 模型与 migration 一致', () => {
  assert.match(schemaSource, /model GameAntiCheatLog \{/)
  for (const field of ['userId', 'gameType', 'sessionId', 'questionCount', 'fastestAnswerTime', 'averageAnswerTime', 'ip', 'userAgent', 'suspiciousType', 'createdAt']) {
    assert.match(schemaSource, new RegExp(`\\b${field}\\b`))
  }
  assert.match(schemaSource, /enum GameAntiCheatStatus \{/)
  assert.match(schemaSource, /enum GameAntiCheatSuspiciousType \{/)
  assert.match(migrationSource, /CREATE TABLE `GameAntiCheatLog`/)
  assert.match(migrationSource, /ALTER TABLE `WantListenSession`/)
  assert.match(migrationSource, /questionStartedAt/)
  assert.match(migrationSource, /answerLatencyMs/)
})

test('10/recordAntiCheatLog 写入统一日志（mock 数据库）', async () => {
  const created: unknown[] = []
  const db = {
    gameAntiCheatLog: { create: async (args: { data: Record<string, unknown> }) => { created.push(args.data); return args.data } },
  }
  await recordAntiCheatLog(db, {
    userId: 'user-1',
    gameType: 'want-listen:WANT_LISTEN',
    sessionId: 'sess-1',
    questionCount: 20,
    fastestAnswerTime: 400,
    averageAnswerTime: 800,
    ip: '1.2.3.4',
    userAgent: 'test-agent',
    suspiciousType: 'FAST_ANSWER',
    details: { reasons: ['平均答题时间低于 2 秒'] },
  })
  assert.equal(created.length, 1)
  const row = created[0] as Record<string, unknown>
  assert.equal(row.userId, 'user-1')
  assert.equal(row.suspiciousType, 'FAST_ANSWER')
  assert.equal(row.averageAnswerTime, 800)
})

test('11/快速答题聚合统计函数', () => {
  const latencies = [300, 450, 700, 900, 1200]
  assert.equal(fastestAnswerTime(latencies), 300)
  assert.equal(averageAnswerTime(latencies), 710)
  assert.equal(fastestAnswerTime([]), null)
  assert.equal(averageAnswerTime([]), null)
})
