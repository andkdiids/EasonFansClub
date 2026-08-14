import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import {
  DUEL_ANSWER_SECONDS,
  DUEL_AUDIO_DELAY_MS,
  DUEL_HEARTBEAT_INTERVAL_MS,
  DUEL_MIN_VALID_QUESTIONS,
  DUEL_ONLINE_TIMEOUT_MS,
  DUEL_RECONNECT_GRACE_MS,
  DUEL_ROOM_POLL_INTERVAL_MS,
  DUEL_WAITING_ROOM_TTL_MS,
  DUEL_TARGET_CORRECT,
  DUEL_TOTAL_QUESTIONS,
  DUEL_WIN_REWARD,
  isDuelPresenceOnline,
  isDuelWaitingRoomExpired,
  normalizeDuelPassword,
  normalizeDuelRoomCode,
} from '../lib/guess-song-duel-config'
import { compareDuelPlayers, effectiveElapsedMs } from '../lib/guess-song-duel-service'

function source(path: string) {
  return readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
}

test('对决常量保持独立于单人听听规则', () => {
  assert.equal(DUEL_TOTAL_QUESTIONS, 30)
  assert.equal(DUEL_TARGET_CORRECT, 16)
  assert.equal(DUEL_AUDIO_DELAY_MS, 2_000)
  assert.equal(DUEL_ANSWER_SECONDS, 10)
  assert.equal(DUEL_RECONNECT_GRACE_MS, 15_000)
  assert.equal(DUEL_MIN_VALID_QUESTIONS, 5)
  assert.equal(DUEL_WIN_REWARD, 7)
  assert.equal(normalizeDuelRoomCode('727270'), '727270')
  assert.equal(normalizeDuelRoomCode('72 7270'), null)
  assert.equal(normalizeDuelRoomCode(' 727270 '), null)
  assert.equal(normalizeDuelPassword('Ab12'), 'Ab12')
  assert.equal(normalizeDuelPassword('密码'), null)
})

test('结算优先比较正确数，再比较所有答对题目的有效耗时，完全相同才平局', () => {
  assert.deepEqual(compareDuelPlayers([
    { userId: 'a', correctCount: 15, totalEffectiveAnswerMs: 1000 },
    { userId: 'b', correctCount: 14, totalEffectiveAnswerMs: 10 },
  ]), { winnerId: 'a', isDraw: false })
  assert.deepEqual(compareDuelPlayers([
    { userId: 'a', correctCount: 14, totalEffectiveAnswerMs: 38000 },
    { userId: 'b', correctCount: 14, totalEffectiveAnswerMs: 41930 },
  ]), { winnerId: 'a', isDraw: false })
  assert.deepEqual(compareDuelPlayers([
    { userId: 'a', correctCount: 14, totalEffectiveAnswerMs: 41930 },
    { userId: 'b', correctCount: 14, totalEffectiveAnswerMs: 41930 },
  ]), { winnerId: null, isDraw: true })
})

test('服务端有效耗时只把 RTT 估计作为有限补偿，不能由 clientElapsed 直接决定', () => {
  const start = new Date('2026-08-14T00:00:00.000Z')
  assert.equal(effectiveElapsedMs(new Date(start.getTime() + 2_000), start, 400), 1_600)
  assert.equal(effectiveElapsedMs(new Date(start.getTime() + 12_000), start, 10_000), 10_000)
  const service = source('lib/guess-song-duel-service.ts')
  assert.match(service, /receivedAt.*audioStartAt/)
  assert.match(service, /latencyEstimateMs/)
  assert.match(service, /clientElapsedMs.*clampClientElapsed/)
  assert.match(service, /isSuspiciousAnswer/)
})

test('题目和正确答案由服务端创建，客户端协议不下发活动题正确答案或未来题答案', () => {
  const service = source('lib/guess-song-duel-service.ts')
  const protocol = source('lib/guess-song-duel-protocol.ts')
  assert.match(service, /shuffle\(candidates\)\.slice\(0, DUEL_TOTAL_QUESTIONS\)/)
  assert.match(service, /optionsSnapshot: built\.options/)
  assert.match(service, /correctOptionKey: built\.correctOptionKey/)
  assert.match(service, /questionToken: string/)
  assert.match(protocol, /type DuelQuestionState = \{[\s\S]*?options: DuelOption\[\]/)
  assert.doesNotMatch(protocol.match(/export type DuelQuestionState[\s\S]*?\n\}/)?.[0] || '', /correctOptionKey/)
})

test('比赛结算、奖励、断线和成就使用持久化幂等路径', () => {
  const service = source('lib/guess-song-duel-service.ts')
  const schema = source('prisma/schema.prisma')
  const migration = source('prisma/migrations/20260814150000_add_guess_song_duel/migration.sql')
  assert.match(schema, /model GuessSongDuelRoom \{/)
  assert.match(schema, /model GuessSongDuelMatch \{/)
  assert.match(schema, /model GuessSongDuelAnswer \{/)
  assert.match(service, /businessKey: `guess-song-duel-reward:\$\{input\.winnerId\}:\$\{dateKey\}`/)
  assert.match(service, /getShanghaiDayRange\(input\.now\)/)
  assert.match(service, /completedQuestionCount >= DUEL_MIN_VALID_QUESTIONS/)
  assert.match(service, /syncUserAchievements\(userId, \['DUEL'\]\)/)
  assert.match(migration, /GUESS_SONG_DUEL_WIN/)
  assert.doesNotMatch(service, /Math\.random\(\).*winner|random.*winner/i)
})

test('Duel presence uses a five-second client heartbeat and a twenty-second server timeout', () => {
  const now = Date.parse('2026-08-14T00:00:00.000Z')
  assert.equal(DUEL_HEARTBEAT_INTERVAL_MS, 5_000)
  assert.equal(DUEL_ONLINE_TIMEOUT_MS, 20_000)
  assert.equal(isDuelPresenceOnline(now - 19_999, now), true)
  assert.equal(isDuelPresenceOnline(now - 20_001, now), false)
  assert.equal(isDuelPresenceOnline(null, now), false)
  assert.equal(isDuelPresenceOnline(now + 1, now), false)

  const service = source('lib/guess-song-duel-service.ts')
  const realtime = source('lib/guess-song-duel-realtime.ts')
  const client = source('components/games/GuessSongDuel.tsx')
  const startRoute = source('app/api/entertainment/guess-song/duel/rooms/[roomId]/start/route.ts')
  assert.match(service, /hostLastSeenAt/)
  assert.match(service, /challengerLastSeenAt/)
  assert.match(service, /touchDuelRoomPresence/)
  assert.match(service, /guestOnline/)
  assert.match(realtime, /case 'PING':/)
  assert.match(realtime, /touchPresence\(socket\)/)
  assert.match(client, /setInterval\(sendHeartbeat, DUEL_HEARTBEAT_INTERVAL_MS\)/)
  assert.match(client, /visibilitychange/)
  assert.doesNotMatch(startRoute, /isUserConnectedInRoom/)
})

test('等待房间在三十分钟后过期，但进行中的对局不受等待 TTL 影响', () => {
  const now = Date.parse('2026-08-14T00:00:00.000Z')
  assert.equal(DUEL_ROOM_POLL_INTERVAL_MS, 2_500)
  assert.equal(DUEL_WAITING_ROOM_TTL_MS, 30 * 60_000)
  assert.equal(isDuelWaitingRoomExpired('WAITING', now - DUEL_WAITING_ROOM_TTL_MS, now), true)
  assert.equal(isDuelWaitingRoomExpired('READY', now - DUEL_WAITING_ROOM_TTL_MS - 1, now), true)
  assert.equal(isDuelWaitingRoomExpired('WAITING', now - DUEL_WAITING_ROOM_TTL_MS + 1, now), false)
  assert.equal(isDuelWaitingRoomExpired('PLAYING', now - 24 * 60 * 60_000, now), false)
  assert.equal(isDuelWaitingRoomExpired('FINISHED', now - 24 * 60 * 60_000, now), false)
})

test('开始接口返回完整房间和对局，客户端轮询并在对局数据未到时显示同步状态', () => {
  const service = source('lib/guess-song-duel-service.ts')
  const startRoute = source('app/api/entertainment/guess-song/duel/rooms/[roomId]/start/route.ts')
  const client = source('components/games/GuessSongDuel.tsx')
  const realtime = source('lib/guess-song-duel-realtime.ts')
  assert.match(service, /room.status === 'PLAYING'/)
  assert.match(service, /reused: true/)
  assert.match(service, /GuessSongDuelQuestion: \{ create: questions \}/)
  assert.match(startRoute, /return duelOk\(\{ room, matchId: result\.matchId, serverStartAt: result\.serverStartAt, match \}\)/)
  assert.match(client, /DUEL_ROOM_POLL_INTERVAL_MS/)
  assert.match(client, /syncDuelState/)
  assert.match(client, /正在同步对局，请稍候/)
  assert.match(client, /new AbortController\(\)/)
  assert.match(realtime, /getDuelMatchParticipantId/)
  assert.doesNotMatch(realtime, /const socket = this\.firstMatchSocket\(matchId\)\n      if \(!socket\?\.duelUserId\) return/)
})

test('过期等待房间会在列表、查询和创建同号房间时被处理，PLAYING 房间不会被清理', () => {
  const service = source('lib/guess-song-duel-service.ts')
  assert.match(service, /markExpiredWaitingDuelRooms\(now\)/)
  assert.match(service, /createdAt: \{ gte: cutoff \}/)
  assert.match(service, /isDuelWaitingRoomExpired\(room\.status, room\.createdAt\)/)
  assert.match(service, /const reusable = !existing\.Match && \(existing\.status === 'CLOSED' \|\| isDuelWaitingRoomExpired\(existing\.status, existing\.createdAt, now\.getTime\(\)\)\)/)
  assert.match(service, /tx\.guessSongDuelRoom\.delete\(\{ where: \{ id: existing\.id \} \}\)/)
  assert.match(service, /status: \{ in: \['WAITING', 'READY'\]\s*\}/)
  assert.doesNotMatch(service, /status: \{ in: \['WAITING', 'READY', 'PLAYING'\]\}/)
})
