import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { resolveVoteResult } from '../lib/undercover-star-vote'

const service = readFileSync('lib/undercover-star.ts', 'utf8')
const client = readFileSync('app/games/undercover-star/UndercoverStarClient.tsx', 'utf8')
const clientState = readFileSync('lib/undercover-star-client-state.ts', 'utf8')

function votes(entries: Array<[string | null, boolean]>) {
  return entries.map(([targetId, isAbstain]) => ({ targetId, isAbstain }))
}

test('任何轮次 2:2 平票：无人淘汰', () => {
  const result = resolveVoteResult({
    round: 2,
    alivePlayerIds: ['a', 'b', 'c', 'd'],
    votes: votes([['a', false], ['a', false], ['b', false], ['b', false]]),
  })
  assert.equal(result.outcome, 'TIE')
  assert.equal(result.eliminatedPlayerId, null)
  assert.deepEqual(result.candidates, ['a', 'b'])
})

test('第一轮 2:1:1：最高票不超过 2，无人淘汰', () => {
  const result = resolveVoteResult({
    round: 1,
    alivePlayerIds: ['a', 'b', 'c', 'd'],
    votes: votes([['a', false], ['a', false], ['b', false], ['c', false]]),
  })
  assert.equal(result.outcome, 'NO_ELIMINATION')
  assert.equal(result.reason, 'ROUND_ONE_THRESHOLD')
  assert.equal(result.eliminatedPlayerId, null)
})

test('第一轮 3:1：唯一最高票超过 2，正常淘汰', () => {
  const result = resolveVoteResult({
    round: 1,
    alivePlayerIds: ['a', 'b', 'c', 'd'],
    votes: votes([['a', false], ['a', false], ['a', false], ['b', false]]),
  })
  assert.equal(result.outcome, 'ELIMINATED')
  assert.equal(result.eliminatedPlayerId, 'a')
})

test('第二轮唯一最高 2:1:1：恢复正常多数票规则', () => {
  const result = resolveVoteResult({
    round: 2,
    alivePlayerIds: ['a', 'b', 'c', 'd'],
    votes: votes([['a', false], ['a', false], ['b', false], ['c', false]]),
  })
  assert.equal(result.outcome, 'ELIMINATED')
  assert.equal(result.eliminatedPlayerId, 'a')
})

test('弃票计入完成动作但不进入任何候选人的票数', () => {
  const submitted = votes([['b', false], [null, true], ['b', false], [null, true]])
  const result = resolveVoteResult({ round: 2, alivePlayerIds: ['a', 'b', 'c', 'd'], votes: submitted })
  assert.equal(submitted.length, 4)
  assert.deepEqual(result.voteCounts, [{ playerId: 'b', count: 2 }])
  assert.equal(result.eliminatedPlayerId, 'b')
})

test('空票和无效/死人目标都不会制造淘汰候选人', () => {
  const result = resolveVoteResult({
    round: 2,
    alivePlayerIds: ['a', 'b'],
    votes: votes([[null, true], ['dead', false]]),
  })
  assert.equal(result.outcome, 'NO_ELIMINATION')
  assert.equal(result.eliminatedPlayerId, null)
  assert.deepEqual(result.voteCounts, [])
})

test('死人不能通过遗留投票记录影响当前结算', () => {
  const result = resolveVoteResult({
    round: 2,
    alivePlayerIds: ['a', 'b'],
    votes: [
      { voterId: 'dead-voter', targetId: 'a', isAbstain: false },
      { voterId: 'b', targetId: 'a', isAbstain: false },
    ],
  })
  assert.deepEqual(result.voteCounts, [{ playerId: 'a', count: 1 }])
})

test('服务端只保留一个结算入口，并以锁定阶段作为一次性 resolve guard', () => {
  assert.match(service, /resolveVoteResult\(/)
  assert.match(service, /if \(match\.status !== 'PLAYING' \|\| match\.phase !== expectedPhase\) return null/)
  assert.match(service, /await lockMatch\(tx, matchId\)/)
  assert.doesNotMatch(service, /phase: 'TIE_VOTING',\s*tieCandidateIds/)
})

test('快照包含版本和 viewerVoteStatus，旧版本不会覆盖新版本', () => {
  assert.match(service, /stateVersion: match\.revision/)
  assert.match(service, /viewerVoteStatus:/)
  assert.match(clientState, /const currentVersion = current\.stateVersion \?\? current\.revision/)
  assert.match(clientState, /if \(nextVersion < currentVersion\) return false/)
})

test('前端提交使用 render-independent ref 锁，且成功后保留 submitted 状态', () => {
  assert.match(client, /const voteSubmittingRef = useRef\(false\)/)
  assert.match(client, /if \(voteSubmittingRef\.current \|\|/)
  assert.match(client, /status: 'submitting'/)
  assert.match(client, /status: 'submitted'/)
  assert.match(client, /onVoteSubmit=\{\(targetId, abstained\) => void submitVote\(targetId, abstained\)\}/)
})

test('网络断开只进入 RECONNECTING/OFFLINE，不转换为游戏终止', () => {
  const realtime = readFileSync('lib/undercover-star-realtime-client.ts', 'utf8')
  assert.match(realtime, /'reconnecting'/)
  assert.match(realtime, /'offline'/)
  assert.doesNotMatch(client, /游戏中断/)
  assert.match(client, /连接不稳定，正在恢复对局状态。/)
})
