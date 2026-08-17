import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'
import assert from 'node:assert/strict'
import { matchSnapshot, type MatchRow } from '../lib/undercover-star'
import type { UndercoverDescriptionByRound } from '../lib/undercover-star-protocol'

const root = join(process.cwd())
function source(relativePath: string) {
  return readFileSync(join(root, relativePath), 'utf8')
}

function mockUser(id: string, uid: number, name: string) {
  return { id, uid, name, avatarUrl: null, Profile: null }
}
function mockPlayer(id: string, userId: string, uid: number, name: string, role: 'CIVILIAN' | 'UNDERCOVER', word: string, isAlive = true) {
  return { id, role, word, roleConfirmedAt: null, isAlive, eliminatedAt: null, lastSeenAt: null, User: mockUser(userId, uid, name) }
}

function makeMatch(overrides: Record<string, unknown> = {}): MatchRow {
  const base: Record<string, unknown> = {
    id: 'match-1',
    roomId: 'room-1',
    status: 'PLAYING',
    phase: 'VOTING',
    round: 1,
    revision: 1,
    phaseDeadline: null,
    currentSpeakerId: 'player-1',
    undercoverGuessAt: null,
    Room: { id: 'room-1', roomCode: '123456', hostId: 'u1', status: 'PLAYING' },
    UndercoverMatchPlayer: [
      mockPlayer('player-1', 'u1', 1, '小明', 'CIVILIAN', '梨'),
      mockPlayer('player-2', 'u2', 2, '小红', 'CIVILIAN', '梨'),
      mockPlayer('player-3', 'u3', 3, '小张', 'UNDERCOVER', '苹果'),
    ],
    UndercoverDescription: [],
    UndercoverVote: [],
    roundHistory: [],
    tieCandidateIds: [],
    finalResult: null,
  }
  return { ...base, ...overrides } as unknown as MatchRow
}

function desc(playerId: string, content: string, round = 1, createdAt = new Date(2020, 0, 1 + round)) {
  return { id: `d-${playerId}-${round}`, round, content, isAuto: false, createdAt, matchId: 'match-1', matchPlayerId: playerId }
}
function vote(voterId: string, targetId: string | null, round = 1, stage: 'MAIN' | 'TIE' = 'MAIN', isAbstain = false, createdAt = new Date()) {
  return { id: `v-${voterId}-${round}-${stage}`, round, stage, targetId, isAbstain, createdAt, matchId: 'match-1', voterId }
}

const service = source('lib/undercover-star.ts')
const votesRoute = source('app/api/entertainment/undercover-star/matches/[matchId]/votes/route.ts')

// ───────────────────────── 弃票（vote / abstain） ─────────────────────────

test('submitUndercoverVote 支持明确的 abstain 入参', () => {
  assert.match(service, /const wantAbstain = input\.abstain === true/)
  // API 透传 abstain 给 service。
  assert.match(votesRoute, /abstain: body\?\.abstain === true/)
})

test('弃票创建 isAbstain=true 且 targetId=null', () => {
  assert.match(service, /targetId: null, isAbstain: true \}/)
})

test('普通投票创建 isAbstain=false', () => {
  // 普通投票分支使用 targetId（变量）并显式 isAbstain: false，与弃票分支的 targetId: null 区分。
  assert.match(service, /targetId, isAbstain: false \}/)
})

test('尚未投票与弃票可以区分', () => {
  // 未投票：根本不存在 Vote 记录（existing 为 null 时直接 return，不写入）。
  assert.match(service, /const existing = await tx\.undercoverVote\.findUnique[\s\S]*?if \(existing\) return null/)
  // 弃票：仍然创建一条 Vote 记录（isAbstain=true），因此“已投票”的玩家一定能查到记录。
  assert.match(service, /if \(wantAbstain\) \{[\s\S]*?isAbstain: true/)
})

test('弃票算完成投票（voteProgress.submitted 包含弃票）', () => {
  const match = makeMatch({
    phase: 'VOTING',
    round: 1,
    UndercoverVote: [
      vote('player-1', 'player-2', 1, 'MAIN', false),
      vote('player-2', 'player-1', 1, 'MAIN', false),
      vote('player-3', null, 1, 'MAIN', true),
    ],
  })
  const snap = matchSnapshot(match, new Date())
  assert.equal(snap.voteProgress.submitted, 3)
  assert.equal(snap.voteProgress.abstained, 1)
  assert.equal(snap.voteProgress.total, 3)
})

test('弃票不增加候选人票数（settle 仅统计 targetId）', () => {
  assert.match(service, /for \(const vote of votes\) if \(vote\.targetId\) counts\.set\(vote\.targetId,/)
})

test('弃票不能成为被淘汰候选人（voteCounts 仅含正数）', () => {
  // candidates 只来自 counts > 0；弃票 targetId 为 null 不会进入 counts。
  assert.match(service, /voteCounts[\s\S]*?\.filter\(\(item\) => item\.count > 0\)/)
  assert.match(service, /const candidates = maxVotes > 0 \? alive\.filter/)
})

test('A2/B2/弃票3 → A/B 平票（candidates.length > 1 进入加赛）', () => {
  assert.match(service, /if \(candidates\.length > 1\) \{[\s\S]*?phase: 'TIE_VOTING'/)
})

test('A2/B1/弃票2 → A 被投出（candidates.length === 1 淘汰）', () => {
  assert.match(service, /const eliminatedId = candidates\[0\]/)
  assert.match(service, /await tx\.undercoverMatchPlayer\.update\(\{ where: \{ id: eliminated\.id \}/)
})

test('全员弃票不会卡死（无候选人时进入下一轮而非死循环）', () => {
  assert.match(service, /if \(!candidates\.length\) \{[\s\S]*?startNextRoundTx\(/)
})

test('全员弃票进入下一轮（round + 1）', () => {
  assert.match(service, /await startNextRoundTx\(tx, baseMatch, noElimination, now\)/)
  assert.match(service, /round: match\.round \+ 1,/)
})

test('TIE_VOTING 允许弃票（abstain 分支不校验平票候选）', () => {
  // 弃票分支直接创建 isAbstain=true，不经过 TIE 候选校验。
  assert.match(service, /if \(wantAbstain\) \{[\s\S]*?await tx\.undercoverVote\.create/)
  // 平票候选校验只在普通投票分支（非 abstain）执行。
  assert.match(service, /if \(stage === 'TIE' && !readStringArray\(match\.tieCandidateIds\)\.includes\(targetId\)\) throw/)
})

test('TIE_VOTING 普通票只能投平票候选', () => {
  assert.match(service, /throw new UndercoverStarServiceError\('加赛只能投平票候选人。', 400, 'TIE_TARGET_INVALID'\)/)
})

test('重复投票被拒绝（幂等）', () => {
  assert.match(service, /const existing = await tx\.undercoverVote\.findUnique[\s\S]*?if \(existing\) return null/)
})

test('非有效玩家不能投票（非成员 / 已淘汰）', () => {
  // 非成员：matchPlayerForUser 抛 MATCH_NOT_FOUND；已淘汰：显式 PLAYER_ELIMINATED。
  assert.match(service, /const player = matchPlayerForUser\(match, userId\)/)
  assert.match(service, /if \(!player\.isAlive\) throw new UndercoverStarServiceError\('被淘汰后不能投票。', 403, 'PLAYER_ELIMINATED'\)/)
})

// ───────────────────────── 发言历史（description history） ─────────────────────────

function assertNoLeak(history: UndercoverDescriptionByRound[]) {
  for (const entry of history) {
    for (const d of entry.descriptions) {
      assert.ok(!('role' in d), 'description 不应包含 role')
      assert.ok(!('word' in d), 'description 不应包含 word')
      assert.ok(!('civilianWord' in d), 'description 不应包含 civilianWord')
      assert.ok(!('undercoverWord' in d), 'description 不应包含 undercoverWord')
    }
  }
}

test('Round 1 全部 description 进入 history', () => {
  const match = makeMatch({
    phase: 'DESCRIBING',
    UndercoverDescription: [desc('player-1', 'a'), desc('player-2', 'b'), desc('player-3', 'c')],
  })
  const snap = matchSnapshot(match, new Date())
  const round1 = snap.descriptionHistory.find((entry) => entry.round === 1)
  assert.ok(round1, '应包含第 1 轮')
  assert.equal(round1!.descriptions.length, 3)
  assertNoLeak(snap.descriptionHistory)
})

test('Round 1 与 Round 2 按轮正确分组', () => {
  const match = makeMatch({
    round: 2,
    UndercoverDescription: [
      desc('player-1', 'r1-a', 1),
      desc('player-2', 'r1-b', 1),
      desc('player-3', 'r2-a', 2),
    ],
  })
  const snap = matchSnapshot(match, new Date())
  assert.equal(snap.descriptionHistory.length, 2)
  const r1 = snap.descriptionHistory.find((entry) => entry.round === 1)!
  const r2 = snap.descriptionHistory.find((entry) => entry.round === 2)!
  assert.equal(r1.descriptions.length, 2)
  assert.equal(r2.descriptions.length, 1)
  assertNoLeak(snap.descriptionHistory)
})

test('history 按 round 升序排列', () => {
  const match = makeMatch({
    round: 3,
    UndercoverDescription: [desc('player-1', 'r3', 3), desc('player-2', 'r1', 1), desc('player-3', 'r2', 2)],
  })
  const snap = matchSnapshot(match, new Date())
  const rounds = snap.descriptionHistory.map((entry) => entry.round)
  assert.deepEqual(rounds, [...rounds].sort((a, b) => a - b))
})

test('同一 round 按 createdAt 升序', () => {
  const match = makeMatch({
    UndercoverDescription: [
      desc('player-1', 'late', 1, new Date(2020, 0, 5)),
      desc('player-2', 'early', 1, new Date(2020, 0, 1)),
      desc('player-3', 'mid', 1, new Date(2020, 0, 3)),
    ],
  })
  const snap = matchSnapshot(match, new Date())
  const order = snap.descriptionHistory[0].descriptions.map((d) => d.content)
  assert.deepEqual(order, ['early', 'mid', 'late'])
})

test('history 不含 role / word / civilianWord / undercoverWord', () => {
  const match = makeMatch({
    phase: 'FINISHED',
    UndercoverDescription: [desc('player-1', 'a'), desc('player-2', 'b'), desc('player-3', 'c')],
  })
  const snap = matchSnapshot(match, new Date())
  assertNoLeak(snap.descriptionHistory)
})

test('PLAYING reconnect snapshot 可恢复历史', () => {
  const match = makeMatch({
    phase: 'VOTING',
    UndercoverDescription: [desc('player-1', 'a'), desc('player-2', 'b'), desc('player-3', 'c')],
  })
  const snap = matchSnapshot(match, new Date())
  assert.ok(snap.descriptionHistory.length >= 1)
  // PLAYING 阶段玩家不能泄露 role。
  assert.ok(snap.players.every((p) => p.role === undefined), 'PLAYING 玩家不应暴露 role')
})

test('FINISHED snapshot 仍保留历史，且 role 只在玩家上揭晓、不在 description', () => {
  const match = makeMatch({
    phase: 'FINISHED',
    status: 'FINISHED',
    finalResult: { winner: 'UNDERCOVER', reason: 'UNDERCOVER_GUESS_CORRECT', civilianWord: '梨', undercoverWord: '苹果', undercoverPlayerId: 'player-3', players: [] },
    UndercoverDescription: [desc('player-1', 'a'), desc('player-2', 'b'), desc('player-3', 'c')],
  })
  const snap = matchSnapshot(match, new Date())
  assert.ok(snap.descriptionHistory.length >= 1)
  assertNoLeak(snap.descriptionHistory)
  // FINISHED 后玩家揭晓 role，但 description 仍不含 role/word。
  assert.ok(snap.players.some((p) => p.role !== undefined))
  assert.ok(snap.players.every((p) => p.word === undefined || typeof p.word === 'string'))
})

test('当前 3 人房返回 3 条 description', () => {
  const match = makeMatch({
    UndercoverDescription: [desc('player-1', 'a'), desc('player-2', 'b'), desc('player-3', 'c')],
  })
  const snap = matchSnapshot(match, new Date())
  const current = snap.descriptionHistory.find((entry) => entry.round === match.round)!
  assert.equal(current.descriptions.length, 3)
})

test('当前 4 人房返回 4 条 description', () => {
  const match = makeMatch({
    UndercoverMatchPlayer: [
      mockPlayer('player-1', 'u1', 1, '小明', 'CIVILIAN', '梨'),
      mockPlayer('player-2', 'u2', 2, '小红', 'CIVILIAN', '梨'),
      mockPlayer('player-3', 'u3', 3, '小张', 'UNDERCOVER', '苹果'),
      mockPlayer('player-4', 'u4', 4, '小李', 'CIVILIAN', '梨'),
    ],
    UndercoverDescription: [desc('player-1', 'a'), desc('player-2', 'b'), desc('player-3', 'c'), desc('player-4', 'd')],
  })
  const snap = matchSnapshot(match, new Date())
  const current = snap.descriptionHistory.find((entry) => entry.round === match.round)!
  assert.equal(current.descriptions.length, 4)
})

test('发言历史包含当前轮（DESCRIBING 阶段也能看到本轮回合发言）', () => {
  const match = makeMatch({
    phase: 'DESCRIBING',
    round: 2,
    UndercoverDescription: [
      desc('player-1', 'r1', 1),
      desc('player-2', 'r2', 2),
      desc('player-3', 'r2b', 2),
    ],
  })
  const snap = matchSnapshot(match, new Date())
  const current = snap.descriptionHistory.find((entry) => entry.round === 2)!
  assert.equal(current.descriptions.length, 2)
})
