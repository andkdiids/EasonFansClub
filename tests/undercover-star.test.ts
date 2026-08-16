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
import { canApplyUndercoverPrivateState, canApplyUndercoverSnapshot } from '../lib/undercover-star-client-state'
import type { UndercoverPrivateState, UndercoverPublicMatchSnapshot } from '../lib/undercover-star-protocol'

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
    players: [],
    descriptions: [],
    voteProgress: { submitted: 0, total: 3, stage: null },
    tieCandidates: [],
    roundHistory: [],
    lastRoundResult: null,
    finalResult: null,
  } as UndercoverPublicMatchSnapshot
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
  assert.match(schema, /roomId\s+String\s+@unique/)
  assert.match(schema, /@@index\(\[status, finishedAt\]\)/)
  assert.doesNotMatch(migration, /DROP TABLE|DROP COLUMN|TRUNCATE/i)
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
  const client = source('app/games/undercover-star/UndercoverStarClient.tsx')
  const protocol = source('lib/undercover-star-protocol.ts')
  assert.match(service, /status: 'FINISHED', UndercoverMatchPlayer: \{ some: \{ userId \} \}/)
  assert.match(service, /activeMatch: finishedMatch \? \{ matchId: finishedMatch\.id, roomId: finishedMatch\.roomId, status: finishedMatch\.status \}/)
  assert.match(protocol, /activeMatch: \{ matchId: string; roomId: string; status: UndercoverMatchStatus \} \| null/)
  assert.match(client, /activeMatch\?\.status === 'FINISHED'/)
})
