import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { getDuelRoomLifecycle, isValidActiveDuelMembership } from '../lib/guess-song-duel-service'

function source(path: string) {
  return readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
}

const activeMembership = {
  userId: 'user-a',
  matchId: 'match-1',
  matchStatus: 'PLAYING',
  room: {
    id: 'room-1',
    status: 'PLAYING',
    hostId: 'user-a',
    challengerId: 'user-b',
    matchId: 'match-1',
    matchStatus: 'PLAYING',
  },
} as const

test('only a matching PLAYING room and Match block a new duel', () => {
  assert.equal(isValidActiveDuelMembership(activeMembership, 'user-a'), true)
  assert.equal(isValidActiveDuelMembership({ ...activeMembership, matchStatus: 'FINISHED' }, 'user-a'), false)
  assert.equal(isValidActiveDuelMembership({ ...activeMembership, room: { ...activeMembership.room, status: 'FINISHED' } }, 'user-a'), false)
  assert.equal(isValidActiveDuelMembership({ ...activeMembership, room: { ...activeMembership.room, status: 'CLOSED' } }, 'user-a'), false)
  assert.equal(isValidActiveDuelMembership({ ...activeMembership, room: { ...activeMembership.room, status: 'INVALID' } }, 'user-a'), false)
  assert.equal(isValidActiveDuelMembership({ ...activeMembership, room: { ...activeMembership.room, matchId: 'old-match' } }, 'user-a'), false)
  assert.equal(isValidActiveDuelMembership({ ...activeMembership, room: { ...activeMembership.room, matchStatus: 'FINISHED' } }, 'user-a'), false)
  assert.equal(isValidActiveDuelMembership({ ...activeMembership, room: { ...activeMembership.room, hostId: 'user-c', challengerId: 'user-b' } }, 'user-a'), false)
  assert.equal(isValidActiveDuelMembership({ ...activeMembership, room: null }, 'user-a'), false)
  assert.equal(isValidActiveDuelMembership(activeMembership, 'user-c'), false)
})

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
  assert.match(service, /room\?\.status === 'PLAYING'/)
  assert.match(service, /record\.room\.hostId === userId \|\| record\.room\.challengerId === userId/)
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
  assert.match(service, /if \(player\.Match\.status !== 'PLAYING'\) continue/)
  assert.match(service, /if \(!activeRoom\) activeMatch = null/)
  assert.match(service, /waitingRooms\.slice\(1\)/)
  assert.match(service, /removeWaitingDuelMembershipTx\(tx, membership, userId, now\)/)
  assert.doesNotMatch(service, /where: \{ userId: \{ in: \[room\.hostId, room\.challengerId\] \}, Match: \{ status: 'PLAYING' \} \}/)
})
