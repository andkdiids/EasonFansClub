import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { getDuelRoomLifecycle, isValidActiveDuelMembership } from '../lib/guess-song-duel-service'

function source(path: string) {
  return readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
}

test('active room lifecycle distinguishes WAITING, PLAYING, historical FINISHED and CLOSED', () => {
  assert.equal(getDuelRoomLifecycle({ status: 'WAITING', Match: null }), 'WAITING')
  assert.equal(getDuelRoomLifecycle({ status: 'READY', Match: null }), 'WAITING')
  assert.equal(getDuelRoomLifecycle({ status: 'PLAYING', Match: { status: 'PLAYING' } }), 'PLAYING')
  assert.equal(getDuelRoomLifecycle({ status: 'WAITING', Match: { status: 'FINISHED' } }), 'FINISHED')
  assert.equal(getDuelRoomLifecycle({ status: 'CLOSED', Match: null }), 'CLOSED')
  assert.equal(getDuelRoomLifecycle({ status: 'FINISHED', Match: { status: 'PLAYING' } }), 'FINISHED')
})

test('only a PLAYING match with a matching PLAYING room membership is active', () => {
  const base = {
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

  assert.equal(isValidActiveDuelMembership(base, 'user-a'), true)
  assert.equal(isValidActiveDuelMembership({ ...base, matchStatus: 'FINISHED' }, 'user-a'), false)
  assert.equal(isValidActiveDuelMembership({ ...base, room: { ...base.room, status: 'FINISHED' } }, 'user-a'), false)
  assert.equal(isValidActiveDuelMembership({ ...base, room: { ...base.room, matchId: 'old-match' } }, 'user-a'), false)
  assert.equal(isValidActiveDuelMembership({ ...base, room: { ...base.room, matchStatus: 'FINISHED' } }, 'user-a'), false)
  assert.equal(isValidActiveDuelMembership({ ...base, room: null }, 'user-a'), false)
  assert.equal(isValidActiveDuelMembership(base, 'user-c'), false)
})

test('创建和加入共享用户锁、旧 WAITING 清理、PLAYING 阻止切房', () => {
  const service = source('lib/guess-song-duel-service.ts')
  assert.match(service, /SELECT id FROM User WHERE id = \$\{userId\} FOR UPDATE/)
  assert.match(service, /cleanupDuelMembershipTx\(tx, userId, now, \{ rejectPlaying: true \}\)/)
  assert.match(service, /keepRoomId: roomId, rejectPlaying: true/)
  assert.match(service, /'MATCH_ACTIVE'/)
  assert.match(service, /status IN \('WAITING', 'READY', 'PLAYING'\)/)
})

test('公开列表只返回无密码、WAITING、未满且没有历史 Match 的房间', () => {
  const service = source('lib/guess-song-duel-service.ts')
  assert.match(service, /isPublic: true/)
  assert.match(service, /passwordHash: null/)
  assert.match(service, /status: 'WAITING'/)
  assert.match(service, /challengerId: null/)
  assert.match(service, /Match: null/)
})

test('房间号由服务端生成，客户端房间创建不再提交 roomCode 或 isPublic', () => {
  const service = source('lib/guess-song-duel-service.ts')
  const client = source('components/games/GuessSongDuel.tsx')
  assert.match(service, /ROOM_CODE_SERVER_GENERATED/)
  assert.match(service, /randomInt\(100_000, 1_000_000\)/)
  assert.match(service, /isPublic: !password/)
  assert.match(client, /body: JSON\.stringify\(\{ password: roomPassword \|\| undefined, mode: selectedMode \}\)/)
  assert.doesNotMatch(client, /name="roomCode"|name="isPublic"/)
})

test('房主离开无 Match 的 WAITING 房间会删除房间，挑战者离开只恢复空位', () => {
  const service = source('lib/guess-song-duel-service.ts')
  assert.match(service, /if \(current\.hostId === userId\)/)
  assert.match(service, /tx\.guessSongDuelRoom\.delete\(\{ where: \{ id: roomId \} \}\)/)
  assert.match(service, /challengerId: null, hostReady: false, challengerReady: false, status: 'WAITING'/)
  assert.match(service, /if \(current\.Match\) \{[\s\S]*?status: 'CLOSED'/)
})

test('搜索允许私密房间但 room state 不包含密码 hash，历史 Match 不可搜索加入', () => {
  const service = source('lib/guess-song-duel-service.ts')
  const protocol = source('lib/guess-song-duel-protocol.ts')
  assert.match(service, /getDuelRoomLifecycle\(room\) !== 'WAITING'/)
  assert.match(service, /return roomState\(room\)/)
  assert.doesNotMatch(protocol.match(/export type DuelRoomState[\s\S]*?\n}/)?.[0] || '', /passwordHash/)
})

test('房间大厅 UI 删除两处冗余说明且不改变创建/搜索控件', () => {
  const client = source('components/games/GuessSongDuel.tsx')
  assert.doesNotMatch(client, /房间号由系统自动生成|输入房间号搜索；密码房间不会返回密码本身|房间号留空时自动生成 6 位数字|密码只保存为 hash/)
  assert.match(client, /<h2>创建房间<\/h2>/)
  assert.match(client, /<h2>加入房间<\/h2>/)
  assert.match(client, /placeholder="输入房间号"/)
})
