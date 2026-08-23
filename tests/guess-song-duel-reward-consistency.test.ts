import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { duelRewardBusinessKey, resolveDuelRewardDecision } from '../lib/guess-song-duel-reward'

function source(path: string) {
  return readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
}

test('第一次正常获胜只允许发放一次 7 点奖励', () => {
  assert.deepEqual(resolveDuelRewardDecision({
    valid: true,
    winnerId: 'user-a',
    isDraw: false,
    winnerSuspicious: false,
    dailyRewardExists: false,
  }), { granted: true, amount: 7, reason: 'GRANTED' })
  assert.equal(duelRewardBusinessKey('match-1'), 'guess-song-duel-reward:match:match-1')
})

test('同一 Match 已有奖励流水时不会再增加余额', () => {
  assert.deepEqual(resolveDuelRewardDecision({
    valid: true,
    winnerId: 'user-a',
    isDraw: false,
    winnerSuspicious: false,
    dailyRewardExists: false,
    matchRewardAmount: 7,
  }), { granted: true, amount: 7, reason: 'ALREADY_GRANTED_FOR_MATCH' })
})

test('同一用户上海业务日第二次获胜只保留胜场，不重复奖励', () => {
  assert.deepEqual(resolveDuelRewardDecision({
    valid: true,
    winnerId: 'user-a',
    isDraw: false,
    winnerSuspicious: false,
    dailyRewardExists: true,
  }), { granted: false, amount: 0, reason: 'DAILY_LIMIT_REACHED' })
})

test('平局、无胜者和可疑胜者绝不进入奖励', () => {
  for (const input of [
    { valid: true, winnerId: null, isDraw: true, winnerSuspicious: false, dailyRewardExists: false },
    { valid: true, winnerId: null, isDraw: false, winnerSuspicious: false, dailyRewardExists: false },
    { valid: true, winnerId: 'user-a', isDraw: false, winnerSuspicious: true, dailyRewardExists: false },
    { valid: false, winnerId: 'user-a', isDraw: false, winnerSuspicious: false, dailyRewardExists: false },
  ]) {
    assert.deepEqual(resolveDuelRewardDecision(input), { granted: false, amount: 0, reason: 'NOT_ELIGIBLE' })
  }
})

test('SCORE 与 BUZZER 都经过同一套结算奖励快照', () => {
  const service = source('lib/guess-song-duel-service.ts')
  assert.match(service, /completeScoreSubmissionTx/)
  assert.match(service, /if \(mode === 'BUZZER'\)/)
  assert.match(service, /settleMatchTx\(tx/)
  assert.match(service, /rewardReason = .*'PENDING'/)
})

test('奖励使用 Match 锁、PointLog 唯一 businessKey 和同一事务', () => {
  const service = source('lib/guess-song-duel-service.ts')
  const schema = source('prisma/schema.prisma')
  assert.match(schema, /businessKey\s+String\?\s+@unique/)
  assert.match(schema, /rewardGranted\s+Boolean\s+@default\(false\)/)
  assert.match(schema, /rewardReason\s+GuessSongDuelRewardReason/)
  assert.match(service, /SELECT id FROM GuessSongDuelMatch WHERE id = \$\{matchId\} FOR UPDATE/)
  assert.match(service, /const businessKey = duelRewardBusinessKey\(matchId\)/)
  assert.match(service, /awardRegistrationFee\(tx, \{/)
  assert.match(service, /rewardGranted: true, rewardAmount: reward\.awardedAmount/)
  assert.doesNotMatch(service, /businessKey: `guess-song-duel-reward:\$\{input\.winnerId\}/)
})

test('奖励失败不会向结果页伪造 +7，比赛结果仍写入失败状态', () => {
  const service = source('lib/guess-song-duel-service.ts')
  const client = source('components/games/GuessSongDuel.tsx')
  assert.match(service, /rewardReason: 'REWARD_FAILED'/)
  assert.match(service, /console\.error\('\[guess-song-duel\.reward\]'/)
  assert.match(client, /result\.reward\.granted && result\.reward\.amount > 0/)
  assert.match(client, /奖励结算失败，挂号费未到账/)
  assert.doesNotMatch(client, /result\.rewardAmount \?/)
})

test('奖励明细沿用现有 GUESS_SONG_DUEL_WIN 流水类型且接口动态读取', () => {
  const registrationFee = source('lib/registration-fee.ts')
  const historyRoute = source('app/api/points/history/route.ts')
  assert.match(registrationFee, /GUESS_SONG_DUEL_WIN: '听听·对决获胜'/)
  assert.match(registrationFee, /where = \{ userId, points: \{ not: 0 \} \}/)
  assert.match(historyRoute, /dynamic = 'force-dynamic'/)
})

test('历史诊断脚本只读且不会自动补发', () => {
  const audit = source('scripts/audit-guess-song-duel-rewards.ts')
  assert.match(audit, /readOnly: true/)
  assert.match(audit, /never repairs or awards historical rewards/)
  assert.doesNotMatch(audit, /\.create\(/)
  assert.doesNotMatch(audit, /\.update\(/)
  assert.doesNotMatch(audit, /\$executeRaw/)
})
