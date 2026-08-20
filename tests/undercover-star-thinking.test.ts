import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'
import assert from 'node:assert/strict'
import { matchSnapshot, privateState, type MatchRow } from '@/lib/undercover-star'
import { THINKING_DURATION_MS } from '@/lib/undercover-star-config'
import { canApplyUndercoverSnapshot } from '@/lib/undercover-star-client-state'
import type { UndercoverPublicMatchSnapshot } from '@/lib/undercover-star-protocol'

const root = join(process.cwd())
const service = readFileSync(join(root, 'lib/undercover-star.ts'), 'utf8')
const client = readFileSync(join(root, 'app/games/undercover-star/UndercoverStarClient.tsx'), 'utf8')
const realtime = readFileSync(join(root, 'lib/undercover-star-realtime.ts'), 'utf8')
const realtimeClient = readFileSync(join(root, 'lib/undercover-star-realtime-client.ts'), 'utf8')
const leaveRoute = readFileSync(join(root, 'app/api/entertainment/undercover-star/rooms/[roomId]/leave/route.ts'), 'utf8')
const schema = readFileSync(join(root, 'prisma/schema.prisma'), 'utf8')
const migration = readFileSync(join(root, 'prisma/migrations/20260820150000_undercover_star_thinking_phase/migration.sql'), 'utf8')

function user(id: string, name: string) {
  return { id, uid: id, nickname: name, username: id, usernameModerationStatus: null, nicknameModerationStatus: null, Profile: { displayName: null, displayNameModerationStatus: null, avatarUrl: null }, avatarUrl: null, UndercoverStats: { level: 1 } }
}

function player(id: string, userId: string, name: string, role: 'CIVILIAN' | 'UNDERCOVER', isAlive = true) {
  return { id, role, word: role === 'UNDERCOVER' ? '卧底词' : '平民词', isAlive, roleConfirmedAt: null, eliminatedAt: null, lastSeenAt: null, User: user(userId, name) }
}

function description(id: string, content: string) {
  return { id: `d-${id}`, matchPlayerId: id, round: 1, content, isAuto: false, createdAt: new Date('2026-08-20T10:00:00.000Z'), matchId: 'match-1' }
}

function makeMatch(overrides: Record<string, unknown> = {}) {
  return {
    id: 'match-1',
    roomId: 'room-1',
    status: 'PLAYING',
    phase: 'THINKING',
    round: 1,
    revision: 20,
    civilianWord: '平民词',
    undercoverWord: '卧底词',
    speakingOrder: ['p1', 'p2', 'p3', 'p4'],
    currentSpeakerId: null,
    currentSpeakerIndex: null,
    phaseDeadline: new Date('2026-08-20T10:00:15.000Z'),
    tieCandidateIds: null,
    roundHistory: null,
    undercoverGuess: null,
    undercoverGuessCorrect: null,
    undercoverGuessAt: null,
    finalResult: null,
    Room: { id: 'room-1', roomCode: '123456', hostId: 'u1', status: 'PLAYING' },
    UndercoverMatchPlayer: [
      player('p1', 'u1', 'A', 'CIVILIAN'),
      player('p2', 'u2', 'B', 'CIVILIAN'),
      player('p3', 'u3', 'CIVILIAN', 'CIVILIAN'),
      player('p4', 'u4', 'D', 'UNDERCOVER'),
    ],
    UndercoverDescription: [description('p1', '描述A'), description('p2', '描述B'), description('p3', '描述C'), description('p4', '描述D')],
    UndercoverVote: [],
    ...overrides,
  } as unknown as MatchRow
}

function snapshot(revision: number, phase: UndercoverPublicMatchSnapshot['phase']) {
  return { matchId: 'match-1', roomId: 'room-1', status: 'PLAYING', phase, round: 1, revision, serverNow: '2026-08-20T10:00:00.000Z', phaseDeadline: '2026-08-20T10:00:15.000Z', currentSpeakerId: null, viewerUndercoverFound: false, players: [], descriptions: [], descriptionHistory: [], voteProgress: { submitted: 0, total: 4, stage: null, abstained: 0 }, tieCandidates: [], roundHistory: [], lastRoundResult: null, finalResult: null } as UndercoverPublicMatchSnapshot
}

test('THINKING is a single shared 15-second server deadline', () => {
  assert.equal(THINKING_DURATION_MS, 15_000)
  assert.match(schema, /enum UndercoverMatchPhase \{[\s\S]*?DESCRIBING\s+THINKING\s+VOTING/)
  assert.match(migration, /MODIFY COLUMN `phase` ENUM\([^)]*'THINKING'/)
  assert.match(service, /phase: 'THINKING'[\s\S]*?phaseDeadline: new Date\(now\.getTime\(\) \+ THINKING_DURATION_MS\)/)
})

test('four-player simulation: A/B/C/D descriptions end in THINKING, never direct VOTING', () => {
  const match = makeMatch()
  const state = matchSnapshot(match, new Date('2026-08-20T10:00:00.000Z'))
  assert.equal(state.phase, 'THINKING')
  assert.equal(state.descriptions.filter((item) => item.round === 1).length, 4)
  assert.deepEqual(state.descriptions.map((item) => item.content), ['描述A', '描述B', '描述C', '描述D'])

  const transition = service.slice(service.indexOf('async function moveAfterDescriptionTx'), service.indexOf('async function submitDescriptionTx'))
  assert.match(transition, /phase: 'THINKING'/)
  assert.doesNotMatch(transition, /phase: 'VOTING'/)
})

test('THINKING snapshot keeps the last description and disables both actions', () => {
  const match = makeMatch()
  const state = matchSnapshot(match, new Date('2026-08-20T10:00:07.000Z'), 'u1')
  const privateView = privateState(match, 'u1')
  assert.equal(state.phase, 'THINKING')
  assert.equal(state.phaseDeadline, '2026-08-20T10:00:15.000Z')
  assert.equal(state.descriptionHistory.find((entry) => entry.round === 1)?.descriptions.at(-1)?.content, '描述D')
  assert.equal(privateView.canDescribe, false)
  assert.equal(privateView.canVote, false)
  assert.match(client, /本轮描述结束/)
  assert.match(client, /想想谁最可疑/)
})

test('refresh after seven seconds uses the same deadline and shows eight seconds', () => {
  const match = makeMatch()
  const state = matchSnapshot(match, new Date('2026-08-20T10:00:07.000Z'))
  const remaining = Math.ceil((new Date(state.phaseDeadline!).getTime() - new Date(state.serverNow).getTime()) / 1000)
  assert.equal(remaining, 8)
  assert.match(client, /serverOffset/)
  assert.match(client, /new Date\(deadline\)\.getTime\(\) - \(now \+ serverOffset\)/)
})

test('expired THINKING transitions once; VOTING is the only phase allowed to accept votes', () => {
  const advance = service.slice(service.indexOf('export async function advanceExpiredUndercoverMatch'), service.indexOf('export async function touchUndercoverPresence'))
  assert.match(advance, /if \(match\.phase === 'THINKING'\) \{[\s\S]*?transitionToVotingTx\(tx, match, now\)/)
  assert.match(service, /phase: 'THINKING',[\s\S]*?phaseDeadline: \{ lte: now \}/)
  assert.match(service, /const stage: UndercoverVoteStage = match\.phase === 'VOTING'/)
  assert.match(service, /phase === 'VOTING' \|\| match\.phase === 'TIE_VOTING'/)
})

test('duplicate description replay returns authoritative state without resetting thinkingEndsAt', () => {
  const submit = service.slice(service.indexOf('export async function submitUndercoverDescription'), service.indexOf('function currentRoundDescriptions'))
  assert.match(submit, /const existing = await tx\.undercoverDescription\.findUnique/)
  assert.match(submit, /if \(existing\) return/)
  assert.match(service, /if \(match\.phase !== 'DESCRIBING'\) throw new UndercoverStarServiceError\('当前不是描述阶段。'/)
  assert.doesNotMatch(submit, /THINKING_DURATION_MS/)
})

test('stale VOTING client never rolls back to THINKING', () => {
  assert.equal(canApplyUndercoverSnapshot(snapshot(102, 'VOTING'), snapshot(101, 'THINKING')), false)
  assert.equal(canApplyUndercoverSnapshot(snapshot(102, 'VOTING'), snapshot(102, 'THINKING')), false)
})

test('realtime and fallback both use the persisted deadline, and leave broadcasts the updated match', () => {
  assert.match(realtime, /scheduleMatch\(matchId, snapshot\.phaseDeadline\)/)
  assert.match(realtime, /await getUndercoverMatchSnapshot/)
  assert.match(realtimeClient, /fallbackTimer/)
  assert.match(realtimeClient, /syncMatchState\(\)/)
  assert.match(leaveRoute, /broadcastMatchState\(result\.match\.matchId\)/)
  assert.match(leaveRoute, /scheduleMatch\(result\.match\.matchId, result\.match\.phaseDeadline\)/)
})

test('player exit is a server state-machine event: valid-player recalculation and undercover immediate win', () => {
  assert.match(service, /handleUndercoverPlayerExitTx/)
  assert.match(service, /activeMatchPlayers\(refreshed\)/)
  assert.match(service, /player\.role === 'UNDERCOVER'[\s\S]*?finishMatchTx\(tx, refreshed, 'CIVILIAN', 'UNDERCOVER_EXIT'/)
  assert.match(service, /alive\.length <= 2 && undercoverAlive/)
  assert.match(service, /phase === 'DESCRIBING'[\s\S]*?moveAfterDescriptionTx/)
})

test('next round explicitly resets the old thinking deadline', () => {
  const nextRound = service.slice(service.indexOf('async function startNextRoundTx'), service.indexOf('async function setRoleRevealConfirmedTx'))
  assert.match(nextRound, /phase: 'DESCRIBING'/)
  assert.match(nextRound, /round: match\.round \+ 1/)
  assert.match(nextRound, /phaseDeadline: new Date\(now\.getTime\(\) \+ UNDERCOVER_DESCRIPTION_MS\)/)
})
