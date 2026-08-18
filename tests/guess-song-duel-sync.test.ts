import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { canApplyDuelMatchSnapshot, canApplyDuelQuestionResponse } from '../lib/guess-song-duel-client-state'
import type { DuelMatchState, DuelQuestionState } from '../lib/guess-song-duel-protocol'

function source(path: string) {
  return readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
}

function snapshot(overrides: Partial<DuelMatchState> = {}): DuelMatchState {
  return {
    matchId: 'match-1',
    roomId: 'room-1',
    mode: 'SCORE',
    revision: 70,
    status: 'PLAYING',
    phase: 'PLAYING',
    currentQuestionIndex: 7,
    totalQuestions: 30,
    completedQuestionCount: 6,
    roundId: 'question-7',
    questionId: 'token-7',
    questionToken: 'token-7',
    serverNow: '2026-08-14T00:00:00.000Z',
    players: [],
    answers: [],
    question: null,
    questionResult: null,
    lastQuestionResult: null,
    result: null,
    ...overrides,
  }
}

function question(overrides: Partial<DuelQuestionState> = {}): DuelQuestionState {
  return {
    matchId: 'match-1',
    id: 'question-7',
    roundId: 'question-7',
    publicToken: 'token-7',
    questionId: 'token-7',
    questionIndex: 7,
    isOvertime: false,
    overtimeIndex: null,
    options: [
      { key: 'A', label: 'A' },
      { key: 'B', label: 'B' },
      { key: 'C', label: 'C' },
      { key: 'D', label: 'D' },
    ],
    audioDurationSeconds: 5,
    serverStartedAt: '2026-08-14T00:00:00.000Z',
    audioStartAt: '2026-08-14T00:00:02.000Z',
    answerDeadlineAt: '2026-08-14T00:00:12.000Z',
    audioUrl: '/audio',
    preloadAudioUrl: null,
    ...overrides,
  }
}

test('旧 revision 的第 7 题快照不能覆盖已经应用的第 8 题', () => {
  const current = snapshot({ revision: 81, currentQuestionIndex: 8, roundId: 'question-8', questionId: 'token-8', questionToken: 'token-8' })
  const delayed = snapshot({ revision: 72 })
  assert.equal(canApplyDuelMatchSnapshot('match-1', current, delayed), false)
})

test('同一 Match 的新 round 快照可以推进，且不同 Match 会被丢弃', () => {
  const current = snapshot({ revision: 71 })
  const next = snapshot({ revision: 81, currentQuestionIndex: 8, roundId: 'question-8', questionId: 'token-8', questionToken: 'token-8' })
  assert.equal(canApplyDuelMatchSnapshot('match-1', current, next), true)
  assert.equal(canApplyDuelMatchSnapshot('match-2', current, next), false)
})

test('FINISHED 是吸收态，旧 PLAYING 快照不能把结算页切回题目页', () => {
  const finished = snapshot({ revision: 900, status: 'FINISHED', phase: 'FINISHED' })
  const oldPlaying = snapshot({ revision: 901, status: 'PLAYING', phase: 'PLAYING' })
  assert.equal(canApplyDuelMatchSnapshot('match-1', finished, oldPlaying), false)
  assert.equal(canApplyDuelMatchSnapshot('match-1', finished, snapshot({ revision: 900, status: 'FINISHED', phase: 'FINISHED' })), true)
})

test('Question payload 必须绑定 Match、round、index、token 和请求 generation', () => {
  const current = snapshot({ currentQuestionIndex: 7, roundId: 'question-7', questionToken: 'token-7' })
  assert.equal(canApplyDuelQuestionResponse(current, question(), 4, 4), true)
  assert.equal(canApplyDuelQuestionResponse(current, question({ questionIndex: 6, roundId: 'question-6', publicToken: 'token-6', questionId: 'token-6' }), 4, 4), false)
  assert.equal(canApplyDuelQuestionResponse(current, question({ publicToken: 'late-token' }), 4, 4), false)
  assert.equal(canApplyDuelQuestionResponse(current, question(), 3, 4), false)
  assert.equal(canApplyDuelQuestionResponse(null, question(), 4, 4), false)
})

test('服务端 Match snapshot 在一个 transaction 内读取题目和本题答案，并携带 revision', () => {
  const service = source('lib/guess-song-duel-service.ts')
  assert.match(service, /export async function getDuelMatchState[\s\S]*?return duelTransaction\(async \(tx\) => \{[\s\S]*?loadQuestionState\(tx, matchId, match\.currentQuestionIndex\)[\s\S]*?guessSongDuelAnswer\.findMany/)
  assert.match(service, /revisionBase = duelStateRevision\(match, question, match\.GuessSongDuelPlayer/)
  assert.match(service, /roundId: activeQuestion\?\.roundId/)
  assert.match(service, /questionToken: activeQuestion\?\.publicToken/)
  assert.match(service, /lastQuestionResult/)
})

test('WebSocket 事件和 HTTP fallback 都只触发统一 snapshot 同步', () => {
  const client = source('components/games/GuessSongDuel.tsx')
  const realtime = source('lib/guess-song-duel-realtime.ts')
  assert.match(client, /const applyMatchSnapshot = useCallback/)
  assert.match(client, /applyMatchSnapshot\(matchData\.match\)/)
  assert.match(client, /event\.type === 'QUESTION_START' \|\| event\.type === 'PLAYER_ANSWERED'/)
  assert.doesNotMatch(client, /loadCurrentQuestion|fetchQuestion|questionPollTimer/)
  assert.match(realtime, /broadcastMatchEvent\(matchId, \{ type: 'PLAYER_ANSWERED'/)
})

test('SCORE 与 BUZZER 的对方选择来自持久化 Answer，且 BUZZER 错误抢答保持可见', () => {
  const service = source('lib/guess-song-duel-service.ts')
  const protocol = source('lib/guess-song-duel-protocol.ts')
  const client = source('components/games/GuessSongDuel.tsx')
  assert.match(service, /selectedOptionKey: answer\?\.selectedOptionKey \|\| null/)
  assert.match(service, /answerCorrect: answer && revealCorrectness \? answer\.isCorrect : null/)
  assert.match(protocol, /selectedOptionKey: string \| null/)
  assert.match(client, /对方错误抢答/)
  assert.match(client, /is-opponent-choice/)
  assert.match(client, /lastRoundSummary/)
})

test('FINISHED 会使 generation 失效、abort 请求并停止 playing fallback', () => {
  const client = source('components/games/GuessSongDuel.tsx')
  assert.match(client, /requestGenerationRef\.current \+= 1/)
  assert.match(client, /syncRequestRef\.current\?\.controller\.abort\(\)/)
  assert.match(client, /if \(matchId && latestMatchRef\.current && latestMatchRef\.current\.status !== 'PLAYING'\) return/)
  assert.match(client, /socketRef\.current\?\.readyState !== WebSocket\.OPEN/)
  assert.match(client, /if \(finishedHandledMatchIdRef\.current !== next\.matchId\)/)
})

test('返回大厅会清除 active match，旧请求不能重新拉回结算页', () => {
  const client = source('components/games/GuessSongDuel.tsx')
  assert.match(client, /matchIdRef\.current = null/)
  assert.match(client, /latestMatchRef\.current = null/)
  assert.match(client, /setMatchId\(null\)/)
  assert.match(client, /setView\('lobby'\)/)
  assert.match(client, /requestGenerationRef\.current === generation/)
})

test('BUZZER 音频由服务端 audioStartAt 统一驱动，客户端不提前播放', () => {
  const client = source('components/games/GuessSongDuel.tsx')
  const realtime = source('lib/guess-song-duel-realtime.ts')
  const service = source('lib/guess-song-duel-service.ts')
  // 客户端：本地时钟（含服务器偏移）到达 audioStartAt 才播放，且每题只播一次。
  assert.match(client, /playedAudioTokenRef/)
  assert.match(client, /clockTick \+ offsetRef\.current >= new Date\(.+audioStartAt/)
  // 不再用一次性 setTimeout(delay) 按 Date\.now\(\) 立即/提前播放。
  assert.doesNotMatch(client, /void audio\.play\(\)\.catch\(\(\) => setAudioBlocked\(true\)\)\s*\}, delay\)/)
  // 服务端仍是唯一权威：QUESTION_START 由 tickMatch 在 serverStartedAt 时刻广播，
  // audioStartAt 由服务端计算并随题目下发。
  assert.match(realtime, /broadcastMatchEvent\(matchId, startEvent\)/)
  assert.match(realtime, /toQuestionStart\(state\)/)
  assert.match(service, /audioStartAt: times\.audioStartAt\.toISOString\(\)/)
})
