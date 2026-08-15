import 'dotenv/config'
import { Prisma } from '@prisma/client'
import { prisma } from '../lib/prisma'
import { classifyDuelActiveMatch, type DuelActiveMatchRecord, type DuelStaleReason } from '../lib/guess-song-duel-service'

type RawMatch = {
  id: string
  roomId: string | null
  status: string
  finishReason: string | null
  createdAt: Date | string
  startedAt: Date | string
  updatedAt: Date | string
  finishedAt: Date | string | null
  room_id: string | null
  room_status: string | null
  room_host_id: string | null
  room_challenger_id: string | null
  room_closed_at: Date | string | null
  room_updated_at: Date | string | null
  room_host_last_seen_at: Date | string | null
  room_challenger_last_seen_at: Date | string | null
  room_match_id: string | null
  room_match_status: string | null
}

type RawPlayer = {
  id: string
  matchId: string
  userId: string
  isOnline: number | boolean
  lastSeenAt: Date | string | null
  disconnectedAt: Date | string | null
  reconnectDeadlineAt: Date | string | null
  updatedAt: Date | string
}

function asDate(value: Date | string | null) {
  if (value === null) return null
  return value instanceof Date ? value : new Date(value)
}

function asRequiredDate(value: Date | string) {
  const result = asDate(value)
  if (!result || !Number.isFinite(result.getTime())) throw new Error(`Invalid duel timestamp: ${String(value)}`)
  return result
}

function asBoolean(value: number | boolean) {
  return value === true || value === 1
}

function buildRecord(match: RawMatch, players: RawPlayer[]): DuelActiveMatchRecord {
  return {
    id: match.id,
    roomId: match.roomId,
    status: match.status,
    finishReason: match.finishReason,
    finishedAt: asDate(match.finishedAt),
    createdAt: asRequiredDate(match.createdAt),
    startedAt: asRequiredDate(match.startedAt),
    updatedAt: asRequiredDate(match.updatedAt),
    Room: match.room_id
      ? {
          id: match.room_id,
          status: match.room_status || '',
          hostId: match.room_host_id || '',
          challengerId: match.room_challenger_id,
          closedAt: asDate(match.room_closed_at),
          updatedAt: asRequiredDate(match.room_updated_at || match.updatedAt),
          hostLastSeenAt: asDate(match.room_host_last_seen_at),
          challengerLastSeenAt: asDate(match.room_challenger_last_seen_at),
          Match: match.room_match_id ? { id: match.room_match_id, status: match.room_match_status || '' } : null,
        }
      : null,
    GuessSongDuelPlayer: players.map((player) => ({
      userId: player.userId,
      isOnline: asBoolean(player.isOnline),
      lastSeenAt: asDate(player.lastSeenAt),
      disconnectedAt: asDate(player.disconnectedAt),
      reconnectDeadlineAt: asDate(player.reconnectDeadlineAt),
      updatedAt: asRequiredDate(player.updatedAt),
    })),
  }
}

function staleUsers(record: DuelActiveMatchRecord) {
  return [...new Set([
    ...(record.Room ? [record.Room.hostId, record.Room.challengerId || ''] : []),
    ...record.GuessSongDuelPlayer.map((player) => player.userId),
  ].filter(Boolean))]
}

async function readPlayingMatches() {
  const matches = await prisma.$queryRaw<RawMatch[]>(Prisma.sql`
    SELECT
      m.id,
      m.roomId,
      m.status,
      m.finishReason,
      m.createdAt,
      m.startedAt,
      m.updatedAt,
      m.finishedAt,
      r.id AS room_id,
      r.status AS room_status,
      r.hostId AS room_host_id,
      r.challengerId AS room_challenger_id,
      r.closedAt AS room_closed_at,
      r.updatedAt AS room_updated_at,
      r.hostLastSeenAt AS room_host_last_seen_at,
      r.challengerLastSeenAt AS room_challenger_last_seen_at,
      rm.id AS room_match_id,
      rm.status AS room_match_status
    FROM GuessSongDuelMatch m
    LEFT JOIN GuessSongDuelRoom r ON r.id = m.roomId
    LEFT JOIN GuessSongDuelMatch rm ON rm.roomId = r.id
    WHERE m.status = 'PLAYING'
    ORDER BY m.createdAt ASC, m.id ASC
  `)
  if (!matches.length) return []
  const players = await prisma.$queryRaw<RawPlayer[]>(Prisma.sql`
    SELECT id, matchId, userId, isOnline, lastSeenAt, disconnectedAt, reconnectDeadlineAt, updatedAt
    FROM GuessSongDuelPlayer
    WHERE matchId IN (${Prisma.join(matches.map((match) => match.id))})
    ORDER BY matchId ASC, updatedAt ASC, userId ASC
  `)
  const playersByMatch = new Map<string, RawPlayer[]>()
  for (const player of players) {
    const list = playersByMatch.get(player.matchId) || []
    list.push(player)
    playersByMatch.set(player.matchId, list)
  }
  return matches.map((match) => {
    const matchPlayers = playersByMatch.get(match.id) || []
    return { raw: match, record: buildRecord(match, matchPlayers), players: matchPlayers }
  })
}

async function applyInvalidations(records: Array<{ record: DuelActiveMatchRecord; reason: DuelStaleReason }>, now: Date) {
  let invalidatedMatches = 0
  let closedRooms = 0
  await prisma.$transaction(async (tx) => {
    for (const item of records) {
      const match = await tx.guessSongDuelMatch.updateMany({
        where: { id: item.record.id, status: 'PLAYING' },
        data: { status: 'INVALID', finishReason: 'DISCONNECT_INVALID', finishedAt: now },
      })
      invalidatedMatches += match.count
      if (match.count === 1 && item.record.Room) {
        const room = await tx.guessSongDuelRoom.updateMany({
          where: { id: item.record.Room.id, status: { in: ['WAITING', 'READY', 'PLAYING', 'FINISHED'] } },
          data: { status: 'CLOSED', closedAt: now },
        })
        closedRooms += room.count
      }
    }
  })
  console.log(JSON.stringify({ invalidatedMatches, closedRooms }))
}

async function main() {
  const args = new Set(process.argv.slice(2))
  if ([...args].some((arg) => !['--dry-run', '--apply'].includes(arg))) {
    throw new Error('Usage: tsx scripts/audit-guess-song-duel-state.ts [--dry-run|--apply]')
  }
  if (args.has('--dry-run') && args.has('--apply')) throw new Error('Choose only one of --dry-run or --apply')
  const apply = args.has('--apply')
  const now = new Date()
  const records = await readPlayingMatches()
  const stale: Array<{ record: DuelActiveMatchRecord; reason: DuelStaleReason }> = []
  const details: Array<{
    matchId: string
    roomId: string | null
    userIds: string[]
    playerIds: string[]
    playerStates: Array<{
      id: string
      userId: string
      isOnline: boolean
      lastSeenAt: string | null
      disconnectedAt: string | null
      reconnectDeadlineAt: string | null
      updatedAt: string
    }>
    roomMembers: string[]
    matchStatus: string
    finishReason: string | null
    roomStatus: string | null
    roomHostId: string | null
    roomChallengerId: string | null
    roomMatchId: string | null
    roomMatchStatus: string | null
    createdAt: string
    startedAt: string
    updatedAt: string
    roomUpdatedAt: string | null
    finishedAt: string | null
    roomClosedAt: string | null
    reason: DuelStaleReason
  }> = []

  for (const item of records) {
    const record = item.record
    const users = staleUsers(record)
    const candidateUsers = users.length ? users : ['<orphan-player>']
    const failed = candidateUsers.map((userId) => classifyDuelActiveMatch(record, userId, now)).find((check) => !check.active)
    if (!failed || !failed.reason) continue
    stale.push({ record, reason: failed.reason })
    details.push({
      matchId: record.id,
      roomId: record.Room?.id || record.roomId || null,
      userIds: users,
      playerIds: item.players.map((player) => player.id),
      playerStates: item.players.map((player) => ({
        id: player.id,
        userId: player.userId,
        isOnline: asBoolean(player.isOnline),
        lastSeenAt: asDate(player.lastSeenAt)?.toISOString() || null,
        disconnectedAt: asDate(player.disconnectedAt)?.toISOString() || null,
        reconnectDeadlineAt: asDate(player.reconnectDeadlineAt)?.toISOString() || null,
        updatedAt: asRequiredDate(player.updatedAt).toISOString(),
      })),
      roomMembers: record.Room ? [record.Room.hostId, record.Room.challengerId].filter((value): value is string => Boolean(value)) : [],
      matchStatus: record.status,
      finishReason: record.finishReason || null,
      roomStatus: record.Room?.status || null,
      roomHostId: record.Room?.hostId || null,
      roomChallengerId: record.Room?.challengerId || null,
      roomMatchId: record.Room?.Match?.id || null,
      roomMatchStatus: record.Room?.Match?.status || null,
      createdAt: record.createdAt.toISOString(),
      startedAt: record.startedAt.toISOString(),
      updatedAt: record.updatedAt.toISOString(),
      roomUpdatedAt: record.Room?.updatedAt?.toISOString() || null,
      finishedAt: item.raw.finishedAt ? asRequiredDate(item.raw.finishedAt).toISOString() : null,
      roomClosedAt: record.Room?.closedAt?.toISOString() || null,
      reason: failed.reason,
    })
  }

  const staleRooms = new Set(stale.flatMap(({ record }) => record.Room ? [record.Room.id] : []))
  const affectedUsers = new Set(stale.flatMap(({ record }) => staleUsers(record)))
  console.log(JSON.stringify({
    mode: apply ? 'APPLY' : 'DRY_RUN',
    scannedMatches: records.length,
    staleMatches: stale.length,
    staleRooms: staleRooms.size,
    affectedUsers: affectedUsers.size,
    now: now.toISOString(),
  }, null, 2))
  for (const detail of details) console.log(JSON.stringify(detail))
  if (apply && stale.length) await applyInvalidations(stale, now)
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
}).finally(() => {
  void prisma.$disconnect()
})
