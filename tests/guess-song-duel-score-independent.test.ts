import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { calculateDuelScoreProgress, compareDuelPlayers } from '../lib/guess-song-duel-service'

function source(path: string) {
  return readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
}

const at = (seconds: number) => new Date(`2026-08-14T00:00:${String(seconds).padStart(2, '0')}.000Z`)

test('SCORE: A 完成第 1 题后进入第 2 题，B 仍在第 1 题', () => {
  assert.deepEqual(calculateDuelScoreProgress([{ questionIndex: 1, isOvertime: false, answeredAt: at(1) }], 30), {
    questionIndex: 2, answeredCount: 1, submitted: false, lastAnsweredAt: at(1),
  })
  assert.deepEqual(calculateDuelScoreProgress([], 30), {
    questionIndex: 1, answeredCount: 0, submitted: false, lastAnsweredAt: null,
  })
})

test('SCORE: A 完成 10 题与 B 完成 3 题时进度互不影响', () => {
  const a = Array.from({ length: 10 }, (_, index) => ({ questionIndex: index + 1, isOvertime: false }))
  const b = Array.from({ length: 3 }, (_, index) => ({ questionIndex: index + 1, isOvertime: false }))
  assert.equal(calculateDuelScoreProgress(a, 30).questionIndex, 11)
  assert.equal(calculateDuelScoreProgress(b, 30).questionIndex, 4)
})

test('SCORE: A 的进度计算不读取或修改 B 的答案', () => {
  const progress = calculateDuelScoreProgress([
    { questionIndex: 1, isOvertime: false },
    { questionIndex: 2, isOvertime: false },
  ], 30)
  assert.equal(progress.answeredCount, 2)
  assert.equal(progress.questionIndex, 3)
})

test('用户完全不操作时不会生成默认答案或自动推进进度', () => {
  assert.deepEqual(calculateDuelScoreProgress([], 30), {
    questionIndex: 1, answeredCount: 0, submitted: false, lastAnsweredAt: null,
  })
  const service = source('lib/guess-song-duel-service.ts')
  const client = source('components/games/GuessSongDuel.tsx')
  assert.doesNotMatch(service, /selectedOptionKey:\s*options\[0\]/)
  assert.doesNotMatch(service, /selectedOptionKey:\s*['"]A['"]/)
  assert.doesNotMatch(client, /submitAnswer\(options\[0\]/)
})

test('SCORE: 固定题集中的加赛题不计入基础进度', () => {
  const progress = calculateDuelScoreProgress([
    { questionIndex: 1, isOvertime: false },
    { questionIndex: 31, isOvertime: true },
  ], 30)
  assert.equal(progress.answeredCount, 1)
  assert.equal(progress.questionIndex, 2)
})

test('SCORE: 第 30 题后进入已交卷状态，不生成第 31 / 30 的基础题', () => {
  const progress = calculateDuelScoreProgress(
    Array.from({ length: 30 }, (_, index) => ({ questionIndex: index + 1, isOvertime: false })),
    30,
  )
  assert.equal(progress.answeredCount, 30)
  assert.equal(progress.questionIndex, 30)
  assert.equal(progress.submitted, true)
})

test('SCORE: 重复提交同一题只占一个进度位置', () => {
  const progress = calculateDuelScoreProgress([
    { questionIndex: 1, isOvertime: false },
    { questionIndex: 1, isOvertime: false },
  ], 30)
  assert.equal(progress.answeredCount, 1)
  assert.equal(progress.questionIndex, 2)
})

test('SCORE: 双方拿到同一份固定 30 题，服务端一次生成题集', () => {
  const service = source('lib/guess-song-duel-service.ts')
  assert.match(service, /const selected = shuffle\(candidates\)\.slice\(0, totalQuestions\)/)
  assert.match(service, /GuessSongDuelQuestion: \{ create: questions \}/)
  assert.match(service, /selected\.map\(\(candidate, index\) => buildStoredDuelQuestion\(candidate, index \+ 1/)
})

test('SCORE: 基础题的下一题由 userId 对应答案计算', () => {
  const service = source('lib/guess-song-duel-service.ts')
  assert.match(service, /scoreProgressForUser\(scoreRows, player\.userId, match\.totalQuestions\)/)
  assert.match(service, /const progress = scoreProgress\.get\(userId\)/)
  assert.match(service, /match\.mode === 'SCORE' && match\.status === 'PLAYING'/)
  assert.match(service, /match-level cursor is reserved for BUZZER and SCORE overtime/)
})

test('SCORE: 对手答案字段在快照中被清空', () => {
  const service = source('lib/guess-song-duel-service.ts')
  assert.match(service, /selectedOptionKey: isMe \? ownAnswer\?\.selectedOptionKey \|\| null : null/)
  assert.match(service, /answerCorrect: null/)
  assert.match(service, /selectedOptionKey: player\.userId === userId \? player\.selectedOptionKey : null/)
})

test('SCORE: 协议携带双方独立 questionIndex 与 answeredCount', () => {
  const protocol = source('lib/guess-song-duel-protocol.ts')
  assert.match(protocol, /questionIndex: number/)
  assert.match(protocol, /answeredCount: number/)
})

test('SCORE: 一方交卷不会提前结束 Match', () => {
  const service = source('lib/guess-song-duel-service.ts')
  assert.match(service, /const allSubmitted = players\.length === 2 && players\.every/)
  assert.match(service, /if \(!allSubmitted\) return null/)
})

test('SCORE: 双方交卷后只按正确数结算，速度不参与胜负', () => {
  assert.deepEqual(compareDuelPlayers([
    { userId: 'a', correctCount: 24, totalEffectiveAnswerMs: 1 },
    { userId: 'b', correctCount: 21, totalEffectiveAnswerMs: 999_999 },
  ]), { winnerId: 'a', isDraw: false })
  assert.deepEqual(compareDuelPlayers([
    { userId: 'a', correctCount: 23, totalEffectiveAnswerMs: 1 },
    { userId: 'b', correctCount: 23, totalEffectiveAnswerMs: 999_999 },
  ]), { winnerId: null, isDraw: true })
})

test('SCORE: 平局后沿用加赛题，不把加赛计入基础成绩', () => {
  const service = source('lib/guess-song-duel-service.ts')
  assert.match(service, /createDuelOvertimeQuestionTx\(tx, match, match\.totalQuestions \+ 1, now\)/)
  assert.match(service, /baseCorrectCounts = await loadDuelBaseCorrectCounts/)
})

test('SCORE: 答案唯一约束与服务端重复检查同时保留', () => {
  const schema = source('prisma/schema.prisma')
  const service = source('lib/guess-song-duel-service.ts')
  assert.match(schema, /@@unique\(\[matchId, questionId, userId\]\)/)
  assert.match(service, /guessSongDuelAnswer\.findUnique\(\{ where: \{ matchId_questionId_userId:/)
})

test('SCORE: 刷新通过答案记录恢复下一题，而不是重新随机', () => {
  const service = source('lib/guess-song-duel-service.ts')
  assert.match(service, /loadDuelScoreAnswerRows\(tx, matchId\)/)
  assert.match(service, /questionIndex = progress\.submitted \? null : progress\.questionIndex/)
  assert.doesNotMatch(service, /SCORE[\s\S]{0,400}shuffle\(candidates\)/)
})

test('SCORE: 基础题不进入共享 round completion 状态机', () => {
  const service = source('lib/guess-song-duel-service.ts')
  assert.match(service, /if \(match\.mode === 'SCORE' && !question\.isOvertime\) return null/)
  assert.match(service, /completeScoreSubmissionTx\(tx, input\.matchId, receivedAt\)/)
})

test('SCORE: 基础题不启动 BUZZER 的共享超时定时器', () => {
  const realtime = source('lib/guess-song-duel-realtime.ts')
  assert.match(realtime, /state\.mode === 'BUZZER' \|\| state\.question\?\.isOvertime/)
  assert.match(realtime, /state\.status === 'PLAYING' && state\.mode === 'SCORE' && !state\.question\?\.isOvertime\) return/)
})

test('SCORE: 前端不显示对手选项且基础题不使用答题截止时间阻塞', () => {
  const client = source('components/games/GuessSongDuel.tsx')
  assert.match(client, /const theirs = activeMode === 'BUZZER'/)
  assert.match(client, /activeMode === 'BUZZER' \|\| currentQuestion\.isOvertime/)
  assert.match(client, /已完成 \{me\.answeredCount\} \/ \{match\.totalQuestions\}/)
})

test('SCORE: WebSocket MATCH_STATE 按 socket 用户分别生成，不能把 A 的题目推给 B', () => {
  const realtime = source('lib/guess-song-duel-realtime.ts')
  assert.match(realtime, /sockets\.map\(async \(socket\) => \(\{[\s\S]*getDuelMatchState\(socket\.duelUserId as string, matchId\)/)
  assert.match(realtime, /safeSend\(item\.socket, \{ type: 'MATCH_STATE', state: item\.state \}\)/)
})

test('SCORE: 作答正误只通过 ANSWER_ACCEPTED 推送给本人，携带自己的正误与正确答案', () => {
  const realtime = source('lib/guess-song-duel-realtime.ts')
  assert.match(realtime, /this\.sendToUser\(outcome\.userId, \{[\s\S]*type: 'ANSWER_ACCEPTED'/)
  assert.match(realtime, /correct: outcome\.correct,/)
  assert.match(realtime, /correctOptionKey: outcome\.correctOptionKey,/)
  assert.match(realtime, /selectedOptionKey: outcome\.selectedOptionKey,/)
  const protocol = source('lib/guess-song-duel-protocol.ts')
  assert.match(protocol, /type: 'ANSWER_ACCEPTED'; matchId: string; questionIndex: number; userId: string; correct: boolean; correctOptionKey: string; selectedOptionKey: string; roundId: string; questionId: string; questionToken: string \}/)
  const service = source('lib/guess-song-duel-service.ts')
  assert.match(service, /selectedOptionKey: optionKey, correct, correctOptionKey: question\.correctOptionKey, questionCompletion \}/)
})
