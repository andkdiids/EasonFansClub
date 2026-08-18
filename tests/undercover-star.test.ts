import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  isDirectUndercoverWordMention,
  normalizeUndercoverDescription,
  normalizeUndercoverWord,
  normalizedUndercoverPairKey,
} from '../lib/undercover-star-title'
import {
  UNDERCOVER_DESCRIPTION_MS,
  UNDERCOVER_GUESS_MS,
  UNDERCOVER_MAX_PLAYERS,
  UNDERCOVER_MIN_PLAYERS,
  UNDERCOVER_ROLE_REVEAL_MS,
  UNDERCOVER_VOTING_MS,
  isUndercoverCategory,
  isUndercoverDifficulty,
} from '../lib/undercover-star-config'
import { canApplyUndercoverPrivateState, canApplyUndercoverRoomState, canApplyUndercoverSnapshot } from '../lib/undercover-star-client-state'
import { matchSnapshot, privateState, type MatchRow } from '../lib/undercover-star'
import type { UndercoverFinalPlayer, UndercoverFinalResult, UndercoverPrivateState, UndercoverPublicMatchSnapshot, UndercoverRoomState } from '../lib/undercover-star-protocol'

const root = join(process.cwd())

function source(relativePath: string) {
  return readFileSync(join(root, relativePath), 'utf8')
}

function snapshot(revision: number, phase: UndercoverPublicMatchSnapshot['phase'] = 'DESCRIBING', round = 1) {
  return {
    matchId: 'match-1',
    roomId: 'room-1',
    status: phase === 'FINISHED' ? 'FINISHED' : 'PLAYING',
    phase,
    round,
    revision,
    serverNow: new Date().toISOString(),
    phaseDeadline: null,
    currentSpeakerId: null,
    viewerUndercoverFound: false,
    players: [],
    descriptions: [],
    descriptionHistory: [],
    voteProgress: { submitted: 0, total: 3, stage: null, abstained: 0 },
    tieCandidates: [],
    roundHistory: [],
    lastRoundResult: null,
    finalResult: null,
  } as UndercoverPublicMatchSnapshot
}

function room(roomId: string, lastActivityAt: string, currentCount = 1): UndercoverRoomState {
  return {
    roomId,
    roomCode: '123456',
    viewerUserId: 'u1',
    status: 'WAITING',
    isPublic: true,
    hasPassword: false,
    hostId: 'u1',
    difficulty: 'NORMAL',
    currentCount,
    maxPlayers: 4,
    players: [],
    matchId: null,
    lastActivityAt,
  } as UndercoverRoomState
}

test('undercover title normalization removes presentation differences before comparison', () => {
  assert.equal(normalizeUndercoverWord('  ＡＢＣ　富 士・山下！  '), 'abc富士山下')
  assert.equal(normalizeUndercoverDescription('愛情-轉移'), '愛情轉移')
  assert.equal(isDirectUndercoverWordMention('我觉得这首歌很有爱情 转移的感觉。', '爱情转移'), true)
  assert.equal(isDirectUndercoverWordMention('我只是在说另一首歌。', '爱情转移'), false)
  assert.equal(normalizedUndercoverPairKey('A B', 'C'), normalizedUndercoverPairKey('ａｂ', 'c'))
})

test('undercover configuration enforces the first-version player, category, difficulty, and deadline rules', () => {
  assert.equal(UNDERCOVER_MIN_PLAYERS, 3)
  assert.equal(UNDERCOVER_MAX_PLAYERS, 4)
  assert.equal(UNDERCOVER_ROLE_REVEAL_MS, 45_000)
  assert.equal(UNDERCOVER_DESCRIPTION_MS, 60_000)
  assert.equal(UNDERCOVER_VOTING_MS, 45_000)
  assert.equal(UNDERCOVER_GUESS_MS, 30_000)
  assert.equal(isUndercoverCategory('SONG'), true)
  assert.equal(isUndercoverCategory('NOT_A_CATEGORY'), false)
  assert.equal(isUndercoverDifficulty('HARD'), true)
  assert.equal(isUndercoverDifficulty('NOT_A_DIFFICULTY'), false)
})

test('client snapshot guard keeps revisions monotonic and never reopens a finished match', () => {
  const current = snapshot(4)
  assert.equal(canApplyUndercoverSnapshot(current, snapshot(3)), false)
  assert.equal(canApplyUndercoverSnapshot(current, snapshot(4)), true)
  assert.equal(canApplyUndercoverSnapshot(current, snapshot(5)), true)
  assert.equal(canApplyUndercoverSnapshot(snapshot(10, 'DESCRIBING', 2), snapshot(11, 'DESCRIBING', 1)), false)
  const finished = snapshot(8, 'FINISHED')
  assert.equal(canApplyUndercoverSnapshot(finished, snapshot(9)), false)
  assert.equal(canApplyUndercoverSnapshot(finished, snapshot(8, 'FINISHED')), true)
})

test('stale private-state responses cannot restore an older phase or round', () => {
  const current = snapshot(8, 'VOTING', 2)
  const stale = { ...snapshot(7, 'DESCRIBING', 1), role: 'CIVILIAN', word: '词', roleConfirmed: true, isAlive: true, descriptionSubmitted: false, voteSubmitted: false, voteStage: null, voteTargetId: null, guessSubmitted: false, canDescribe: true, canVote: false, canGuess: false, phaseDeadline: null, playerId: 'player-1' } as unknown as UndercoverPrivateState
  assert.equal(canApplyUndercoverPrivateState(current, stale), false)
})

test('database structure covers room lifecycle, private state, idempotency, and indexed reporting', () => {
  const schema = source('prisma/schema.prisma')
  const migration = source('prisma/migrations/20260816180000_add_undercover_star/migration.sql')
  for (const model of [
    'UndercoverWordPair',
    'UndercoverRoom',
    'UndercoverRoomPlayer',
    'UndercoverMatch',
    'UndercoverMatchPlayer',
    'UndercoverDescription',
    'UndercoverVote',
    'UndercoverStats',
  ]) {
    assert.match(schema, new RegExp(`model ${model}`))
    assert.match(migration, new RegExp(`CREATE TABLE.*${model}`, 's'))
  }
  for (const enumName of ['UndercoverRoomStatus', 'UndercoverMatchPhase', 'UndercoverRole', 'UndercoverVoteStage']) {
    assert.match(schema, new RegExp(`enum ${enumName}`))
  }
  assert.match(schema, /@@unique\(\[roomId, userId\]\)/)
  assert.match(schema, /@@unique\(\[matchId, round, matchPlayerId\]\)/)
  assert.match(schema, /@@unique\(\[matchId, round, stage, voterId\]\)/)
  // 1:N：UndercoverMatch.roomId 不再是 @unique；Room 通过 currentMatchId 指向当前 PLAYING 对局。
  const undercoverMatchModel = schema.match(/model UndercoverMatch \{[\s\S]*?\n\}/)
  assert.ok(undercoverMatchModel, 'UndercoverMatch model 应存在')
  assert.doesNotMatch(undercoverMatchModel![0], /roomId\s+String\s+@unique/)
  assert.match(schema, /currentMatchId\s+String\?/)
  assert.match(schema, /matchNumber\s+Int/)
  assert.match(schema, /@@index\(\[status, finishedAt\]\)/)
  assert.doesNotMatch(migration, /DROP TABLE|DROP COLUMN|TRUNCATE/i)
  // 2.0 迁移：仅新增列/表，向后兼容，不删除任何历史数据。
  const migration2 = source('prisma/migrations/20260820000000_undercover_star_two_point_zero/migration.sql')
  assert.match(migration2, /currentMatchId/)
  assert.match(migration2, /UndercoverRoomMessage/)
  assert.match(migration2, /UndercoverMatchResult/)
  assert.doesNotMatch(migration2, /DROP TABLE|DROP COLUMN|TRUNCATE|DELETE FROM/i)
})

test('public snapshot and private routes do not expose hidden role pairs before the match ends', () => {
  const service = source('lib/undercover-star.ts')
  const protocol = source('lib/undercover-star-protocol.ts')
  const publicRoute = source('app/api/entertainment/undercover-star/matches/[matchId]/route.ts')
  const privateRoute = source('app/api/entertainment/undercover-star/matches/[matchId]/private/route.ts')
  assert.match(service, /match\.status === 'FINISHED' \? \{ role: player\.role, word: player\.word \}/)
  assert.match(service, /getUndercoverPrivateState/)
  assert.doesNotMatch(publicRoute, /civilianWord|undercoverWord|UNDERCOVER.*word/u)
  assert.doesNotMatch(privateRoute, /civilianWord|undercoverWord/u)
  assert.match(protocol, /finalResult: UndercoverFinalResult \| null/)
})

test('server state machine validates turn permissions, tie candidates, and one-shot finish paths', () => {
  const service = source('lib/undercover-star.ts')
  const server = source('server.ts')
  const realtime = source('lib/undercover-star-realtime.ts')
  assert.match(service, /match\.currentSpeakerId !== playerId/)
  assert.match(service, /descriptionSubmitted/)
  assert.match(service, /stage === 'TIE' && !readStringArray\(match\.tieCandidateIds\)\.includes\(targetId\)/)
  assert.match(service, /updateMany\(\{[\s\S]*?where: \{ id: match\.id, status: 'PLAYING' \}/)
  assert.match(service, /UNDERCOVER_SURVIVAL/)
  assert.match(service, /UNDERCOVER_GUESS_CORRECT/)
  assert.match(service, /UNDERCOVER_GUESS_TIMEOUT/)
  assert.match(service, /const validPairs = pairs\.filter/)
  assert.match(server, /\/ws\/undercover/)
  assert.match(realtime, /fallback|SYNC_MATCH|phaseDeadline/)
})

test('undercover API actions use authenticated service responses and do not return password hashes', () => {
  const roomRoute = source('app/api/entertainment/undercover-star/rooms/route.ts')
  const joinRoute = source('app/api/entertainment/undercover-star/rooms/join/route.ts')
  const startRoute = source('app/api/entertainment/undercover-star/rooms/[roomId]/start/route.ts')
  const realtime = source('lib/undercover-star-realtime.ts')
  assert.match(roomRoute, /requireUser|requireAuth|guard\.user\.id/)
  assert.match(joinRoute, /password/)
  assert.match(joinRoute, /getUndercoverRoomIdByCode/)
  assert.match(startRoute, /startUndercoverMatch/)
  assert.doesNotMatch(roomRoute, /passwordHash/)
  assert.doesNotMatch(joinRoute, /passwordHash/)
  assert.doesNotMatch(realtime, /passwordHash/)
})

test('one user room ownership and historical room membership are handled transactionally', () => {
  const service = source('lib/undercover-star.ts')
  assert.match(service, /isolationLevel: 'Serializable'/)
  assert.match(service, /lockUser\(tx, userId\)/)
  assert.match(service, /cleanupWaitingMembershipsTx\(tx, userId, now/)
  assert.match(service, /roomId_userId/)
  assert.match(service, /historicalPlayer\.leftAt \? false : historicalPlayer\.isReady/)
  assert.match(service, /UNDERCOVER_MAX_PLAYERS/)
})

test('finished matches remain resumable after a lobby refresh', () => {
  const service = source('lib/undercover-star.ts')
  const protocol = source('lib/undercover-star-protocol.ts')
  const profileCard = source('components/games/undercover-star/UndercoverProfileCard.tsx')
  assert.match(service, /status: 'FINISHED', UndercoverMatchPlayer: \{ some: \{ userId \} \}/)
  assert.match(service, /activeMatch: finishedMatch \? \{ matchId: finishedMatch\.id, roomId: finishedMatch\.roomId, status: finishedMatch\.status \}/)
  assert.match(protocol, /activeMatch: \{ matchId: string; roomId: string; status: UndercoverMatchStatus \} \| null/)
  // FINISHED 的「查看结果」入口现由档案卡片呈现（客户端不再内联），仍可经 resumeActiveGame 恢复。
  assert.match(profileCard, /activeMatch\?\.status === 'FINISHED'/)
})

test('room state guard drops stale realtime room states so a late response cannot hide a newer join', () => {
  const base = room('room-1', '2026-08-17T00:00:00.000Z', 1)
  assert.equal(canApplyUndercoverRoomState(null, base), true)
  assert.equal(canApplyUndercoverRoomState(base, room('room-1', '2026-08-17T00:00:01.000Z', 2)), true)
  assert.equal(canApplyUndercoverRoomState(room('room-1', '2026-08-17T00:00:05.000Z', 2), base), false)
  assert.equal(canApplyUndercoverRoomState(base, room('room-2', '2026-08-17T00:00:10.000Z')), false)
})

test('match snapshot guard isolates games and treats equal revisions as idempotent', () => {
  const gameA = snapshot(5)
  const gameB = { ...snapshot(5), matchId: 'match-2' } as UndercoverPublicMatchSnapshot
  assert.equal(canApplyUndercoverSnapshot(gameA, gameB), false)
  assert.equal(canApplyUndercoverSnapshot(gameA, snapshot(5)), true)
  assert.equal(canApplyUndercoverSnapshot(gameA, snapshot(6)), true)
})

test('join path broadcasts the authoritative, viewer-specific room snapshot to every subscribed socket', () => {
  const realtime = source('lib/undercover-star-realtime.ts')
  const joinRoute = source('app/api/entertainment/undercover-star/rooms/join/route.ts')
  const readyRoute = source('app/api/entertainment/undercover-star/rooms/[roomId]/ready/route.ts')
  assert.match(joinRoute, /undercoverRealtimeHub\.broadcastRoom\(state\.roomId\)/)
  assert.match(joinRoute, /for \(const affected of result\.affectedRooms\) await undercoverRealtimeHub\.broadcastRoom\(affected\.roomId\)/)
  assert.match(readyRoute, /undercoverRealtimeHub\.broadcastRoom\(roomId\)/)
  assert.match(realtime, /async broadcastRoom\(roomId: string\)/)
  assert.match(realtime, /getUndercoverRoomState\(userId, roomId\)/)
  assert.match(realtime, /ROOM_STATE/)
})

test('start is authoritative and atomic: 1:N, sets currentMatchId, blocks only a live second start', () => {
  const startRoute = source('app/api/entertainment/undercover-star/rooms/[roomId]/start/route.ts')
  const service = source('lib/undercover-star.ts')
  assert.match(startRoute, /undercoverRealtimeHub\.broadcastRoom\(roomId\)/)
  assert.match(startRoute, /undercoverRealtimeHub\.broadcastMatchState\(result\.matchId\)/)
  assert.match(service, /isolationLevel: 'Serializable'/)
  assert.match(service, /lockRoom\(tx, roomId\)/)
  assert.match(service, /room\.hostId !== userId/)
  // 1:N：不再用一对一 UndercoverMatch 关系阻止重开，而是用 room.status 守卫，
  // 并为每一局写入独立的 currentMatchId 与递增 matchNumber。
  assert.doesNotMatch(service, /if \(room\.UndercoverMatch\) throw/)
  assert.match(service, /currentMatchId: match\.id/)
  assert.match(service, /matchNumber/)
  assert.match(service, /room\.status !== 'WAITING'/)
})

test('Room 1:N Match 生命周期核心不变量', () => {
  const service = source('lib/undercover-star.ts')
  // Match1 FINISHED 后 Room 回到 WAITING（绝不保持 FINISHED/CANCELLED）。
  assert.match(service, /status: 'WAITING', currentMatchId: null/)
  // 结束一局必须清空 currentMatchId，并重置所有在房玩家的准备状态。
  assert.match(service, /currentMatchId: null, closedAt: null/)
  assert.match(service, /where: \{ roomId: match\.roomId, leftAt: null \},\s*[\s\S]*?isReady: false/)
  // WAITING 房间的 currentMatchId 必须为 null（公开房列表据此过滤）。
  assert.match(service, /currentMatchId: null, Host: \{ status: 'ACTIVE'/)
  // 真正 PLAYING 的对局才算 active game；WAITING 房间不会触发 active-game 提示。
  assert.match(service, /currentMatch\.status === 'PLAYING'[\s\S]*?isInActiveGame: true/)
  assert.match(service, /isInActiveGame: false/)
})

test('P0: 陈旧 PLAYING 房间安全收敛，FINISHED Match 不阻挡下一局', () => {
  const service = source('lib/undercover-star.ts')
  // 仅当 currentMatch 真实处于 PLAYING 才抛出 MATCH_ACTIVE；否则把陈旧 PLAYING 房间收敛为 WAITING。
  assert.match(service, /if \(currentMatchStatus === 'PLAYING'\) \{\s*[\s\S]*?throw new UndercoverStarServiceError\('你正在进行一局卧底巨星/)
  assert.match(service, /where: \{ id: membership\.roomId, status: 'PLAYING' \},\s*data: \{ status: 'WAITING', currentMatchId: null/)
  // 同一房间可创建 Match2：start 不再因历史 Match 报错，且每局新建随机 id 的 Match。
  assert.doesNotMatch(service, /MATCH_ALREADY_EXISTS/)
  assert.match(service, /undercoverMatch\.count\(\{ where: \{ roomId/)
})

test('realtime client fails fast on a hanging upgrade, resyncs on connect, and only polls while disconnected', () => {
  const realtimeClient = source('lib/undercover-star-realtime-client.ts')
  assert.match(realtimeClient, /CONNECT_TIMEOUT_MS/)
  assert.match(realtimeClient, /'connect timeout'/)
  assert.match(realtimeClient, /private resync\(generation: number\)/)
  assert.match(realtimeClient, /this\.options\.fetchMatch\(this\.options\.matchId\)/)
  // Fallback starts on close, stops on open, and skips every tick the socket is open.
  assert.match(realtimeClient, /startFallback\(generation\)/)
  assert.match(realtimeClient, /this\.stopFallback\(\)/)
  assert.match(realtimeClient, /this\.socket\?\.readyState === OPEN_STATE/)
  assert.match(realtimeClient, /window\.setInterval\(\(\) => void poll\(\), 3_000\)/)
})

test('client component guards room updates and fetches the authoritative match snapshot when missing', () => {
  const client = source('app/games/undercover-star/UndercoverStarClient.tsx')
  const clientState = source('lib/undercover-star-client-state.ts')
  assert.match(clientState, /export function canApplyUndercoverRoomState/)
  assert.match(clientState, /next\.lastActivityAt >= current\.lastActivityAt/)
  assert.match(client, /canApplyUndercoverRoomState\(roomRef\.current, state\)/)
  assert.match(client, /roomRef\.current = state/)
  assert.match(client, /\/api\/entertainment\/undercover-star\/matches\/\$\{matchId\}/)
  assert.match(client, /canApplyUndercoverSnapshot\(snapshotRef\.current, data\.snapshot\)/)
})

test('match and private endpoints serve viewer-specific state and never the full role array', () => {
  const service = source('lib/undercover-star.ts')
  const matchRoute = source('app/api/entertainment/undercover-star/matches/[matchId]/route.ts')
  const privateRoute = source('app/api/entertainment/undercover-star/matches/[matchId]/private/route.ts')
  assert.match(matchRoute, /getUndercoverMatchSnapshot\(guard\.user\.id, matchId\)/)
  assert.match(privateRoute, /getUndercoverPrivateState\(guard\.user\.id, matchId\)/)
  assert.match(service, /match\.status === 'FINISHED' \? \{ role: player\.role, word: player\.word \}/)
  assert.doesNotMatch(matchRoute, /civilianWord|undercoverWord/u)
  assert.doesNotMatch(privateRoute, /civilianWord|undercoverWord/u)
})

// ---------------------------------------------------------------------------
// 身份隐藏回归测试：游戏中猜自己的身份，游戏结束后揭晓真相。
// 核心安全红线：PLAYING（含 ROLE_REVEAL 任何阶段）的 privateState 绝不能返回 role；
// 仅 FINISHED 才正式揭晓。否则用户开 DevTools 即可作弊。
// ---------------------------------------------------------------------------

type MockUser = {
  id: string
  uid: number
  name: string
  avatarUrl: string | null
  Profile: { displayName: string | null; displayNameModerationStatus: string; avatarUrl: string | null } | null
}

function mockUser(id: string, uid: number, name: string): MockUser {
  return { id, uid, name, avatarUrl: null, Profile: null }
}

function mockPlayer(id: string, userId: string, uid: number, name: string, role: 'CIVILIAN' | 'UNDERCOVER', word: string, isAlive = true) {
  return {
    id,
    role,
    word,
    roleConfirmedAt: null,
    isAlive,
    eliminatedAt: null,
    lastSeenAt: null,
    User: mockUser(userId, uid, name),
  }
}

function makeMatch(overrides: Record<string, unknown> = {}): MatchRow {
  const base: Record<string, unknown> = {
    id: 'match-1',
    roomId: 'room-1',
    status: 'PLAYING',
    phase: 'ROLE_REVEAL',
    round: 1,
    revision: 1,
    phaseDeadline: null,
    currentSpeakerId: 'player-1',
    undercoverGuessAt: null,
    Room: { id: 'room-1', roomCode: '123456', hostId: 'u1', status: 'PLAYING' },
    UndercoverMatchPlayer: [
      mockPlayer('player-1', 'u1', 1, '小明', 'UNDERCOVER', '苹果'),
      mockPlayer('player-2', 'u2', 2, '小红', 'CIVILIAN', '梨'),
      mockPlayer('player-3', 'u3', 3, '小张', 'CIVILIAN', '梨'),
    ],
    UndercoverDescription: [],
    UndercoverVote: [],
    roundHistory: [],
    tieCandidateIds: [],
    finalResult: null,
  }
  return { ...base, ...overrides } as unknown as MatchRow
}

function finishedFinalResult(): UndercoverFinalResult {
  return {
    winner: 'UNDERCOVER',
    reason: 'UNDERCOVER_GUESS_CORRECT',
    civilianWord: '梨',
    undercoverWord: '苹果',
    undercoverPlayerId: 'player-1',
    players: [
      { playerId: 'player-1', userId: 'u1', role: 'UNDERCOVER', word: '苹果', isAlive: true, totalVotesReceived: 0 },
      { playerId: 'player-2', userId: 'u2', role: 'CIVILIAN', word: '梨', isAlive: true, totalVotesReceived: 1 },
      { playerId: 'player-3', userId: 'u3', role: 'CIVILIAN', word: '梨', isAlive: false, totalVotesReceived: 2 },
    ],
  }
}

test('PLAYING + ROLE_REVEAL: privateState 不包含 role（只能拿到 word）', () => {
  const match = makeMatch({ phase: 'ROLE_REVEAL' })
  const state = privateState(match, 'u1')
  assert.equal(state.role, undefined)
  assert.equal(state.word, '苹果')
})

test('PLAYING + DESCRIPTION: privateState 不包含 role', () => {
  const match = makeMatch({ phase: 'DESCRIBING' })
  const state = privateState(match, 'u1')
  assert.equal(state.role, undefined)
  assert.equal(state.word, '苹果')
})

test('PLAYING + VOTE: privateState 不包含 role', () => {
  const match = makeMatch({ phase: 'VOTING' })
  const state = privateState(match, 'u1')
  assert.equal(state.role, undefined)
  assert.equal(state.word, '苹果')
})

test('PLAYING reconnect（任何阶段）: privateState 不包含 role', () => {
  for (const phase of ['ROLE_REVEAL', 'DESCRIBING', 'VOTING', 'TIE_VOTING', 'UNDERCOVER_GUESS']) {
    const match = makeMatch({ phase })
    const reconnected = privateState(match, 'u2')
    assert.equal(reconnected.role, undefined, `reconnect during PLAYING/${phase} must not leak role`)
    assert.ok(reconnected.word, `word must remain available during PLAYING/${phase}`)
  }
})

test('FINISHED: finalResult 包含所有玩家的 role', () => {
  const match = makeMatch({ status: 'FINISHED', phase: 'FINISHED', finalResult: finishedFinalResult() })
  const snapshot = matchSnapshot(match, new Date())
  assert.ok(snapshot.finalResult, 'FINISHED 必须返回 finalResult')
  for (const player of snapshot.finalResult!.players) {
    assert.ok(player.role === 'CIVILIAN' || player.role === 'UNDERCOVER', '每个玩家都必须有明确 role')
  }
})

test('FINISHED: 能明确识别哪个玩家是 UNDERCOVER', () => {
  const match = makeMatch({ status: 'FINISHED', phase: 'FINISHED', finalResult: finishedFinalResult() })
  const snapshot = matchSnapshot(match, new Date())
  const undercover = snapshot.finalResult!.players.filter((player) => player.role === 'UNDERCOVER')
  assert.equal(undercover.length, 1)
  assert.equal(undercover[0]!.playerId, 'player-1')
  assert.equal(snapshot.finalResult!.undercoverPlayerId, 'player-1')
})

test('FINISHED: 所有普通玩家显示 CIVILIAN', () => {
  const match = makeMatch({ status: 'FINISHED', phase: 'FINISHED', finalResult: finishedFinalResult() })
  const snapshot = matchSnapshot(match, new Date())
  for (const player of snapshot.finalResult!.players) {
    if (player.playerId !== 'player-1') assert.equal(player.role, 'CIVILIAN')
  }
})

test('FINISHED: 不同 viewer 看到的最终身份结果一致', () => {
  const match = makeMatch({ status: 'FINISHED', phase: 'FINISHED', finalResult: finishedFinalResult() })
  const snapshot = matchSnapshot(match, new Date())
  const undercoverViewer = privateState(match, 'u1')
  const civilianViewer = privateState(match, 'u2')
  assert.equal(undercoverViewer.role, 'UNDERCOVER')
  assert.equal(civilianViewer.role, 'CIVILIAN')
  // 公共快照对所有 viewer 一致：卧底身份唯一且相同。
  assert.equal(snapshot.finalResult!.undercoverPlayerId, 'player-1')
  assert.equal(snapshot.finalResult!.players.find((player) => player.playerId === 'player-1')!.role, 'UNDERCOVER')
  assert.equal(undercoverViewer.role, civilianViewer.role === 'CIVILIAN' ? 'UNDERCOVER' : 'UNDERCOVER')
})

// ===========================================================================
// Phase 3：房主踢人（kick）
// ===========================================================================

test('kick route 走服务端权限校验并广播剩余成员、单独通知被踢者', () => {
  const route = source('app/api/entertainment/undercover-star/rooms/[roomId]/kick/route.ts')
  const hub = source('lib/undercover-star-realtime.ts')
  // 1. 只把目标 userId 透传给服务层，不信任前端。
  assert.match(route, /kickUndercoverPlayer\(guard\.user\.id, roomId, targetUserId\)/)
  // 2. 剩余成员立即收到权威 ROOM_STATE（人数/准备数下降）。
  assert.match(route, /undercoverRealtimeHub\.broadcastRoom\(result\.affectedRoomId\)/)
  // 3. 只通知被踢玩家本人。
  assert.match(route, /undercoverRealtimeHub\.notifyRoomKicked\(roomId, targetUserId\)/)
  // 4. 复用既有 realtime hub，不另起第二套 websocket。
  assert.match(hub, /class UndercoverStarRealtimeHub/)
  assert.match(hub, /notifyRoomKicked\(roomId: string, targetUserId: string\)/)
})

test('kick 服务端权限规则：仅房主、非房主、非自己、WAITING、无当前对局', () => {
  const service = source('lib/undercover-star.ts')
  assert.match(service, /export async function kickUndercoverPlayer\(hostId: string, roomId: string, targetUserId: string/)
  // 仅房主可踢。
  assert.match(service, /if \(room\.hostId !== hostId\) throw new UndercoverStarServiceError\('只有房主可以踢出玩家。', 403, 'NOT_HOST'\)/)
  // 房主不能踢自己（应走退出房间逻辑）。
  assert.match(service, /if \(targetUserId === hostId\) throw new UndercoverStarServiceError\('房主不能踢出自己[^']*', 409, 'CANNOT_KICK_HOST'\)/)
  // WAITING 之外拒绝。
  assert.match(service, /throw new UndercoverStarServiceError\('房间不在等待状态，无法踢出玩家。', 409, 'ROOM_NOT_WAITING'\)/)
  // 有当前对局时拒绝。
  assert.match(service, /if \(room\.currentMatchId\) throw new UndercoverStarServiceError\('对局进行中，不能踢出玩家。', 409, 'MATCH_IN_PROGRESS'\)/)
})

test('PLAYING 进行中禁止踢人（currentMatch 真实 PLAYING）', () => {
  const service = source('lib/undercover-star.ts')
  // 即便房间状态非 WAITING，只要当前对局真实 PLAYING 也返回 MATCH_IN_PROGRESS。
  assert.match(service, /if \(currentMatch && currentMatch\.status === 'PLAYING'\) \{\s*throw new UndercoverStarServiceError\('对局进行中，不能踢出玩家。', 409, 'MATCH_IN_PROGRESS'\)/)
})

test('被踢玩家仅标记离开：leftAt 设置 + isReady 重置，不删除行', () => {
  const service = source('lib/undercover-star.ts')
  assert.match(service, /await tx\.undercoverRoomPlayer\.update\(\{ where: \{ id: target\.id \}, data: \{ leftAt: now, isReady: false, updatedAt: now \} \}\)/)
  // 不出现 delete。
  assert.doesNotMatch(service, /undercoverRoomPlayer\.delete\(/)
})

test('踢出后权威 room snapshot 不再包含该成员（roomInclude 已过滤 leftAt:null）', () => {
  const service = source('lib/undercover-star.ts')
  assert.match(service, /UndercoverRoomPlayer: \{\s*where: \{ leftAt: null \}/)
})

test('房间清空才关闭：剩余成员仍在房间', () => {
  const service = source('lib/undercover-star.ts')
  assert.match(service, /const remaining = await tx\.undercoverRoomPlayer\.count\(\{ where: \{ roomId, leftAt: null \} \}\)/)
  assert.match(service, /if \(!remaining\) await closeWaitingRoomTx\(tx, roomId, now\)/)
  assert.match(service, /else await tx\.undercoverRoom\.update\(\{ where: \{ id: roomId \}, data: \{ lastActivityAt: now, updatedAt: now \} \}\)/)
})

test('ROOM_KICKED 只发送给目标用户，不含成员列表/私密数据', () => {
  const hub = source('lib/undercover-star-realtime.ts')
  assert.match(hub, /notifyRoomKicked\(roomId: string, targetUserId: string\)/)
  assert.match(hub, /for \(const socket of \[\.\.\.sockets\]\) \{\s*if \(socket\.undercoverUserId === targetUserId\) safeSend\(socket, \{ type: 'ROOM_KICKED', roomId \}\)/)
  // 事件定义仅含 roomId，不含 word/role/MatchPlayer。
  const protocol = source('lib/undercover-star-protocol.ts')
  assert.match(protocol, /\| \{ type: 'ROOM_KICKED'; roomId: string \}/)
})

test('重复 kick 幂等：目标已离开时直接成功，不产生重复副作用', () => {
  const service = source('lib/undercover-star.ts')
  assert.match(service, /const target = room\.UndercoverRoomPlayer\.find\(\(item\) => item\.User\.id === targetUserId && !item\.leftAt\)/)
  assert.match(service, /if \(!target\) \{\s*\/\/ 幂等[^]*return \{ affectedRoomId: null as string \| null, kicked: false \}/)
})

test('被踢玩家之后可重新加入 WAITING 房间（kick 非永久封禁，无 kickBan）', () => {
  const service = source('lib/undercover-star.ts')
  // join 复用历史成员行并将 leftAt 置空，使被踢者能再次进入（不新增 ban 体系）。
  assert.match(service, /await tx\.undercoverRoomPlayer\.update\(\{ where: \{ id: historicalPlayer\.id \}, data: \{ leftAt: null, isReady: historicalPlayer\.leftAt \? false : historicalPlayer\.isReady/)
  // 本轮不引入任何黑名单/封禁字段。
  const schema = source('prisma/schema.prisma')
  assert.doesNotMatch(schema, /kickBan|bannedUserIds|KickBan|BannedUser/i)
})

test('卧底被投出进入最后猜词阶段：卧底本人视图 viewerUndercoverFound=true 且可猜词', () => {
  const match = makeMatch({ phase: 'UNDERCOVER_GUESS', currentSpeakerId: null, undercoverGuessAt: null })
  const undercoverView = matchSnapshot(match, new Date(), 'u1')
  assert.equal(undercoverView.phase, 'UNDERCOVER_GUESS')
  assert.equal(undercoverView.viewerUndercoverFound, true, '卧底本人应看到「你被发现了 / 进行最后猜词」')
  assert.equal(privateState(match, 'u1').canGuess, true, '卧底本人可提交猜词')
  // PLAYING 阶段安全红线：快照绝不泄露任何玩家角色/词
  const undercoverPlayer = undercoverView.players.find((player) => player.userId === 'u1')
  assert.equal(undercoverPlayer?.role, undefined)
})

test('卧底被投出进入最后猜词阶段：平民视图 viewerUndercoverFound=false 只看等待文案', () => {
  const match = makeMatch({ phase: 'UNDERCOVER_GUESS', currentSpeakerId: null, undercoverGuessAt: null })
  const civilianView = matchSnapshot(match, new Date(), 'u2')
  assert.equal(civilianView.phase, 'UNDERCOVER_GUESS')
  assert.equal(civilianView.viewerUndercoverFound, false, '平民不应看到「你被发现了」')
  assert.equal(privateState(match, 'u2').canGuess, false, '平民不可提交猜词')
  const civilianThree = matchSnapshot(match, new Date(), 'u3')
  assert.equal(civilianThree.viewerUndercoverFound, false, '另一名平民同样看不到被投出提示')
})

test('最后猜词阶段：不同身份玩家收到不同的 viewerUndercoverFound（接口层按 viewerId 区分）', () => {
  const match = makeMatch({ phase: 'UNDERCOVER_GUESS', currentSpeakerId: null, undercoverGuessAt: null })
  const undercover = matchSnapshot(match, new Date(), 'u1').viewerUndercoverFound
  const civilian = matchSnapshot(match, new Date(), 'u3').viewerUndercoverFound
  assert.notEqual(undercover, civilian, '卧底与平民的展示标记必须不同')
  assert.equal(undercover, true)
  assert.equal(civilian, false)
  // 卧底已提交猜词后标记失效（等待结算，最终进入 FINISHED）
  const guessed = makeMatch({ phase: 'UNDERCOVER_GUESS', undercoverGuessAt: new Date() })
  assert.equal(matchSnapshot(guessed, new Date(), 'u1').viewerUndercoverFound, false, '已猜词后不再提示被投出')
})
