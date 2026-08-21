import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { classifyDuelActiveMatch, getDuelRoomLifecycle, type DuelActiveMatchRecord } from '../lib/guess-song-duel-service'

function source(path: string) {
  return readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
}

test('room lifecycle does not treat a FINISHED room as active even with a stale PLAYING Match', () => {
  assert.equal(getDuelRoomLifecycle({ status: 'PLAYING', Match: null }), 'CLOSED')
  assert.equal(getDuelRoomLifecycle({ status: 'FINISHED', Match: { status: 'PLAYING' } }), 'FINISHED')
  assert.equal(getDuelRoomLifecycle({ status: 'CLOSED', Match: { status: 'FINISHED' } }), 'FINISHED')
  assert.equal(getDuelRoomLifecycle({ status: 'PLAYING', Match: { status: 'FINISHED' } }), 'FINISHED')
  assert.equal(getDuelRoomLifecycle({ status: 'PLAYING', Match: { status: 'INVALID' } }), 'FINISHED')
})

test('stale Match cleanup covers closed rooms, missing rooms, and players removed from a room', () => {
  const service = source('lib/guess-song-duel-service.ts')
  assert.match(service, /findDuelPlayerMatchesTx/)
  assert.match(service, /where: \{ userId, Match: \{ status: 'PLAYING' \} \}/)
  assert.match(service, /if \(!room\)/)
  assert.match(service, /status: 'INVALID'/)
  assert.match(service, /finishReason: 'DISCONNECT_INVALID'/)
  assert.match(service, /room\.status === 'PLAYING'/)
  assert.match(service, /userIds\.includes\(userId\)/)
  assert.match(service, /getDuelRoomLifecycle\(current\) === 'PLAYING'/)
  assert.match(service, /invalidateStaleDuelMatchTx\(tx, current\.Match\.id, current\.id, now\)/)
})

test('lobby exposes active state and normalizes stale Match rows', () => {
  const service = source('lib/guess-song-duel-service.ts')
  const route = source('app/api/entertainment/guess-song/duel/rooms/route.ts')
  const client = source('components/games/GuessSongDuel.tsx')
  assert.match(service, /export async function resolveActiveDuelForUser/)
  assert.match(service, /status: 'INVALID'/)
  assert.match(service, /finishReason: 'DISCONNECT_INVALID'/)
  assert.match(service, /activeRoom/)
  assert.match(service, /activeMatch/)
  assert.match(service, /isInActiveDuel/)
  assert.match(route, /resolveActiveDuelForUser/)
  assert.match(route, /isInActiveDuel: activeState\.isInActiveDuel/)
  assert.match(client, /currentRoomId\)\}\/leave/)
  assert.match(client, /async function resetAfterResult/)
})

test('historical Match status is ignored by the active-state normalizer', () => {
  const service = source('lib/guess-song-duel-service.ts')
  assert.match(service, /export async function normalizeUserDuelState/)
  assert.match(service, /if \(!activeRoom \|\| !activeMatch \|\| activeRoom\.id !== activeMatch\.roomId\) activeMatch = null/)
  assert.match(service, /waitingRooms\.slice\(1\)/)
  assert.match(service, /removeWaitingDuelMembershipTx\(tx, membership, userId, now\)/)
  assert.doesNotMatch(service, /where: \{ userId: \{ in: \[room\.hostId, room\.challengerId\] \}, Match: \{ status: 'PLAYING' \} \}/)
})

const activeNow = new Date('2026-08-15T12:00:00.000Z')
const fresh = new Date('2026-08-15T11:59:30.000Z')

function activeRecord(overrides: Partial<DuelActiveMatchRecord> = {}): DuelActiveMatchRecord {
  return {
    id: 'match-1',
    roomId: 'room-1',
    status: 'PLAYING',
    createdAt: fresh,
    startedAt: fresh,
    updatedAt: fresh,
    Room: {
      id: 'room-1',
      status: 'PLAYING',
      hostId: 'user-a',
      challengerId: 'user-b',
      closedAt: null,
      updatedAt: fresh,
      hostLastSeenAt: fresh,
      challengerLastSeenAt: fresh,
      Match: { id: 'match-1', status: 'PLAYING' },
    },
    GuessSongDuelPlayer: [
      { userId: 'user-a', isOnline: true, lastSeenAt: fresh, disconnectedAt: null, reconnectDeadlineAt: null, updatedAt: fresh },
      { userId: 'user-b', isOnline: true, lastSeenAt: fresh, disconnectedAt: null, reconnectDeadlineAt: null, updatedAt: fresh },
    ],
    ...overrides,
  }
}

test('the single active predicate accepts only a fresh, fully linked duel', () => {
  assert.deepEqual(classifyDuelActiveMatch(activeRecord(), 'user-a', activeNow), {
    active: true,
    reason: null,
    userIds: ['user-a', 'user-b'],
    roomId: 'room-1',
  })
})

test('PLAYING Match plus CLOSED Room is not active', () => {
  const base = activeRecord()
  const result = classifyDuelActiveMatch(activeRecord({ Room: { ...base.Room!, status: 'CLOSED' } }), 'user-a', activeNow)
  assert.equal(result.active, false)
  assert.equal(result.reason, 'ROOM_CLOSED')
})

test('PLAYING Match plus missing Room is not active', () => {
  const result = classifyDuelActiveMatch(activeRecord({ Room: null }), 'user-a', activeNow)
  assert.equal(result.active, false)
  assert.equal(result.reason, 'ROOM_MISSING')
})

test('PLAYING Match plus user no longer in Room is not active', () => {
  const base = activeRecord()
  const result = classifyDuelActiveMatch(activeRecord({ Room: { ...base.Room!, hostId: 'user-c' } }), 'user-a', activeNow)
  assert.equal(result.active, false)
  assert.equal(result.reason, 'USER_NOT_MEMBER')
})

test('PLAYING Match plus mismatched Room Match is not active', () => {
  const base = activeRecord()
  const result = classifyDuelActiveMatch(activeRecord({ Room: { ...base.Room!, Match: { id: 'old-match', status: 'PLAYING' } } }), 'user-a', activeNow)
  assert.equal(result.active, false)
  assert.equal(result.reason, 'ROOM_MATCH_MISMATCH')
})

test('historical Player rows alone never establish an active duel', () => {
  const result = classifyDuelActiveMatch(activeRecord({ GuessSongDuelPlayer: [] }), 'user-a', activeNow)
  assert.equal(result.active, false)
  assert.equal(result.reason, 'MATCH_PLAYERS_MISMATCH')
})

test('FINISHED, INVALID, DISCONNECT_INVALID, and CLOSED Match statuses are not active', () => {
  for (const status of ['FINISHED', 'INVALID', 'DISCONNECT_INVALID', 'CLOSED']) {
    const result = classifyDuelActiveMatch(activeRecord({ status }), 'user-a', activeNow)
    assert.equal(result.active, false, status)
  }
})

test('terminal finish metadata also prevents a corrupted PLAYING Match from becoming active', () => {
  assert.equal(classifyDuelActiveMatch(activeRecord({ finishReason: 'DISCONNECT_INVALID' }), 'user-a', activeNow).reason, 'DISCONNECT_INVALID')
  assert.equal(classifyDuelActiveMatch(activeRecord({ finishedAt: activeNow }), 'user-a', activeNow).active, false)
})

test('a stale PLAYING Match is invalid when no recent activity remains', () => {
  const old = new Date('2026-08-15T11:56:00.000Z')
  const base = activeRecord()
  const result = classifyDuelActiveMatch(activeRecord({
    createdAt: old,
    startedAt: old,
    updatedAt: old,
    Room: { ...base.Room!, updatedAt: old, hostLastSeenAt: old, challengerLastSeenAt: old },
    GuessSongDuelPlayer: base.GuessSongDuelPlayer.map((player) => ({ ...player, updatedAt: old, lastSeenAt: old })),
  }), 'user-a', activeNow)
  assert.equal(result.active, false)
  assert.equal(result.reason, 'STALE_MATCH')
})

test('an expired disconnect grace period is invalid', () => {
  const base = activeRecord()
  const result = classifyDuelActiveMatch(activeRecord({
    GuessSongDuelPlayer: [
      { ...base.GuessSongDuelPlayer[0], isOnline: false, reconnectDeadlineAt: new Date('2026-08-15T11:59:00.000Z') },
      base.GuessSongDuelPlayer[1],
    ],
  }), 'user-a', activeNow)
  assert.equal(result.active, false)
  assert.equal(result.reason, 'DISCONNECT_INVALID')
})

test('activeRoom and activeMatch are forced to come from one linked room', () => {
  const service = source('lib/guess-song-duel-service.ts')
  assert.match(service, /activeRoom\.id !== activeMatch\.roomId/)
  assert.match(service, /isInActiveDuel: Boolean\(activeRoom && activeMatch && activeRoom\.id === activeMatch\.roomId\)/)
})

test('production audit is read-only by default and has an explicit apply switch', () => {
  const script = source('scripts/audit-guess-song-duel-state.ts')
  assert.match(script, /const apply = args\.has\('--apply'\)/)
  assert.match(script, /mode: apply \? 'APPLY' : 'DRY_RUN'/)
  assert.match(script, /if \(apply && stale\.length\) await applyInvalidations/)
})

test('create and join clean old waiting memberships while preserving a real active match', () => {
  const service = source('lib/guess-song-duel-service.ts')
  assert.match(service, /const state = await resolveDuelActiveStateTx\(tx, userId, now\)/)
  assert.match(service, /if \(options\.rejectPlaying && state\.activeMatch && state\.activeMatch\.roomId !== options\.keepRoomId\)/)
  assert.match(service, /const memberships = await findAndLockDuelMembershipsTx\(tx, userId\)/)
  assert.match(service, /if \(membership\.id === options\.keepRoomId\) continue/)
  assert.match(service, /removeWaitingDuelMembershipTx\(tx, membership, userId, now\)/)
})

test('start resolves host and guest independently with distinct active-duel errors', () => {
  const service = source('lib/guess-song-duel-service.ts')
  assert.match(service, /const hostState = await resolveDuelActiveStateTx\(tx, hostId, now\)/)
  assert.match(service, /const guestState = await resolveDuelActiveStateTx\(tx, guestId, now\)/)
  assert.match(service, /'HOST_ACTIVE_DUEL'/)
  assert.match(service, /'GUEST_ACTIVE_DUEL'/)
})

test('the banner is server-state-only and its close action rechecks the server', () => {
  const client = source('components/games/GuessSongDuel.tsx')
  assert.doesNotMatch(client, /localStorage|sessionStorage/)
  assert.doesNotMatch(client, /setActiveDuel\(nextRoom\.matchId/)
  assert.match(client, /setActiveDuel\(\{ activeRoom: roomData\.activeRoom/)
  assert.match(client, /activeDuel\.isInActiveDuel && activeDuel\.activeRoom && activeDuel\.activeMatch/)
  assert.match(client, /aria-label="重新检查对局状态"[\s\S]*?onClick=\{\(\) => void loadLobby\(\)\}/)
})

test('returning to the lobby awaits leave and then reloads unified active state', () => {
  const client = source('components/games/GuessSongDuel.tsx')
  assert.match(client, /await api\(`\/api\/entertainment\/guess-song\/duel\/rooms\/\$\{encodeURIComponent\(currentRoomId\)\}\/leave`/)
  assert.match(client, /resetToLobby\(\)\r?\n    await loadLobby\(\)/)
  assert.match(source('lib/guess-song-duel-service.ts'), /export async function leaveDuelRoom[\s\S]*?const normalized = await resolveDuelActiveStateTx\(tx, userId, now\)/)
})

test('reconnect and disconnect presence use the canonical active state', () => {
  const service = source('lib/guess-song-duel-service.ts')
  assert.match(service, /export async function markDuelPlayerConnected[\s\S]*?normalizeUserDuelState\(userId, now\)/)
  assert.match(service, /export async function markDuelPlayerDisconnected[\s\S]*?normalizeUserDuelState\(userId, now\)/)
})
