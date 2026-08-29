import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import {
  calculateGuessSongRisk,
  isClientSessionTokenValid,
  isQuestionAttemptTokenValid,
  issueClientSessionToken,
  issueQuestionAttemptToken,
  normalizeClientFlowNonce,
} from '../lib/guess-song-risk'

function source(path: string) {
  return readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
}

test('clientSessionToken 绑定 session、用户、时间戳和 nonce', () => {
  const session = {
    id: 'session-1',
    userId: 'user-1',
    clientSessionNonce: 'browser-flow-nonce',
    clientSessionTokenIssuedAt: new Date('2026-08-10T08:00:00.000Z'),
  }
  const token = issueClientSessionToken({
    sessionId: session.id,
    userId: session.userId,
    nonce: session.clientSessionNonce,
    issuedAt: session.clientSessionTokenIssuedAt,
  })
  assert.equal(isClientSessionTokenValid(token, session), true)
  assert.equal(isClientSessionTokenValid(token, { ...session, id: 'other-session' }), false)
  assert.equal(isClientSessionTokenValid(token, { ...session, userId: 'other-user' }), false)
  assert.equal(normalizeClientFlowNonce('too-short'), null)
  assert.equal(normalizeClientFlowNonce('browser-flow-nonce'), 'browser-flow-nonce')
})

test('questionAttemptToken 每道题唯一并可通过 hash 校验', () => {
  const first = issueQuestionAttemptToken('question-1')
  const second = issueQuestionAttemptToken('question-2')
  assert.notEqual(first.token, second.token)
  assert.equal(isQuestionAttemptTokenValid(first.token, first.hash), true)
  assert.equal(isQuestionAttemptTokenValid(second.token, first.hash), false)
  assert.equal(isQuestionAttemptTokenValid(null, first.hash), false)
})

test('正常玩家和偶尔快速答题不会触发风险', () => {
  const assessment = calculateGuessSongRisk({
    trigger: 'ANSWER',
    clientSessionTokenValid: true,
    questionAttemptTokenValid: true,
    sessionCreateCount: 1,
    answerRequestCount: 1,
    playRequestCount: 1,
    audioAccessCount: 1,
    distinctAudioCount: 1,
    answeredQuestionCount: 1,
    averageAnswerMs: 800,
    perfect: true,
  })
  assert.equal(assessment.riskScore, 0)
  assert.equal(assessment.quickAnswers, false)
})

test('连续 API、批量音频和 token 异常会组合达到作弊阈值', () => {
  const sessionStart = calculateGuessSongRisk({
    trigger: 'SESSION',
    clientFlowComplete: false,
    sessionCreateCount: 3,
    answerRequestCount: 0,
    playRequestCount: 0,
    audioAccessCount: 0,
    distinctAudioCount: 0,
    answeredQuestionCount: 0,
    averageAnswerMs: null,
    perfect: false,
  })
  const play = calculateGuessSongRisk({
    trigger: 'PLAY',
    clientSessionTokenValid: false,
    questionAttemptTokenValid: false,
    sessionCreateCount: 3,
    answerRequestCount: 20,
    playRequestCount: 30,
    audioAccessCount: 15,
    distinctAudioCount: 10,
    answeredQuestionCount: 0,
    averageAnswerMs: null,
    perfect: false,
    previousReasons: sessionStart.reasons,
  })
  assert.ok(play.riskScore >= 80)
  assert.deepEqual(
    play.reasons.map((reason) => reason.code),
    ['CLIENT_FLOW_MISSING', 'API_ACTIVITY_SPIKE', 'CLIENT_SESSION_TOKEN_INVALID', 'BULK_AUDIO_ACCESS', 'QUESTION_ATTEMPT_TOKEN_INVALID'],
  )
})

test('十题平均答题低于两秒仅在叠加异常 API 和完美正确时判定', () => {
  const quickOnly = calculateGuessSongRisk({
    trigger: 'ANSWER',
    clientSessionTokenValid: true,
    questionAttemptTokenValid: true,
    sessionCreateCount: 1,
    answerRequestCount: 10,
    playRequestCount: 10,
    audioAccessCount: 10,
    distinctAudioCount: 1,
    answeredQuestionCount: 10,
    averageAnswerMs: 1200,
    perfect: true,
  })
  const combined = calculateGuessSongRisk({
    trigger: 'ANSWER',
    clientSessionTokenValid: true,
    questionAttemptTokenValid: true,
    sessionCreateCount: 1,
    answerRequestCount: 20,
    playRequestCount: 10,
    audioAccessCount: 10,
    distinctAudioCount: 1,
    answeredQuestionCount: 10,
    averageAnswerMs: 1200,
    perfect: true,
  })
  assert.equal(quickOnly.riskScore, 40)
  assert.equal(combined.riskScore, 90)
  assert.ok(combined.reasons.some((reason) => reason.code === 'PERFECT_FAST_API'))
})

test('风控服务包含组合信号、80 分阈值和 10 题平均答题判断', () => {
  const service = source('lib/guess-song-risk.ts')
  const constants = source('lib/guess-song-constants.ts')
  assert.match(constants, /GUESS_SONG_RISK_THRESHOLD = 80/)
  assert.match(service, /sessionCreateCount >= 3/)
  assert.match(service, /answerRequestCount >= 20/)
  assert.match(service, /playRequestCount >= 30/)
  assert.match(service, /input\.audioAccessCount >= 15/)
  assert.match(service, /QUICK_ANSWER_COUNT = 10/)
  assert.match(service, /averageMs < QUICK_ANSWER_LIMIT_MS/)
  assert.match(service, /riskScore >= GUESS_SONG_RISK_THRESHOLD/)
  assert.match(service, /status: 'CHEAT_DETECTED'/)
  assert.match(service, /score: 0/)
  assert.match(service, /isValid: false/)
})

test('游戏接口强制传递客户端 token、单题 token，专家不接收 songId', () => {
  const sessionRoute = source('app/api/entertainment/guess-song/sessions/route.ts')
  const playRoute = source('app/api/entertainment/guess-song/sessions/[sessionId]/play/route.ts')
  const answerRoute = source('app/api/entertainment/guess-song/sessions/[sessionId]/answer/route.ts')
  const searchRoute = source('app/api/entertainment/guess-song/search/route.ts')
  assert.match(sessionRoute, /clientFlowNonce/)
  assert.match(playRoute, /clientSessionToken/)
  assert.match(answerRoute, /clientSessionToken/)
  assert.match(answerRoute, /questionAttemptToken/)
  assert.doesNotMatch(answerRoute, /songId/)
  assert.doesNotMatch(searchRoute, /id: true/)
  assert.doesNotMatch(searchRoute, /id: song\.id/)
})

test('作弊会使成绩无效、跳过排行榜并由前端倒计时退出', () => {
  const session = source('lib/guess-song-session.ts')
  const leaderboard = source('lib/guess-song-leaderboard.ts')
  const game = source('app/entertainment/guess-song/GuessSongGame.tsx')
  const migration = source('prisma/migrations/20260810150000_add_guess_song_risk_controls/migration.sql')
  assert.match(session, /risk\.cheatDetected/)
  assert.match(leaderboard, /!session\.isValid/)
  assert.match(leaderboard, /riskScore: \{ lt: GUESS_SONG_RISK_THRESHOLD \}/)
  assert.match(game, /CHEAT_DETECTED/)
  assert.match(game, /setInterval/)
  assert.match(game, /router\.replace\('\/games'\)/)
  assert.match(migration, /CREATE TABLE `GuessSongRiskLog`/)
  assert.match(migration, /questionAttemptTokenHash/)
})

test('后台提供听听风控日志并且不缓存', () => {
  const route = source('app/api/admin/entertainment/guess-song/risk/route.ts')
  const page = source('app/admin/entertainment/guess-song/page.tsx')
  const manager = source('app/admin/entertainment/guess-song/GuessSongRiskManager.tsx')
  assert.match(route, /requireAdmin\('entertainment_manage'\)/)
  assert.match(route, /Cache-Control.*no-store/)
  assert.match(page, /GuessSongRiskManager/)
  for (const field of ['uid', 'createdAt', 'mode', 'score', 'riskScore', 'reasons']) {
    assert.match(manager, new RegExp(field))
  }
})
