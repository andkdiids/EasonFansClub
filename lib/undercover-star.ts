import { randomInt, randomUUID } from 'node:crypto'
import {
  Prisma,
  type UndercoverDifficulty,
  type UndercoverMatchStatus,
  type UndercoverVoteStage,
  type UndercoverWinnerSide,
  type UndercoverWordCategory,
} from '@prisma/client'
import { getPublicUserDisplayName } from '@/lib/friend-remarks'
import { profileImageUrl } from '@/lib/images'
import { hashPassword, verifyPassword } from '@/lib/password'
import { prisma } from '@/lib/prisma'
import { consumeRateLimit, sanitizeText } from '@/lib/security'
import { syncUserAchievements } from '@/lib/achievements'
import { containsBannedWord, shouldBypassForbiddenWords } from '@/lib/content-moderation'
import {
  UNDERCOVER_DESCRIPTION_MS,
  UNDERCOVER_GUESS_MS,
  UNDERCOVER_MAX_DESCRIPTION_LENGTH,
  UNDERCOVER_MAX_PLAYERS,
  UNDERCOVER_MAX_WORD_LENGTH,
  UNDERCOVER_MIN_PLAYERS,
  UNDERCOVER_ONLINE_WINDOW_MS,
  UNDERCOVER_ROLE_REVEAL_MS,
  UNDERCOVER_SETTING_KEYS,
  UNDERCOVER_VOTING_MS,
  UNDERCOVER_WAITING_TTL_MS,
  undercoverCategoryLabels,
  undercoverDifficultyLabels,
  isUndercoverCategory,
  isUndercoverDifficulty,
  computeUndercoverXp,
  levelFromXp,
} from '@/lib/undercover-star-config'
import {
  isDirectUndercoverWordMention,
  normalizeUndercoverWord,
} from '@/lib/undercover-star-title'
import type {
  UndercoverActiveState,
  UndercoverDescriptionByRound,
  UndercoverDescriptionPublic,
  UndercoverFinalPlayer,
  UndercoverFinalResult,
  UndercoverMatchPlayerPublic,
  UndercoverPrivateState,
  UndercoverPublicMatchSnapshot,
  UndercoverPresence,
  UndercoverRoomPlayerPublic,
  UndercoverRoomMessagePublic,
  UndercoverRoomState,
  UndercoverRoundResult,
} from '@/lib/undercover-star-protocol'

type Database = typeof prisma | Prisma.TransactionClient

type PublicUserRow = Prisma.UserGetPayload<{ select: typeof publicUserSelect }>

const publicUserSelect = {
  id: true,
  uid: true,
  username: true,
  nickname: true,
  usernameModerationStatus: true,
  nicknameModerationStatus: true,
  avatarUrl: true,
  Profile: {
    select: {
      displayName: true,
      displayNameModerationStatus: true,
      avatarUrl: true,
    },
  },
  UndercoverStats: {
    select: { level: true },
  },
} as const

const roomInclude = {
  Host: { select: publicUserSelect },
  UndercoverRoomPlayer: {
    where: { leftAt: null },
    orderBy: { joinedAt: 'asc' as const },
    include: { User: { select: publicUserSelect } },
  },
} as const

const matchInclude = {
  Room: { select: { id: true, roomCode: true, hostId: true, status: true } },
  UndercoverMatchPlayer: {
    orderBy: { createdAt: 'asc' as const },
    include: { User: { select: publicUserSelect } },
  },
  UndercoverDescription: {
    orderBy: [{ round: 'asc' as const }, { createdAt: 'asc' as const }],
  },
  UndercoverVote: {
    orderBy: { createdAt: 'asc' as const },
  },
}

type RoomRow = Prisma.UndercoverRoomGetPayload<{ include: typeof roomInclude }>
export type MatchRow = Prisma.UndercoverMatchGetPayload<{ include: typeof matchInclude }>

type StoredDescription = {
  playerId: string
  content: string
  isAuto: boolean
}

type StoredRoundResult = {
  round: number
  kind: UndercoverRoundResult['kind']
  eliminatedPlayerId: string | null
  voteCounts: Array<{ playerId: string; count: number }>
  tieCandidates: string[]
  descriptions: StoredDescription[]
}

type FinishResult = {
  changed: boolean
  userIds: string[]
}

export class UndercoverStarServiceError extends Error {
  constructor(
    message: string,
    public readonly status = 400,
    public readonly code = 'UNDERCOVER_ERROR',
  ) {
    super(message)
    this.name = 'UndercoverStarServiceError'
  }
}

function errorCode(error: unknown) {
  if (error && typeof error === 'object' && 'code' in error && typeof error.code === 'string') return error.code
  return ''
}

function isTransactionConflict(error: unknown) {
  return errorCode(error) === 'P2034' || errorCode(error) === 'P2028'
}

export const UNDERCOVER_TRANSACTION_MAX_ATTEMPTS = 3

async function sleep(delayMs: number) {
  await new Promise<void>((resolve) => setTimeout(resolve, delayMs))
}

async function undercoverTransaction<T>(operation: (tx: Prisma.TransactionClient) => Promise<T>) {
  let lastError: unknown
  for (let attempt = 0; attempt < UNDERCOVER_TRANSACTION_MAX_ATTEMPTS; attempt += 1) {
    try {
      return await prisma.$transaction(operation, { isolationLevel: 'Serializable', maxWait: 5000, timeout: 15000 })
    } catch (error) {
      lastError = error
      if (!isTransactionConflict(error) || attempt === UNDERCOVER_TRANSACTION_MAX_ATTEMPTS - 1) throw error
      await sleep(25 * (attempt + 1))
    }
  }
  throw lastError || new Error('Undercover transaction failed')
}

function nowOnline(lastSeenAt: Date | null | undefined, now = new Date()) {
  return Boolean(lastSeenAt && now.getTime() - lastSeenAt.getTime() <= UNDERCOVER_ONLINE_WINDOW_MS)
}

function publicUser(user: PublicUserRow): UndercoverRoomPlayerPublic {
  return {
    userId: user.id,
    uid: user.uid,
    name: getPublicUserDisplayName(user),
    avatarUrl: profileImageUrl(user.Profile?.avatarUrl || user.avatarUrl),
    level: user.UndercoverStats?.level || 1,
    playerId: '',
    isHost: false,
    isReady: false,
    isOnline: false,
  }
}

function roomState(room: RoomRow, viewerId?: string, now = new Date()): UndercoverRoomState {
  const players: UndercoverRoomPlayerPublic[] = room.UndercoverRoomPlayer.map((player) => ({
    ...publicUser(player.User),
    playerId: player.id,
    isHost: player.User.id === room.hostId,
    isReady: player.isReady,
    isOnline: nowOnline(player.lastSeenAt, now),
  }))

  return {
    roomId: room.id,
    roomCode: room.roomCode,
    viewerUserId: viewerId || null,
    status: room.status,
    isPublic: room.isPublic,
    hasPassword: Boolean(room.passwordHash),
    hostId: room.hostId,
    difficulty: room.difficulty,
    currentCount: players.length,
    maxPlayers: UNDERCOVER_MAX_PLAYERS,
    players: viewerId ? players.map((player) => ({ ...player, isOnline: player.isOnline || player.userId === viewerId })) : players,
    matchId: room.currentMatchId || null,
    lastActivityAt: room.lastActivityAt.toISOString(),
  }
}

function inputJson(value: unknown) {
  return value as Prisma.InputJsonValue
}

function readStringArray(value: Prisma.JsonValue | null | undefined) {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is string => typeof item === 'string')
}

function readHistory(value: Prisma.JsonValue | null | undefined): StoredRoundResult[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return []
    const row = item as Record<string, unknown>
    const descriptions = Array.isArray(row.descriptions)
      ? row.descriptions.flatMap((description) => {
          if (!description || typeof description !== 'object' || Array.isArray(description)) return []
          const item = description as Record<string, unknown>
          if (typeof item.playerId !== 'string' || typeof item.content !== 'string') return []
          return [{ playerId: item.playerId, content: item.content, isAuto: item.isAuto === true }]
        })
      : []
    const voteCounts = Array.isArray(row.voteCounts)
      ? row.voteCounts.flatMap((vote) => {
          if (!vote || typeof vote !== 'object' || Array.isArray(vote)) return []
          const item = vote as Record<string, unknown>
          if (typeof item.playerId !== 'string' || typeof item.count !== 'number') return []
          return [{ playerId: item.playerId, count: Math.max(0, Math.trunc(item.count)) }]
        })
      : []
    if (typeof row.round !== 'number' || typeof row.kind !== 'string') return []
    return [{
      round: Math.max(1, Math.trunc(row.round)),
      kind: row.kind as StoredRoundResult['kind'],
      eliminatedPlayerId: typeof row.eliminatedPlayerId === 'string' ? row.eliminatedPlayerId : null,
      voteCounts,
      tieCandidates: Array.isArray(row.tieCandidates) ? row.tieCandidates.filter((candidate): candidate is string => typeof candidate === 'string') : [],
      descriptions,
    }]
  })
}

function appendHistory(value: Prisma.JsonValue | null | undefined, entry: StoredRoundResult) {
  return [...readHistory(value), entry]
}

function roomCutoff(now: Date) {
  return new Date(now.getTime() - UNDERCOVER_WAITING_TTL_MS)
}

function validateRoomPassword(value: unknown) {
  const password = sanitizeText(value, 32)
  if (!password) return null
  if (password.length < 4) throw new UndercoverStarServiceError('房间密码至少需要4位。', 400, 'PASSWORD_TOO_SHORT')
  return password
}

function normalizeRoomCode(value: unknown) {
  return String(value ?? '').normalize('NFKC').replace(/\s+/gu, '').trim()
}

function validateRoomCode(value: unknown) {
  const code = normalizeRoomCode(value)
  if (!/^\d{6}$/u.test(code)) throw new UndercoverStarServiceError('房间号应为6位数字。', 400, 'ROOM_CODE_INVALID')
  return code
}

function randomRoomCode() {
  return String(randomInt(100000, 1_000_000))
}

function lockUser(tx: Prisma.TransactionClient, userId: string) {
  return tx.$queryRaw`SELECT id FROM User WHERE id = ${userId} FOR UPDATE`
}

function lockRoom(tx: Prisma.TransactionClient, roomId: string) {
  return tx.$queryRaw`SELECT id FROM UndercoverRoom WHERE id = ${roomId} FOR UPDATE`
}

function lockMatch(tx: Prisma.TransactionClient, matchId: string) {
  return tx.$queryRaw`SELECT id FROM UndercoverMatch WHERE id = ${matchId} FOR UPDATE`
}

async function loadRoom(database: Database, roomId: string) {
  const room = await database.undercoverRoom.findUnique({ where: { id: roomId }, include: roomInclude })
  if (!room) throw new UndercoverStarServiceError('房间不存在。', 404, 'ROOM_NOT_FOUND')
  return room
}

async function loadMatch(database: Database, matchId: string) {
  const match = await database.undercoverMatch.findUnique({ where: { id: matchId }, include: matchInclude })
  if (!match) throw new UndercoverStarServiceError('对局不存在。', 404, 'MATCH_NOT_FOUND')
  return match
}

async function loadActiveMemberships(tx: Prisma.TransactionClient, userId: string) {
  return tx.undercoverRoomPlayer.findMany({
    where: { userId, leftAt: null, Room: { status: { in: ['WAITING', 'PLAYING'] } } },
    select: { id: true, roomId: true, isReady: true, Room: { select: { id: true, status: true, hostId: true, currentMatchId: true } } },
    orderBy: { joinedAt: 'desc' },
  })
}

async function closeWaitingRoomTx(tx: Prisma.TransactionClient, roomId: string, now: Date) {
  await tx.undercoverRoomPlayer.updateMany({
    where: { roomId, leftAt: null },
    data: { leftAt: now, isReady: false, updatedAt: now },
  })
  await tx.undercoverRoom.updateMany({
    where: { id: roomId, status: 'WAITING' },
    data: { status: 'CANCELLED', closedAt: now, lastActivityAt: now },
  })
}

async function cleanupWaitingMembershipsTx(tx: Prisma.TransactionClient, userId: string, now: Date, keepRoomId?: string) {
  const memberships = await loadActiveMemberships(tx, userId)
  if (!memberships.length) return []

  // 收集处于 PLAYING 的房间所指向的 currentMatchId，批量查询其真实状态，
  // 以区分「真正进行中的对局」与「状态卡住的陈旧 PLAYING 房间」。
  const currentMatchIds = memberships
    .filter((membership) => membership.Room.status === 'PLAYING' && membership.Room.currentMatchId)
    .map((membership) => membership.Room.currentMatchId as string)
  const matchStatusById = new Map<string, UndercoverMatchStatus>()
  if (currentMatchIds.length) {
    const matches = await tx.undercoverMatch.findMany({
      where: { id: { in: currentMatchIds } },
      select: { id: true, status: true },
    })
    for (const match of matches) matchStatusById.set(match.id, match.status)
  }

  const affectedRoomIds: string[] = []

  for (const membership of memberships) {
    if (keepRoomId && membership.roomId === keepRoomId) continue
    if (membership.Room.status === 'PLAYING') {
      const currentMatchId = membership.Room.currentMatchId
      const currentMatchStatus = currentMatchId ? matchStatusById.get(currentMatchId) : undefined
      if (currentMatchStatus === 'PLAYING') {
        // 真正进行中的对局：阻止加入第二个房间。
        throw new UndercoverStarServiceError('你正在进行一局卧底巨星，请先返回当前对局。', 409, 'MATCH_ACTIVE')
      }
      // 陈旧 PLAYING 房间（currentMatch 不存在或已结束）：安全收敛为 WAITING，
      // 避免永久卡住用户。
      await tx.undercoverRoom.updateMany({
        where: { id: membership.roomId, status: 'PLAYING' },
        data: { status: 'WAITING', currentMatchId: null, lastActivityAt: now, updatedAt: now },
      })
    }
    // 此时房间在语义上等同于 WAITING：正常离开或关闭。
    if (membership.Room.hostId === userId) {
      await closeWaitingRoomTx(tx, membership.roomId, now)
    } else {
      await tx.undercoverRoomPlayer.update({
        where: { id: membership.id },
        data: { leftAt: now, isReady: false, updatedAt: now },
      })
      const remaining = await tx.undercoverRoomPlayer.count({ where: { roomId: membership.roomId, leftAt: null } })
      if (remaining === 0) await closeWaitingRoomTx(tx, membership.roomId, now)
      else await tx.undercoverRoom.update({ where: { id: membership.roomId }, data: { lastActivityAt: now } })
    }
    affectedRoomIds.push(membership.roomId)
  }

  return affectedRoomIds
}

async function expireWaitingRooms(now = new Date()) {
  const cutoff = roomCutoff(now)
  const expired = await prisma.undercoverRoom.findMany({
    where: { status: 'WAITING', lastActivityAt: { lt: cutoff } },
    select: { id: true },
    take: 100,
  })
  for (const room of expired) {
    await undercoverTransaction(async (tx) => {
      await lockRoom(tx, room.id)
      const current = await tx.undercoverRoom.findUnique({ where: { id: room.id }, select: { status: true, lastActivityAt: true } })
      if (current?.status === 'WAITING' && current.lastActivityAt < cutoff) await closeWaitingRoomTx(tx, room.id, now)
    })
  }
}

export type UndercoverConfig = { enabled: boolean }

export async function getUndercoverConfig(database: Pick<Prisma.TransactionClient, 'siteSetting'> | typeof prisma = prisma): Promise<UndercoverConfig> {
  const setting = await database.siteSetting.findUnique({ where: { key: UNDERCOVER_SETTING_KEYS.enabled }, select: { value: true } })
  return { enabled: setting?.value !== 'false' }
}

export async function saveUndercoverConfig(config: UndercoverConfig, database: Pick<Prisma.TransactionClient, 'siteSetting'> | typeof prisma = prisma) {
  await database.siteSetting.upsert({
    where: { key: UNDERCOVER_SETTING_KEYS.enabled },
    update: { value: config.enabled ? 'true' : 'false', valueType: 'BOOLEAN', group: 'entertainment', label: '卧底巨星启用' },
    create: { key: UNDERCOVER_SETTING_KEYS.enabled, value: config.enabled ? 'true' : 'false', valueType: 'BOOLEAN', group: 'entertainment', label: '卧底巨星启用' },
  })
}

export async function listUndercoverRooms() {
  await expireWaitingRooms()
  const rooms = await prisma.undercoverRoom.findMany({
    where: { status: 'WAITING', isPublic: true, passwordHash: null, currentMatchId: null, Host: { status: 'ACTIVE', isDeleted: false } },
    include: roomInclude,
    orderBy: [{ lastActivityAt: 'desc' }, { createdAt: 'desc' }],
    take: 80,
  })
  return rooms.filter((room) => room.UndercoverRoomPlayer.length < UNDERCOVER_MAX_PLAYERS).map((room) => roomState(room))
}

export async function getUndercoverRoomByCode(value: unknown) {
  await expireWaitingRooms()
  const roomCode = validateRoomCode(value)
  const room = await prisma.undercoverRoom.findUnique({ where: { roomCode }, include: roomInclude })
  if (!room || room.status !== 'WAITING' || room.currentMatchId || room.UndercoverRoomPlayer.length >= UNDERCOVER_MAX_PLAYERS) {
    throw new UndercoverStarServiceError('房间不存在、已开始或已满。', 404, 'ROOM_NOT_JOINABLE')
  }
  return roomState(room)
}

export async function getUndercoverRoomIdByCode(value: unknown) {
  const roomCode = validateRoomCode(value)
  const room = await prisma.undercoverRoom.findUnique({ where: { roomCode }, select: { id: true } })
  if (!room) throw new UndercoverStarServiceError('房间不存在。', 404, 'ROOM_NOT_FOUND')
  return room.id
}

export async function resolveActiveUndercoverState(userId: string): Promise<UndercoverActiveState> {
  await expireWaitingRooms()
  const memberships = await prisma.undercoverRoomPlayer.findMany({
    where: { userId, leftAt: null, Room: { status: { in: ['WAITING', 'PLAYING'] } } },
    select: { roomId: true, Room: { include: roomInclude } },
    orderBy: { joinedAt: 'desc' },
  })
  const membership = memberships[0]
  if (membership) {
    const room = membership.Room
    if (room.status === 'PLAYING') {
      const currentMatchId = room.currentMatchId
      const currentMatch = currentMatchId
        ? await prisma.undercoverMatch.findUnique({ where: { id: currentMatchId }, select: { id: true, status: true, roomId: true } })
        : null
      if (currentMatch && currentMatch.status === 'PLAYING') {
        return {
          activeRoom: roomState(room, userId),
          activeMatch: { matchId: currentMatch.id, roomId: room.id, status: 'PLAYING' },
          isInActiveGame: true,
        }
      }
      // 陈旧 PLAYING 房间（currentMatch 不存在或已结束）：安全收敛为 WAITING。
      await prisma.undercoverRoom.updateMany({
        where: { id: room.id, status: 'PLAYING' },
        data: { status: 'WAITING', currentMatchId: null, lastActivityAt: new Date(), updatedAt: new Date() },
      })
      const recovered = { ...room, status: 'WAITING' as const, currentMatchId: null }
      return {
        activeRoom: roomState(recovered, userId),
        activeMatch: null,
        isInActiveGame: false,
      }
    }
    // WAITING 房间：不在进行中的对局，不会触发 active-game 提示。
    return {
      activeRoom: roomState(room, userId),
      activeMatch: null,
      isInActiveGame: false,
    }
  }

  // Finished matches remain readable to their original players so a refresh on
  // the result page can restore the settlement without reopening the game.
  const finishedMatch = await prisma.undercoverMatch.findFirst({
    where: { status: 'FINISHED', UndercoverMatchPlayer: { some: { userId } } },
    orderBy: [{ finishedAt: 'desc' }, { updatedAt: 'desc' }],
    select: { id: true, roomId: true, status: true },
  })
  return {
    activeRoom: null,
    activeMatch: finishedMatch ? { matchId: finishedMatch.id, roomId: finishedMatch.roomId, status: finishedMatch.status } : null,
    isInActiveGame: false,
  }
}

export async function createUndercoverRoom(userId: string, input: { password?: unknown; difficulty?: unknown }, now = new Date()) {
  const config = await getUndercoverConfig()
  if (!config.enabled) throw new UndercoverStarServiceError('卧底巨星目前暂时关闭，请稍后再试。', 409, 'GAME_DISABLED')
  const password = validateRoomPassword(input.password)
  const passwordHash = password ? await hashPassword(password) : null
  const difficulty = isUndercoverDifficulty(input.difficulty) ? input.difficulty : 'NORMAL'

  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      const result = await undercoverTransaction(async (tx) => {
        await lockUser(tx, userId)
        const affectedRoomIds = await cleanupWaitingMembershipsTx(tx, userId, now)
        const room = await tx.undercoverRoom.create({
          data: {
            id: randomUUID(),
            roomCode: randomRoomCode(),
            passwordHash,
            isPublic: !passwordHash,
            status: 'WAITING',
            difficulty,
            hostId: userId,
            lastActivityAt: now,
            updatedAt: now,
            UndercoverRoomPlayer: { create: { id: randomUUID(), userId, isReady: false, lastSeenAt: now, updatedAt: now } },
          },
          select: { id: true },
        })
        return { roomId: room.id, affectedRoomIds }
      })
      const [room, ...affectedRooms] = await Promise.all([
        loadRoom(prisma, result.roomId),
        ...result.affectedRoomIds.map((roomId) => loadRoom(prisma, roomId).catch(() => null)),
      ])
      return { room: roomState(room, userId, now), affectedRooms: affectedRooms.filter((item): item is RoomRow => Boolean(item)).map((item) => roomState(item, undefined, now)) }
    } catch (error) {
      if (errorCode(error) === 'P2002' && attempt < 4) continue
      throw error
    }
  }
  throw new UndercoverStarServiceError('房间暂时创建失败，请稍后重试。', 409, 'ROOM_CREATE_FAILED')
}

export async function joinUndercoverRoom(userId: string, roomId: string, input: { password?: unknown }, now = new Date()) {
  const config = await getUndercoverConfig()
  if (!config.enabled) throw new UndercoverStarServiceError('卧底巨星目前暂时关闭，请稍后再试。', 409, 'GAME_DISABLED')

  const result = await undercoverTransaction(async (tx) => {
    await lockUser(tx, userId)
    await lockRoom(tx, roomId)
    const room = await tx.undercoverRoom.findUnique({ where: { id: roomId }, include: roomInclude })
    if (!room) throw new UndercoverStarServiceError('房间不存在。', 404, 'ROOM_NOT_FOUND')
    if (room.status === 'PLAYING') throw new UndercoverStarServiceError('房间已经开始，不能加入。', 409, 'ROOM_STARTED')
    if (room.status === 'FINISHED' || room.status === 'CANCELLED') throw new UndercoverStarServiceError('房间已经结束。', 409, 'ROOM_FINISHED')
    if (room.lastActivityAt < roomCutoff(now)) {
      await closeWaitingRoomTx(tx, roomId, now)
      throw new UndercoverStarServiceError('房间已失效，请重新创建。', 410, 'ROOM_EXPIRED')
    }
    if (room.passwordHash) {
      const password = typeof input.password === 'string' ? input.password : ''
      const verification = await verifyPassword(password, room.passwordHash)
      if (!verification.valid) throw new UndercoverStarServiceError('房间密码错误。', 403, 'PASSWORD_WRONG')
    }
    const affectedRoomIds = await cleanupWaitingMembershipsTx(tx, userId, now, roomId)
    const currentPlayer = room.UndercoverRoomPlayer.find((player) => player.User.id === userId)
    const historicalPlayer = await tx.undercoverRoomPlayer.findUnique({ where: { roomId_userId: { roomId, userId } }, select: { id: true, isReady: true, leftAt: true } })
    if (room.UndercoverRoomPlayer.length >= UNDERCOVER_MAX_PLAYERS && !currentPlayer) throw new UndercoverStarServiceError('房间已满。', 409, 'ROOM_FULL')
    if (historicalPlayer) {
      await tx.undercoverRoomPlayer.update({ where: { id: historicalPlayer.id }, data: { leftAt: null, isReady: historicalPlayer.leftAt ? false : historicalPlayer.isReady, lastSeenAt: now, updatedAt: now } })
    } else {
      await tx.undercoverRoomPlayer.create({ data: { id: randomUUID(), roomId, userId, lastSeenAt: now, updatedAt: now } })
    }
    await tx.undercoverRoom.update({ where: { id: roomId }, data: { lastActivityAt: now, updatedAt: now } })
    return { roomId, affectedRoomIds }
  })

  const [room, ...affectedRooms] = await Promise.all([
    loadRoom(prisma, result.roomId),
    ...result.affectedRoomIds.map((affectedRoomId) => loadRoom(prisma, affectedRoomId).catch(() => null)),
  ])
  return { room: roomState(room, userId, now), affectedRooms: affectedRooms.filter((item): item is RoomRow => Boolean(item)).map((item) => roomState(item, undefined, now)) }
}

export async function getUndercoverRoomState(userId: string, roomId: string, now = new Date()) {
  let room: Awaited<ReturnType<typeof loadRoom>>
  try {
    room = await loadRoom(prisma, roomId)
  } catch (error) {
    // 房间不存在 → 对用户统一提示「已失效」，引导重新创建。
    if (errorCode(error) === 'ROOM_NOT_FOUND') throw new UndercoverStarServiceError('房间已失效，请重新创建。', 410, 'ROOM_EXPIRED')
    throw error
  }
  const wasMember = room.UndercoverRoomPlayer.some((player) => player.User.id === userId)
  if (room.status === 'WAITING' && room.lastActivityAt < roomCutoff(now)) {
    await undercoverTransaction(async (tx) => {
      await lockRoom(tx, roomId)
      await closeWaitingRoomTx(tx, roomId, now)
    })
  }
  const current = await loadRoom(prisma, roomId)
  const member = current.UndercoverRoomPlayer.some((player) => player.User.id === userId)
  // 非成员访问：房间已关闭 / 过期 / 不存在，均提示「已失效，请重新创建」，避免泄露房间存在性。
  if (!member && !(wasMember && current.status === 'CANCELLED')) throw new UndercoverStarServiceError('房间已失效，请重新创建。', 410, 'ROOM_EXPIRED')
  return roomState(current, userId, now)
}

export async function getUndercoverRoomPublicState(roomId: string, now = new Date()) {
  const room = await loadRoom(prisma, roomId)
  return roomState(room, undefined, now)
}

export async function enterUndercoverRoom(userId: string, roomId: string, now = new Date()) {
  const state = await getUndercoverRoomState(userId, roomId, now)
  await touchUndercoverPresence(userId, roomId, state.matchId || undefined, now)
  return state
}

export async function setUndercoverReady(userId: string, roomId: string, ready: boolean, now = new Date()) {
  const result = await undercoverTransaction(async (tx) => {
    await lockUser(tx, userId)
    await lockRoom(tx, roomId)
    const room = await tx.undercoverRoom.findUnique({ where: { id: roomId }, include: roomInclude })
    if (!room) throw new UndercoverStarServiceError('房间不存在。', 404, 'ROOM_NOT_FOUND')
    if (room.status !== 'WAITING') throw new UndercoverStarServiceError('对局已经开始，不能修改准备状态。', 409, 'ROOM_NOT_WAITING')
    const player = room.UndercoverRoomPlayer.find((item) => item.User.id === userId)
    if (!player) throw new UndercoverStarServiceError('你不在这个房间中。', 403, 'ROOM_NOT_MEMBER')
    await tx.undercoverRoomPlayer.update({ where: { id: player.id }, data: { isReady: ready, lastSeenAt: now, updatedAt: now } })
    await tx.undercoverRoom.update({ where: { id: roomId }, data: { lastActivityAt: now, updatedAt: now } })
    return true
  })
  return result
}

export async function leaveUndercoverRoom(userId: string, roomId: string, now = new Date()) {
  const result = await undercoverTransaction(async (tx) => {
    await lockUser(tx, userId)
    await lockRoom(tx, roomId)
    const room = await tx.undercoverRoom.findUnique({ where: { id: roomId }, include: roomInclude })
    if (!room) throw new UndercoverStarServiceError('房间不存在。', 404, 'ROOM_NOT_FOUND')
    if (room.status === 'PLAYING') {
      const currentMatchId = room.currentMatchId
      const currentMatch = currentMatchId
        ? await tx.undercoverMatch.findUnique({ where: { id: currentMatchId }, select: { id: true, status: true } })
        : null
      if (currentMatch && currentMatch.status === 'PLAYING') {
        throw new UndercoverStarServiceError('对局进行中，请关闭页面后通过重连继续。', 409, 'MATCH_IN_PROGRESS')
      }
      // 陈旧 PLAYING 房间（currentMatch 不存在或已结束）：收敛为 WAITING 后再离开。
      await tx.undercoverRoom.updateMany({
        where: { id: roomId, status: 'PLAYING' },
        data: { status: 'WAITING', currentMatchId: null, lastActivityAt: now, updatedAt: now },
      })
    }
    const player = room.UndercoverRoomPlayer.find((item) => item.User.id === userId)
    if (!player) return { affectedRoomIds: [] as string[] }
    if (room.hostId === userId) await closeWaitingRoomTx(tx, roomId, now)
    else {
      await tx.undercoverRoomPlayer.update({ where: { id: player.id }, data: { leftAt: now, isReady: false, updatedAt: now } })
      const remaining = await tx.undercoverRoomPlayer.count({ where: { roomId, leftAt: null } })
      if (!remaining) await closeWaitingRoomTx(tx, roomId, now)
      else await tx.undercoverRoom.update({ where: { id: roomId }, data: { lastActivityAt: now, updatedAt: now } })
    }
    return { affectedRoomIds: [roomId] }
  })
  const rooms = await Promise.all(result.affectedRoomIds.map((id) => loadRoom(prisma, id).catch(() => null)))
  return { affectedRooms: rooms.filter((room): room is RoomRow => Boolean(room)).map((room) => roomState(room, undefined, now)) }
}

export async function kickUndercoverPlayer(hostId: string, roomId: string, targetUserId: string, now = new Date()) {
  const result = await undercoverTransaction(async (tx) => {
    await lockRoom(tx, roomId)
    await lockUser(tx, targetUserId)
    const room = await tx.undercoverRoom.findUnique({ where: { id: roomId }, include: roomInclude })
    if (!room) throw new UndercoverStarServiceError('房间不存在。', 404, 'ROOM_NOT_FOUND')
    // 真正进行中的对局禁止踢人：即便前端因旧状态误显示按钮，API 也必须明确拒绝。
    if (room.status !== 'WAITING') {
      const currentMatchId = room.currentMatchId
      const currentMatch = currentMatchId
        ? await tx.undercoverMatch.findUnique({ where: { id: currentMatchId }, select: { id: true, status: true } })
        : null
      if (currentMatch && currentMatch.status === 'PLAYING') {
        throw new UndercoverStarServiceError('对局进行中，不能踢出玩家。', 409, 'MATCH_IN_PROGRESS')
      }
      throw new UndercoverStarServiceError('房间不在等待状态，无法踢出玩家。', 409, 'ROOM_NOT_WAITING')
    }
    if (room.currentMatchId) throw new UndercoverStarServiceError('对局进行中，不能踢出玩家。', 409, 'MATCH_IN_PROGRESS')
    if (room.hostId !== hostId) throw new UndercoverStarServiceError('只有房主可以踢出玩家。', 403, 'NOT_HOST')
    if (targetUserId === hostId) throw new UndercoverStarServiceError('房主不能踢出自己，需要离开请使用退出房间。', 409, 'CANNOT_KICK_HOST')
    const target = room.UndercoverRoomPlayer.find((item) => item.User.id === targetUserId && !item.leftAt)
    if (!target) {
      // 幂等：目标早已离开或不是当前成员，直接视为成功，避免并发二次踢产生异常状态。
      return { affectedRoomId: null as string | null, kicked: false }
    }
    await tx.undercoverRoomPlayer.update({ where: { id: target.id }, data: { leftAt: now, isReady: false, updatedAt: now } })
    const remaining = await tx.undercoverRoomPlayer.count({ where: { roomId, leftAt: null } })
    if (!remaining) await closeWaitingRoomTx(tx, roomId, now)
    else await tx.undercoverRoom.update({ where: { id: roomId }, data: { lastActivityAt: now, updatedAt: now } })
    return { affectedRoomId: roomId, kicked: true }
  })
  return result
}

function assertExpectedState(match: MatchRow, expectedRevision?: number, expectedRound?: number) {
  if (expectedRevision !== undefined && expectedRevision !== match.revision) {
    throw new UndercoverStarServiceError('对局状态已经更新，请刷新当前页面。', 409, 'STATE_STALE')
  }
  if (expectedRound !== undefined && expectedRound !== match.round) {
    throw new UndercoverStarServiceError('对局轮次已经更新，请刷新当前页面。', 409, 'ROUND_STALE')
  }
}

function matchPlayerForUser(match: MatchRow, userId: string) {
  const player = match.UndercoverMatchPlayer.find((item) => item.User.id === userId)
  if (!player) throw new UndercoverStarServiceError('你不属于这场对局。', 403, 'MATCH_NOT_MEMBER')
  return player
}

function activeMatchPlayers(match: MatchRow) {
  return match.UndercoverMatchPlayer.filter((player) => player.isAlive)
}

function playerById(match: MatchRow, playerId: string | null | undefined) {
  return playerId ? match.UndercoverMatchPlayer.find((player) => player.id === playerId) || null : null
}

function descriptionPublic(match: MatchRow, description: StoredDescription): UndercoverDescriptionPublic {
  const player = playerById(match, description.playerId)
  return {
    playerId: description.playerId,
    userId: player?.User.id || '',
    name: player ? getPublicUserDisplayName(player.User) : '玩家',
    round: match.round,
    content: description.content,
    isAuto: description.isAuto,
  }
}

function historyPublic(match: MatchRow, history: StoredRoundResult[]): UndercoverRoundResult[] {
  return history.map((entry) => ({
    round: entry.round,
    kind: entry.kind,
    eliminatedPlayerId: entry.eliminatedPlayerId,
    voteCounts: entry.voteCounts,
    tieCandidates: entry.tieCandidates,
    descriptions: entry.descriptions.map((description) => ({
      ...descriptionPublic(match, description),
      round: entry.round,
    })),
  }))
}

function finalResultFromJson(value: Prisma.JsonValue | null | undefined): UndercoverFinalResult | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  return value as unknown as UndercoverFinalResult
}

export function matchSnapshot(match: MatchRow, now = new Date()): UndercoverPublicMatchSnapshot {
  const players: UndercoverMatchPlayerPublic[] = match.UndercoverMatchPlayer.map((player) => ({
    userId: player.User.id,
    uid: player.User.uid,
    name: getPublicUserDisplayName(player.User),
    avatarUrl: profileImageUrl(player.User.Profile?.avatarUrl || player.User.avatarUrl),
    level: player.User.UndercoverStats?.level || 1,
    playerId: player.id,
    isHost: player.User.id === match.Room.hostId,
    isAlive: player.isAlive,
    roleConfirmed: Boolean(player.roleConfirmedAt),
    isOnline: nowOnline(player.lastSeenAt, now),
    eliminatedAt: player.eliminatedAt?.toISOString() || null,
    ...(match.status === 'FINISHED' ? { role: player.role, word: player.word } : {}),
  }))
  const descriptions: UndercoverDescriptionPublic[] = match.UndercoverDescription.map((description) => {
    const player = playerById(match, description.matchPlayerId)
    return {
      playerId: description.matchPlayerId,
      userId: player?.User.id || '',
      name: player ? getPublicUserDisplayName(player.User) : '玩家',
      round: description.round,
      content: description.content,
      isAuto: description.isAuto,
    }
  })
  const descriptionHistory = descriptionHistoryByRound(match)
  const stage: UndercoverVoteStage | null = match.phase === 'VOTING' ? 'MAIN' : match.phase === 'TIE_VOTING' ? 'TIE' : null
  const stageVotes = stage ? match.UndercoverVote.filter((vote) => vote.round === match.round && vote.stage === stage) : []
  const voteProgress = stage
    ? {
        submitted: stageVotes.length,
        total: activeMatchPlayers(match).length,
        stage,
        abstained: stageVotes.filter((vote) => vote.isAbstain).length,
      }
    : { submitted: 0, total: activeMatchPlayers(match).length, stage: null, abstained: 0 }
  const history = historyPublic(match, readHistory(match.roundHistory))
  return {
    matchId: match.id,
    roomId: match.roomId,
    status: match.status,
    phase: match.phase,
    round: match.round,
    revision: match.revision,
    serverNow: now.toISOString(),
    phaseDeadline: match.phaseDeadline?.toISOString() || null,
    currentSpeakerId: match.currentSpeakerId,
    players,
    descriptions,
    descriptionHistory,
    voteProgress,
    tieCandidates: readStringArray(match.tieCandidateIds),
    roundHistory: history,
    lastRoundResult: history.length ? history[history.length - 1] : null,
    finalResult: match.status === 'FINISHED' ? finalResultFromJson(match.finalResult) : null,
  }
}

export function privateState(match: MatchRow, userId: string): UndercoverPrivateState {
  const player = matchPlayerForUser(match, userId)
  const stage = match.phase === 'VOTING' ? 'MAIN' : match.phase === 'TIE_VOTING' ? 'TIE' : null
  const existingDescription = match.UndercoverDescription.find((item) => item.round === match.round && item.matchPlayerId === player.id)
  const existingVote = stage
    ? match.UndercoverVote.find((item) => item.round === match.round && item.stage === stage && item.voterId === player.id)
    : null
  return {
    matchId: match.id,
    playerId: player.id,
    // 安全红线：PLAYING（含 ROLE_REVEAL 任何阶段）绝不返回 role，仅在 FINISHED 揭晓。
    ...(match.status === 'FINISHED' ? { role: player.role } : {}),
    word: player.word,
    roleConfirmed: Boolean(player.roleConfirmedAt),
    isAlive: player.isAlive,
    phase: match.phase,
    round: match.round,
    revision: match.revision,
    descriptionSubmitted: Boolean(existingDescription),
    voteSubmitted: Boolean(existingVote),
    voteStage: stage,
    voteTargetId: existingVote?.targetId || null,
    guessSubmitted: Boolean(match.undercoverGuessAt),
    canDescribe: match.status === 'PLAYING' && match.phase === 'DESCRIBING' && player.isAlive && match.currentSpeakerId === player.id && !existingDescription,
    canVote: match.status === 'PLAYING' && (match.phase === 'VOTING' || match.phase === 'TIE_VOTING') && player.isAlive && !existingVote,
    canGuess: match.status === 'PLAYING' && match.phase === 'UNDERCOVER_GUESS' && player.role === 'UNDERCOVER' && !match.undercoverGuessAt,
    phaseDeadline: match.phaseDeadline?.toISOString() || null,
  }
}

async function loadMatchForUser(matchId: string, userId: string) {
  const match = await loadMatch(prisma, matchId)
  matchPlayerForUser(match, userId)
  return match
}

export async function getUndercoverMatchSnapshot(userId: string, matchId: string, now = new Date()) {
  await advanceExpiredUndercoverMatch(matchId, now)
  const match = await loadMatchForUser(matchId, userId)
  return matchSnapshot(match, now)
}

export async function getUndercoverPrivateState(userId: string, matchId: string, now = new Date()) {
  await advanceExpiredUndercoverMatch(matchId, now)
  const match = await loadMatchForUser(matchId, userId)
  return privateState(match, userId)
}

export async function getUndercoverMatchState(userId: string, matchId: string, now = new Date()) {
  await advanceExpiredUndercoverMatch(matchId, now)
  const match = await loadMatchForUser(matchId, userId)
  return { snapshot: matchSnapshot(match, now), privateState: privateState(match, userId) }
}

function randomItem<T>(items: T[]) {
  if (!items.length) return null
  return items[randomInt(items.length)] || null
}

function randomSpeakingOrder(match: MatchRow) {
  const order = activeMatchPlayers(match).map((player) => player.id)
  for (let index = order.length - 1; index > 0; index -= 1) {
    const other = randomInt(index + 1)
    const current = order[index]
    order[index] = order[other]
    order[other] = current
  }
  return order
}

function nextSpeakingOrder(match: MatchRow) {
  const alive = activeMatchPlayers(match)
  const oldOrder = readStringArray(match.speakingOrder)
  const ordered = oldOrder.map((id) => alive.find((player) => player.id === id)).filter((player): player is typeof alive[number] => Boolean(player))
  for (const player of alive) if (!ordered.some((item) => item.id === player.id)) ordered.push(player)
  if (!ordered.length) return []
  const anchorId = match.currentSpeakerId || oldOrder[0]
  const previousIndex = anchorId ? ordered.findIndex((player) => player.id === anchorId) : -1
  const start = previousIndex < 0 ? 0 : (previousIndex + 1) % ordered.length
  return [...ordered.slice(start), ...ordered.slice(0, start)].map((player) => player.id)
}

async function transitionToDescribingTx(tx: Prisma.TransactionClient, match: MatchRow, now: Date, order = nextSpeakingOrder(match)) {
  if (!order.length) throw new UndercoverStarServiceError('当前没有可继续游戏的玩家。', 409, 'NO_ALIVE_PLAYERS')
  await tx.undercoverMatch.update({
    where: { id: match.id },
    data: {
      phase: 'DESCRIBING',
      round: match.round || 1,
      revision: { increment: 1 },
      speakingOrder: inputJson(order),
      currentSpeakerId: order[0],
      currentSpeakerIndex: 0,
      tieCandidateIds: Prisma.JsonNull,
      phaseDeadline: new Date(now.getTime() + UNDERCOVER_DESCRIPTION_MS),
    },
  })
}

async function startNextRoundTx(tx: Prisma.TransactionClient, match: MatchRow, roundResult: StoredRoundResult, now: Date) {
  const history = appendHistory(match.roundHistory, roundResult)
  const nextOrder = nextSpeakingOrder(match)
  if (!nextOrder.length) throw new UndercoverStarServiceError('当前没有可继续游戏的玩家。', 409, 'NO_ALIVE_PLAYERS')
  await tx.undercoverMatch.update({
    where: { id: match.id },
    data: {
      phase: 'DESCRIBING',
      round: match.round + 1,
      revision: { increment: 1 },
      speakingOrder: inputJson(nextOrder),
      currentSpeakerId: nextOrder[0],
      currentSpeakerIndex: 0,
      tieCandidateIds: Prisma.JsonNull,
      roundHistory: inputJson(history),
      phaseDeadline: new Date(now.getTime() + UNDERCOVER_DESCRIPTION_MS),
    },
  })
}

async function setRoleRevealConfirmedTx(tx: Prisma.TransactionClient, match: MatchRow, now: Date) {
  await tx.undercoverMatchPlayer.updateMany({ where: { matchId: match.id, roleConfirmedAt: null }, data: { roleConfirmedAt: now } })
  const refreshed = await tx.undercoverMatch.findUnique({ where: { id: match.id }, include: matchInclude })
  if (!refreshed) throw new UndercoverStarServiceError('对局不存在。', 404, 'MATCH_NOT_FOUND')
  const existingOrder = readStringArray(refreshed.speakingOrder)
  await transitionToDescribingTx(tx, refreshed, now, existingOrder.length ? existingOrder : randomSpeakingOrder(refreshed))
}

export async function startUndercoverMatch(userId: string, roomId: string, now = new Date()) {
  const config = await getUndercoverConfig()
  if (!config.enabled) throw new UndercoverStarServiceError('卧底巨星目前暂时关闭，请稍后再试。', 409, 'GAME_DISABLED')
  const result = await undercoverTransaction(async (tx) => {
    await lockUser(tx, userId)
    await lockRoom(tx, roomId)
    const room = await tx.undercoverRoom.findUnique({ where: { id: roomId }, include: roomInclude })
    if (!room) throw new UndercoverStarServiceError('房间不存在。', 404, 'ROOM_NOT_FOUND')
    if (room.status !== 'WAITING') throw new UndercoverStarServiceError('房间已经开始或结束。', 409, 'ROOM_NOT_WAITING')
    if (room.hostId !== userId) throw new UndercoverStarServiceError('只有房主可以开始游戏。', 403, 'HOST_ONLY')
    const players = room.UndercoverRoomPlayer
    if (players.length < UNDERCOVER_MIN_PLAYERS) throw new UndercoverStarServiceError('至少需要3名玩家才能开始。', 409, 'NOT_ENOUGH_PLAYERS')
    if (players.length > UNDERCOVER_MAX_PLAYERS) throw new UndercoverStarServiceError('房间人数超过上限。', 409, 'ROOM_FULL')
    if (players.some((player) => !player.isReady)) throw new UndercoverStarServiceError('请等待所有玩家准备。', 409, 'PLAYERS_NOT_READY')
    // 词库必须按房间当前难度抽取，不混抽其它难度。
    const pairs = await tx.undercoverWordPair.findMany({ where: { enabled: true, difficulty: room.difficulty }, orderBy: [{ usageCount: 'asc' }, { updatedAt: 'asc' }], take: 500 })
    const validPairs = pairs.filter((candidate) => {
      const civilianWord = normalizeUndercoverWord(candidate.civilianWord)
      const undercoverWord = normalizeUndercoverWord(candidate.undercoverWord)
      return Boolean(civilianWord && undercoverWord && civilianWord !== undercoverWord)
    })
    const pair = randomItem(validPairs)
    if (!pair) throw new UndercoverStarServiceError('当前难度暂无可用词组，请更换难度后再开始。', 409, 'WORD_POOL_EMPTY')
    const undercoverIndex = randomInt(players.length)
    // 1:N：同一房间可多次开局；每局编号递增，不复用旧 Match。
    const matchNumber = (await tx.undercoverMatch.count({ where: { roomId } })) + 1
    const match = await tx.undercoverMatch.create({
      data: {
        id: randomUUID(),
        roomId,
        matchNumber,
        difficulty: room.difficulty,
        wordPairId: pair.id,
        civilianWord: pair.civilianWord,
        undercoverWord: pair.undercoverWord,
        speakingOrder: inputJson([]),
        phase: 'ROLE_REVEAL',
        status: 'PLAYING',
        round: 1,
        revision: 1,
        phaseDeadline: new Date(now.getTime() + UNDERCOVER_ROLE_REVEAL_MS),
        UndercoverMatchPlayer: {
          create: players.map((roomPlayer, index) => ({
            id: randomUUID(),
            userId: roomPlayer.User.id,
            role: index === undercoverIndex ? 'UNDERCOVER' : 'CIVILIAN',
            word: index === undercoverIndex ? pair.undercoverWord : pair.civilianWord,
            isAlive: true,
            isOnline: nowOnline(roomPlayer.lastSeenAt, now),
            lastSeenAt: roomPlayer.lastSeenAt || now,
          })),
        },
      },
      select: { id: true, roomId: true },
    })
    await tx.undercoverWordPair.update({ where: { id: pair.id }, data: { usageCount: { increment: 1 } } })
    // Room 进入 PLAYING 并指向本局；WAITING 房间的 currentMatchId 必须为 null。
    await tx.undercoverRoom.update({ where: { id: roomId }, data: { status: 'PLAYING', currentMatchId: match.id, lastActivityAt: now, updatedAt: now } })
    return match
  })
  return { matchId: result.id, roomId: result.roomId }
}

export async function updateUndercoverRoomDifficulty(hostId: string, roomId: string, difficulty: unknown, now = new Date()) {
  if (!isUndercoverDifficulty(difficulty)) throw new UndercoverStarServiceError('难度无效。', 400, 'DIFFICULTY_INVALID')
  return undercoverTransaction(async (tx) => {
    await lockUser(tx, hostId)
    await lockRoom(tx, roomId)
    const room = await tx.undercoverRoom.findUnique({ where: { id: roomId }, select: { id: true, hostId: true, status: true, currentMatchId: true, difficulty: true } })
    if (!room) throw new UndercoverStarServiceError('房间不存在。', 404, 'ROOM_NOT_FOUND')
    if (room.hostId !== hostId) throw new UndercoverStarServiceError('只有房主可以修改难度。', 403, 'HOST_ONLY')
    // 仅 WAITING 且未绑定进行中对局时可改；PLAYING 或已开局时禁止。
    if (room.status !== 'WAITING') throw new UndercoverStarServiceError('对局已经开始，不能修改难度。', 409, 'ROOM_NOT_WAITING')
    if (room.currentMatchId) throw new UndercoverStarServiceError('本局已开始，不能修改难度。', 409, 'MATCH_IN_PROGRESS')
    if (room.difficulty === difficulty) return difficulty
    await tx.undercoverRoom.update({ where: { id: roomId }, data: { difficulty, updatedAt: now } })
    return difficulty
  })
}

async function finishMatchTx(
  tx: Prisma.TransactionClient,
  match: MatchRow,
  winner: UndercoverWinnerSide,
  reason: 'UNDERCOVER_SURVIVAL' | 'UNDERCOVER_GUESS_CORRECT' | 'UNDERCOVER_GUESS_WRONG' | 'UNDERCOVER_GUESS_TIMEOUT',
  history: StoredRoundResult[],
  now: Date,
  guess?: string | null,
  guessCorrect?: boolean,
): Promise<FinishResult> {
  const changed = await tx.undercoverMatch.updateMany({
    where: { id: match.id, status: 'PLAYING' },
    data: {
      status: 'FINISHED',
      phase: 'FINISHED',
      winner,
      finishReason: reason,
      roundHistory: inputJson(history),
      finalResult: inputJson({
        winner,
        reason,
        civilianWord: match.civilianWord,
        undercoverWord: match.undercoverWord,
        undercoverPlayerId: match.UndercoverMatchPlayer.find((player) => player.role === 'UNDERCOVER')?.id || '',
        players: [],
      }),
      undercoverGuess: guess === undefined ? match.undercoverGuess : guess,
      undercoverGuessCorrect: guessCorrect === undefined ? match.undercoverGuessCorrect : guessCorrect,
      undercoverGuessAt: guess === undefined ? match.undercoverGuessAt : now,
      finishedAt: now,
      phaseDeadline: null,
      currentSpeakerId: null,
      currentSpeakerIndex: null,
      tieCandidateIds: Prisma.JsonNull,
      revision: { increment: 1 },
      updatedAt: now,
    },
  })
  if (!changed.count) {
    return { changed: false, userIds: match.UndercoverMatchPlayer.map((player) => player.User.id) }
  }

  const players = await tx.undercoverMatchPlayer.findMany({
    where: { matchId: match.id },
    orderBy: { createdAt: 'asc' },
    include: { User: { select: publicUserSelect } },
  })
  const votes = await tx.undercoverVote.findMany({ where: { matchId: match.id }, select: { voterId: true, targetId: true } })
  const undercover = players.find((player) => player.role === 'UNDERCOVER')
  const votesByTarget = new Map<string, number>()
  const successfulVoters = new Set<string>()
  for (const vote of votes) {
    if (vote.targetId) votesByTarget.set(vote.targetId, (votesByTarget.get(vote.targetId) || 0) + 1)
    if (undercover && vote.targetId === undercover.id) successfulVoters.add(vote.voterId)
  }
  const finalPlayers: UndercoverFinalPlayer[] = players.map((player) => ({
    playerId: player.id,
    userId: player.User.id,
    role: player.role,
    word: player.word,
    isAlive: player.isAlive,
    totalVotesReceived: votesByTarget.get(player.id) || 0,
  }))
  const finalResult: UndercoverFinalResult = {
    winner,
    reason,
    civilianWord: match.civilianWord,
    undercoverWord: match.undercoverWord,
    undercoverPlayerId: undercover?.id || '',
    players: finalPlayers,
  }
  await tx.undercoverMatch.update({
    where: { id: match.id },
    data: { finalResult: inputJson(finalResult) },
  })
  // 一局结束：Match 永久保持 FINISHED，但 Room 必须回到 WAITING，
  // 以便同一房间可以开始下一局（新 Match，不复用）。清空 currentMatchId 并重置准备状态。
  await tx.undercoverRoomPlayer.updateMany({
    where: { roomId: match.roomId, leftAt: null },
    data: { isReady: false, updatedAt: now },
  })
  await tx.undercoverRoom.updateMany({
    where: { id: match.roomId },
    data: { status: 'WAITING', currentMatchId: null, closedAt: null, lastActivityAt: now, updatedAt: now },
  })

  for (const player of players) {
    const isWinner = (player.role === 'UNDERCOVER' && winner === 'UNDERCOVER') || (player.role === 'CIVILIAN' && winner === 'CIVILIAN')
    const xpEarned = computeUndercoverXp({ isWin: isWinner })
    // 幂等结算：matchId+userId 唯一约束保证同一玩家在一局内只结算一次。
    // 若 Result 已存在（并发/重复 finish 触发 P2002），该玩家的统计
    // （games/wins/losses/XP/level）必须立即跳过，绝不能继续往下累加，
    // 否则会出现重复结算。禁止“catch P2002 后继续 upsert”的旧写法。
    let createdResult = true
    try {
      await tx.undercoverMatchResult.create({
        data: {
          id: randomUUID(),
          matchId: match.id,
          userId: player.User.id,
          role: player.role,
          isWin: isWinner,
          xpAwarded: xpEarned,
          createdAt: now,
        },
      })
    } catch (error) {
      if (errorCode(error) !== 'P2002') throw error
      createdResult = false
    }
    if (!createdResult) continue
    // 读取当前累计 XP 以计算新等级（等级由 XP 推导，避免与 XP 数据不同步）。
    const current = await tx.undercoverStats.findUnique({ where: { userId: player.User.id }, select: { xp: true } })
    const newXp = (current?.xp || 0) + xpEarned
    const newLevel = levelFromXp(newXp)
    await tx.undercoverStats.upsert({
      where: { userId: player.User.id },
      update: {
        totalGames: { increment: 1 },
        totalWins: { increment: isWinner ? 1 : 0 },
        totalLosses: { increment: isWinner ? 0 : 1 },
        civilianGames: { increment: player.role === 'CIVILIAN' ? 1 : 0 },
        civilianWins: { increment: player.role === 'CIVILIAN' && winner === 'CIVILIAN' ? 1 : 0 },
        undercoverGames: { increment: player.role === 'UNDERCOVER' ? 1 : 0 },
        undercoverWins: { increment: player.role === 'UNDERCOVER' && winner === 'UNDERCOVER' ? 1 : 0 },
        successfulUndercoverVotes: { increment: player.role === 'CIVILIAN' && successfulVoters.has(player.id) ? 1 : 0 },
        undercoverSurvivalWins: { increment: player.role === 'UNDERCOVER' && reason === 'UNDERCOVER_SURVIVAL' ? 1 : 0 },
        undercoverGuessWins: { increment: player.role === 'UNDERCOVER' && reason === 'UNDERCOVER_GUESS_CORRECT' ? 1 : 0 },
        xp: newXp,
        level: newLevel,
        updatedAt: now,
      },
      create: {
        id: randomUUID(),
        userId: player.User.id,
        totalGames: 1,
        totalWins: isWinner ? 1 : 0,
        totalLosses: isWinner ? 0 : 1,
        civilianGames: player.role === 'CIVILIAN' ? 1 : 0,
        civilianWins: player.role === 'CIVILIAN' && winner === 'CIVILIAN' ? 1 : 0,
        undercoverGames: player.role === 'UNDERCOVER' ? 1 : 0,
        undercoverWins: player.role === 'UNDERCOVER' && winner === 'UNDERCOVER' ? 1 : 0,
        successfulUndercoverVotes: player.role === 'CIVILIAN' && successfulVoters.has(player.id) ? 1 : 0,
        undercoverSurvivalWins: player.role === 'UNDERCOVER' && reason === 'UNDERCOVER_SURVIVAL' ? 1 : 0,
        undercoverGuessWins: player.role === 'UNDERCOVER' && reason === 'UNDERCOVER_GUESS_CORRECT' ? 1 : 0,
        xp: xpEarned,
        level: newLevel,
        createdAt: now,
        updatedAt: now,
      },
    })
  }
  return { changed: true, userIds: players.map((player) => player.User.id) }
}

async function syncUndercoverAchievements(userIds: string[]) {
  await Promise.all([...new Set(userIds)].map((userId) => syncUserAchievements(userId, ['SPECIAL']).catch((error) => {
    console.error('[undercover-star.achievements]', error)
  })))
}

async function moveAfterDescriptionTx(tx: Prisma.TransactionClient, match: MatchRow, now: Date) {
  const refreshed = await tx.undercoverMatch.findUnique({ where: { id: match.id }, include: matchInclude })
  if (!refreshed || refreshed.status !== 'PLAYING' || refreshed.phase !== 'DESCRIBING') return
  const alive = activeMatchPlayers(refreshed)
  const submitted = new Set(refreshed.UndercoverDescription.filter((item) => item.round === refreshed.round).map((item) => item.matchPlayerId))
  if (alive.every((player) => submitted.has(player.id))) {
    await tx.undercoverMatch.update({
      where: { id: refreshed.id },
      data: {
        phase: 'VOTING',
        revision: { increment: 1 },
        currentSpeakerId: null,
        currentSpeakerIndex: null,
        tieCandidateIds: Prisma.JsonNull,
        phaseDeadline: new Date(now.getTime() + UNDERCOVER_VOTING_MS),
      },
    })
    return
  }
  const order = readStringArray(refreshed.speakingOrder)
  const currentIndex = Math.max(0, order.indexOf(refreshed.currentSpeakerId || ''))
  const next = [...order.slice(currentIndex + 1), ...order.slice(0, currentIndex + 1)].find((id) => {
    const player = alive.find((item) => item.id === id)
    return player && !submitted.has(id)
  })
  if (!next) return
  await tx.undercoverMatch.update({
    where: { id: refreshed.id },
    data: {
      revision: { increment: 1 },
      currentSpeakerId: next,
      currentSpeakerIndex: order.indexOf(next),
      phaseDeadline: new Date(now.getTime() + UNDERCOVER_DESCRIPTION_MS),
    },
  })
}

async function submitDescriptionTx(tx: Prisma.TransactionClient, match: MatchRow, playerId: string, content: string, isAuto: boolean, now: Date) {
  const player = match.UndercoverMatchPlayer.find((item) => item.id === playerId)
  if (!player) throw new UndercoverStarServiceError('玩家不存在。', 404, 'PLAYER_NOT_FOUND')
  const existing = await tx.undercoverDescription.findUnique({ where: { matchId_round_matchPlayerId: { matchId: match.id, round: match.round, matchPlayerId: playerId } } })
  if (existing) return false
  if (match.phase !== 'DESCRIBING') throw new UndercoverStarServiceError('当前不是描述阶段。', 409, 'PHASE_INVALID')
  if (!player.isAlive || match.currentSpeakerId !== playerId) throw new UndercoverStarServiceError('现在还没有轮到你描述。', 403, 'NOT_CURRENT_SPEAKER')
  await tx.undercoverDescription.create({ data: { id: randomUUID(), matchId: match.id, matchPlayerId: playerId, round: match.round, content, isAuto } })
  await tx.undercoverMatchPlayer.update({ where: { id: playerId }, data: { lastSeenAt: now, isOnline: true, updatedAt: now } })
  await moveAfterDescriptionTx(tx, match, now)
  return true
}

export async function confirmUndercoverRole(userId: string, matchId: string, expectedRevision?: number, now = new Date()) {
  await advanceExpiredUndercoverMatch(matchId, now)
  await undercoverTransaction(async (tx) => {
    await lockMatch(tx, matchId)
    const match = await tx.undercoverMatch.findUnique({ where: { id: matchId }, include: matchInclude })
    if (!match) throw new UndercoverStarServiceError('对局不存在。', 404, 'MATCH_NOT_FOUND')
    const player = matchPlayerForUser(match, userId)
    if (match.status !== 'PLAYING' || match.phase !== 'ROLE_REVEAL') throw new UndercoverStarServiceError('当前不在身份确认阶段。', 409, 'PHASE_INVALID')
    if (player.roleConfirmedAt) return
    assertExpectedState(match, expectedRevision)
    await tx.undercoverMatchPlayer.update({ where: { id: player.id }, data: { roleConfirmedAt: now, lastSeenAt: now, isOnline: true, updatedAt: now } })
    const remaining = await tx.undercoverMatchPlayer.count({ where: { matchId, roleConfirmedAt: null } })
    if (!remaining) {
      const refreshed = await tx.undercoverMatch.findUnique({ where: { id: matchId }, include: matchInclude })
      if (!refreshed) throw new UndercoverStarServiceError('对局不存在。', 404, 'MATCH_NOT_FOUND')
      await transitionToDescribingTx(tx, refreshed, now)
    } else {
      await tx.undercoverMatch.update({ where: { id: matchId }, data: { revision: { increment: 1 }, updatedAt: now } })
    }
  })
  return getUndercoverMatchState(userId, matchId, now)
}

export async function submitUndercoverDescription(userId: string, matchId: string, input: { content?: unknown; expectedRevision?: number; expectedRound?: number }, now = new Date()) {
  await advanceExpiredUndercoverMatch(matchId, now)
  await undercoverTransaction(async (tx) => {
    await lockMatch(tx, matchId)
    const match = await tx.undercoverMatch.findUnique({ where: { id: matchId }, include: matchInclude })
    if (!match) throw new UndercoverStarServiceError('对局不存在。', 404, 'MATCH_NOT_FOUND')
    const player = matchPlayerForUser(match, userId)
    const existing = await tx.undercoverDescription.findUnique({ where: { matchId_round_matchPlayerId: { matchId, round: match.round, matchPlayerId: player.id } } })
    if (existing) return
    assertExpectedState(match, input.expectedRevision, input.expectedRound)
    let content = sanitizeText(input.content, UNDERCOVER_MAX_DESCRIPTION_LENGTH)
    if (!content) throw new UndercoverStarServiceError('描述不能为空。', 400, 'DESCRIPTION_EMPTY')
    if (String(input.content ?? '').length > UNDERCOVER_MAX_DESCRIPTION_LENGTH) throw new UndercoverStarServiceError('描述不能超过30个字。', 400, 'DESCRIPTION_TOO_LONG')
    content = content.trim()
    if (isDirectUndercoverWordMention(content, player.word)) throw new UndercoverStarServiceError('描述中不能直接出现你的词语。', 400, 'WORD_MENTIONED')
    await submitDescriptionTx(tx, match, player.id, content, false, now)
  })
  return getUndercoverMatchState(userId, matchId, now)
}

function currentRoundDescriptions(match: MatchRow): StoredDescription[] {
  return match.UndercoverDescription
    .filter((description) => description.round === match.round)
    .map((description) => ({ playerId: description.matchPlayerId, content: description.content, isAuto: description.isAuto }))
}

/**
 * 按轮分组全部发言（含当前轮），用于发言历史。
 * 注意：必须包含该轮全部 Description，绝不能按 speaker 排除最后一人（生产历史 Bug 不在本阶段修复，
 * 但本序列化不应建立在此类 N-1 数据之上）。轮内按 createdAt 升序，轮次按 round 升序。
 */
function descriptionHistoryByRound(match: MatchRow): UndercoverDescriptionByRound[] {
  const byRound = new Map<number, Array<{ entry: UndercoverDescriptionPublic; createdAt: Date }>>()
  for (const description of match.UndercoverDescription) {
    const player = playerById(match, description.matchPlayerId)
    const entry: UndercoverDescriptionPublic = {
      playerId: description.matchPlayerId,
      userId: player?.User.id || '',
      name: player ? getPublicUserDisplayName(player.User) : '玩家',
      round: description.round,
      content: description.content,
      isAuto: description.isAuto,
    }
    const list = byRound.get(description.round) || []
    list.push({ entry, createdAt: description.createdAt })
    byRound.set(description.round, list)
  }
  return Array.from(byRound.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([round, list]) => ({
      round,
      descriptions: list
        .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
        .map((item) => item.entry),
    }))
}

async function settleVoteStageTx(tx: Prisma.TransactionClient, match: MatchRow, stage: UndercoverVoteStage, now: Date): Promise<FinishResult | null> {
  const votes = await tx.undercoverVote.findMany({ where: { matchId: match.id, round: match.round, stage } })
  const alive = await tx.undercoverMatchPlayer.findMany({ where: { matchId: match.id, isAlive: true }, orderBy: { createdAt: 'asc' }, include: { User: { select: publicUserSelect } } })
  const counts = new Map<string, number>()
  for (const vote of votes) if (vote.targetId) counts.set(vote.targetId, (counts.get(vote.targetId) || 0) + 1)
  const maxVotes = Math.max(0, ...Array.from(counts.values()))
  const candidates = maxVotes > 0 ? alive.filter((player) => counts.get(player.id) === maxVotes).map((player) => player.id) : []
  const baseMatch = await tx.undercoverMatch.findUnique({ where: { id: match.id }, include: matchInclude })
  if (!baseMatch) throw new UndercoverStarServiceError('对局不存在。', 404, 'MATCH_NOT_FOUND')
  const voteCounts = alive.map((player) => ({ playerId: player.id, count: counts.get(player.id) || 0 })).filter((item) => item.count > 0)
  const descriptions = currentRoundDescriptions(baseMatch)
  const noElimination: StoredRoundResult = {
    round: baseMatch.round,
    kind: 'NO_ELIMINATION',
    eliminatedPlayerId: null,
    voteCounts,
    tieCandidates: candidates,
    descriptions,
  }
  if (candidates.length > 1) {
    if (stage === 'MAIN') {
      await tx.undercoverMatch.update({
        where: { id: match.id },
        data: {
          phase: 'TIE_VOTING',
          tieCandidateIds: inputJson(candidates),
          phaseDeadline: new Date(now.getTime() + UNDERCOVER_VOTING_MS),
          revision: { increment: 1 },
        },
      })
      return null
    }
    await startNextRoundTx(tx, baseMatch, noElimination, now)
    return null
  }
  if (!candidates.length) {
    await startNextRoundTx(tx, baseMatch, noElimination, now)
    return null
  }

  const eliminatedId = candidates[0]
  const eliminated = alive.find((player) => player.id === eliminatedId)
  if (!eliminated) throw new UndercoverStarServiceError('淘汰目标不存在。', 409, 'ELIMINATION_TARGET_INVALID')
  await tx.undercoverMatchPlayer.update({ where: { id: eliminated.id }, data: { isAlive: false, eliminatedAt: now, eliminatedRound: baseMatch.round, updatedAt: now } })
  const result: StoredRoundResult = {
    round: baseMatch.round,
    kind: eliminated.role === 'UNDERCOVER' ? 'UNDERCOVER_FOUND' : 'CIVILIAN_ELIMINATED',
    eliminatedPlayerId: eliminated.id,
    voteCounts,
    tieCandidates: [],
    descriptions,
  }
  const refreshed = await tx.undercoverMatch.findUnique({ where: { id: match.id }, include: matchInclude })
  if (!refreshed) throw new UndercoverStarServiceError('对局不存在。', 404, 'MATCH_NOT_FOUND')
  const history = appendHistory(refreshed.roundHistory, result)
  if (eliminated.role === 'UNDERCOVER') {
    await tx.undercoverMatch.update({
      where: { id: match.id },
      data: {
        phase: 'UNDERCOVER_GUESS',
        currentSpeakerId: null,
        currentSpeakerIndex: null,
        tieCandidateIds: Prisma.JsonNull,
        roundHistory: inputJson(history),
        phaseDeadline: new Date(now.getTime() + UNDERCOVER_GUESS_MS),
        revision: { increment: 1 },
      },
    })
    return null
  }
  const remaining = await tx.undercoverMatchPlayer.count({ where: { matchId: match.id, isAlive: true } })
  const undercoverAlive = await tx.undercoverMatchPlayer.count({ where: { matchId: match.id, isAlive: true, role: 'UNDERCOVER' } })
  if (remaining <= 2 && undercoverAlive > 0) {
    const resultMatch = await tx.undercoverMatch.findUnique({ where: { id: match.id }, include: matchInclude })
    if (!resultMatch) throw new UndercoverStarServiceError('对局不存在。', 404, 'MATCH_NOT_FOUND')
    return finishMatchTx(tx, resultMatch, 'UNDERCOVER', 'UNDERCOVER_SURVIVAL', history, now)
  }
  const resultMatch = await tx.undercoverMatch.findUnique({ where: { id: match.id }, include: matchInclude })
  if (!resultMatch) throw new UndercoverStarServiceError('对局不存在。', 404, 'MATCH_NOT_FOUND')
  await startNextRoundTx(tx, resultMatch, result, now)
  return null
}

async function fillMissingVotesAndSettleTx(tx: Prisma.TransactionClient, match: MatchRow, stage: UndercoverVoteStage, now: Date) {
  const alive = await tx.undercoverMatchPlayer.findMany({ where: { matchId: match.id, isAlive: true }, orderBy: { createdAt: 'asc' } })
  const existing = await tx.undercoverVote.findMany({ where: { matchId: match.id, round: match.round, stage }, select: { voterId: true } })
  const voted = new Set(existing.map((vote) => vote.voterId))
  for (const player of alive) {
    if (voted.has(player.id)) continue
    await tx.undercoverVote.create({
      data: {
        id: randomUUID(),
        matchId: match.id,
        round: match.round,
        stage,
        voterId: player.id,
        targetId: null,
        isAbstain: true,
      },
    })
  }
  const refreshed = await tx.undercoverMatch.findUnique({ where: { id: match.id }, include: matchInclude })
  if (!refreshed) throw new UndercoverStarServiceError('对局不存在。', 404, 'MATCH_NOT_FOUND')
  return settleVoteStageTx(tx, refreshed, stage, now)
}

export async function submitUndercoverVote(userId: string, matchId: string, input: { targetId?: unknown; abstain?: unknown; expectedRevision?: number; expectedRound?: number }, now = new Date()) {
  await advanceExpiredUndercoverMatch(matchId, now)
  const finish = await undercoverTransaction(async (tx): Promise<FinishResult | null> => {
    let result: FinishResult | null = null
    await lockMatch(tx, matchId)
    const match = await tx.undercoverMatch.findUnique({ where: { id: matchId }, include: matchInclude })
    if (!match) throw new UndercoverStarServiceError('对局不存在。', 404, 'MATCH_NOT_FOUND')
    const player = matchPlayerForUser(match, userId)
    const stage: UndercoverVoteStage = match.phase === 'VOTING' ? 'MAIN' : match.phase === 'TIE_VOTING' ? 'TIE' : (() => { throw new UndercoverStarServiceError('当前不是投票阶段。', 409, 'PHASE_INVALID') })()
    const existing = await tx.undercoverVote.findUnique({ where: { matchId_round_stage_voterId: { matchId, round: match.round, stage, voterId: player.id } } })
    if (existing) return null
    assertExpectedState(match, input.expectedRevision, input.expectedRound)
    if (!player.isAlive) throw new UndercoverStarServiceError('被淘汰后不能投票。', 403, 'PLAYER_ELIMINATED')
    // 明确弃票：targetId 必须为空，isAbstain=true，不计入候选票。
    const wantAbstain = input.abstain === true
    if (wantAbstain) {
      await tx.undercoverVote.create({ data: { id: randomUUID(), matchId, round: match.round, stage, voterId: player.id, targetId: null, isAbstain: true } })
    } else {
      const targetId = typeof input.targetId === 'string' ? input.targetId : ''
      if (!targetId) throw new UndercoverStarServiceError('请选择一名玩家投票，或选择弃票。', 400, 'VOTE_TARGET_REQUIRED')
      if (targetId === player.id) throw new UndercoverStarServiceError('不能投自己。', 400, 'CANNOT_VOTE_SELF')
      const target = match.UndercoverMatchPlayer.find((item) => item.id === targetId)
      if (!target || !target.isAlive) throw new UndercoverStarServiceError('不能投已淘汰的玩家。', 400, 'VOTE_TARGET_INVALID')
      if (stage === 'TIE' && !readStringArray(match.tieCandidateIds).includes(targetId)) throw new UndercoverStarServiceError('加赛只能投平票候选人。', 400, 'TIE_TARGET_INVALID')
      await tx.undercoverVote.create({ data: { id: randomUUID(), matchId, round: match.round, stage, voterId: player.id, targetId, isAbstain: false } })
    }
    await tx.undercoverMatchPlayer.update({ where: { id: player.id }, data: { lastSeenAt: now, isOnline: true, updatedAt: now } })
    const total = await tx.undercoverMatchPlayer.count({ where: { matchId, isAlive: true } })
    const submitted = await tx.undercoverVote.count({ where: { matchId, round: match.round, stage } })
    if (submitted >= total) {
      const refreshed = await tx.undercoverMatch.findUnique({ where: { id: matchId }, include: matchInclude })
      if (!refreshed) throw new UndercoverStarServiceError('对局不存在。', 404, 'MATCH_NOT_FOUND')
      result = await settleVoteStageTx(tx, refreshed, stage, now)
    } else {
      await tx.undercoverMatch.update({ where: { id: matchId }, data: { revision: { increment: 1 }, updatedAt: now } })
    }
    return result
  })
  if (finish?.changed) await syncUndercoverAchievements(finish.userIds)
  return getUndercoverMatchState(userId, matchId, now)
}

export async function submitUndercoverGuess(userId: string, matchId: string, input: { guess?: unknown; expectedRevision?: number }, now = new Date()) {
  await advanceExpiredUndercoverMatch(matchId, now)
  const finish = await undercoverTransaction(async (tx): Promise<FinishResult | null> => {
    await lockMatch(tx, matchId)
    const match = await tx.undercoverMatch.findUnique({ where: { id: matchId }, include: matchInclude })
    if (!match) throw new UndercoverStarServiceError('对局不存在。', 404, 'MATCH_NOT_FOUND')
    const player = matchPlayerForUser(match, userId)
    if (match.phase !== 'UNDERCOVER_GUESS') throw new UndercoverStarServiceError('当前不是卧底猜词阶段。', 409, 'PHASE_INVALID')
    if (player.role !== 'UNDERCOVER') throw new UndercoverStarServiceError('只有卧底可以猜词。', 403, 'UNDERCOVER_ONLY')
    if (match.undercoverGuessAt) return null
    assertExpectedState(match, input.expectedRevision)
    const guess = sanitizeText(input.guess, UNDERCOVER_MAX_WORD_LENGTH)
    if (!guess) throw new UndercoverStarServiceError('猜词不能为空。', 400, 'GUESS_EMPTY')
    const correct = normalizeUndercoverWord(guess) === normalizeUndercoverWord(match.civilianWord)
    const refreshed = await tx.undercoverMatch.findUnique({ where: { id: matchId }, include: matchInclude })
    if (!refreshed) throw new UndercoverStarServiceError('对局不存在。', 404, 'MATCH_NOT_FOUND')
    return finishMatchTx(tx, refreshed, correct ? 'UNDERCOVER' : 'CIVILIAN', correct ? 'UNDERCOVER_GUESS_CORRECT' : 'UNDERCOVER_GUESS_WRONG', readHistory(refreshed.roundHistory), now, guess, correct)
  })
  if (finish?.changed) await syncUndercoverAchievements(finish.userIds)
  return getUndercoverMatchState(userId, matchId, now)
}

export async function advanceExpiredUndercoverMatch(matchId: string, now = new Date()) {
  const finish = await undercoverTransaction(async (tx): Promise<FinishResult | null> => {
    await lockMatch(tx, matchId)
    const match = await tx.undercoverMatch.findUnique({ where: { id: matchId }, include: matchInclude })
    if (!match || match.status !== 'PLAYING' || !match.phaseDeadline || match.phaseDeadline.getTime() > now.getTime()) return null
    if (match.phase === 'ROLE_REVEAL') {
      await setRoleRevealConfirmedTx(tx, match, now)
      return null
    }
    if (match.phase === 'DESCRIBING') {
      const current = playerById(match, match.currentSpeakerId)
      const existing = current
        ? match.UndercoverDescription.find((item) => item.round === match.round && item.matchPlayerId === current.id)
        : null
      if (current && !existing) {
        await submitDescriptionTx(tx, match, current.id, '（本轮未描述）', true, now)
      } else {
        await moveAfterDescriptionTx(tx, match, now)
      }
      return null
    }
    if (match.phase === 'VOTING' || match.phase === 'TIE_VOTING') {
      return fillMissingVotesAndSettleTx(tx, match, match.phase === 'VOTING' ? 'MAIN' : 'TIE', now)
    }
    if (match.phase === 'UNDERCOVER_GUESS') {
      return finishMatchTx(tx, match, 'CIVILIAN', 'UNDERCOVER_GUESS_TIMEOUT', readHistory(match.roundHistory), now)
    }
    return null
  })
  if (finish?.changed) await syncUndercoverAchievements(finish.userIds)
  return finish
}

export async function touchUndercoverPresence(userId: string, roomId: string, matchId?: string, now = new Date()) {
  await prisma.undercoverRoomPlayer.updateMany({ where: { roomId, userId, leftAt: null }, data: { lastSeenAt: now, updatedAt: now } })
  if (matchId) await prisma.undercoverMatchPlayer.updateMany({ where: { matchId, userId }, data: { isOnline: true, lastSeenAt: now, updatedAt: now } })
  // 心跳续活：WAITING 房间随任意成员心跳刷新 lastActivityAt，避免「浏览器未关闭、仅挂机」的房间被误删；
  // 一旦所有成员断开（不再有 PING），lastActivityAt 停止更新，房间将在 TTL 内被清理。
  // 仅对 WAITING 房间生效；PLAYING 房间本就不会因 TTL 自动销毁。
  await prisma.undercoverRoom.updateMany({ where: { id: roomId, status: 'WAITING' }, data: { lastActivityAt: now, updatedAt: now } })
}

export async function setUndercoverPresence(userId: string, roomId: string, matchId: string | undefined, online: boolean, now = new Date()) {
  await prisma.undercoverRoomPlayer.updateMany({ where: { roomId, userId, leftAt: null }, data: { lastSeenAt: now, updatedAt: now } })
  if (matchId) await prisma.undercoverMatchPlayer.updateMany({ where: { matchId, userId }, data: { isOnline: online, lastSeenAt: now, updatedAt: now } })
}

function validateUndercoverWord(value: unknown, field: string) {
  const raw = String(value ?? '')
  const text = sanitizeText(raw, UNDERCOVER_MAX_WORD_LENGTH).normalize('NFKC').trim()
  if (!text) throw new UndercoverStarServiceError(`${field}不能为空。`, 400, 'WORD_EMPTY')
  if (raw.length > UNDERCOVER_MAX_WORD_LENGTH) throw new UndercoverStarServiceError(`${field}不能超过${UNDERCOVER_MAX_WORD_LENGTH}个字符。`, 400, 'WORD_TOO_LONG')
  if (!normalizeUndercoverWord(text)) throw new UndercoverStarServiceError(`${field}不能为空。`, 400, 'WORD_EMPTY')
  return text
}

function wordPairAdminRow(row: {
  id: string
  civilianWord: string
  undercoverWord: string
  category: UndercoverWordCategory
  difficulty: UndercoverDifficulty
  enabled: boolean
  usageCount: number
  createdAt: Date
  updatedAt: Date
}) {
  return {
    id: row.id,
    civilianWord: row.civilianWord,
    undercoverWord: row.undercoverWord,
    category: row.category,
    categoryLabel: undercoverCategoryLabels[row.category],
    difficulty: row.difficulty,
    difficultyLabel: undercoverDifficultyLabels[row.difficulty],
    enabled: row.enabled,
    configuredEnabled: row.enabled,
    usageCount: row.usageCount,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}

async function assertUniqueUndercoverPair(civilianWord: string, undercoverWord: string, excludeId?: string) {
  const normalizedCivilianWord = normalizeUndercoverWord(civilianWord)
  const normalizedUndercoverWord = normalizeUndercoverWord(undercoverWord)
  const duplicate = await prisma.undercoverWordPair.findFirst({
    where: {
      ...(excludeId ? { id: { not: excludeId } } : {}),
      OR: [
        { normalizedCivilianWord, normalizedUndercoverWord },
        { normalizedCivilianWord: normalizedUndercoverWord, normalizedUndercoverWord: normalizedCivilianWord },
      ],
    },
    select: { id: true },
  })
  if (duplicate) throw new UndercoverStarServiceError('这组词语已经存在。', 409, 'WORD_PAIR_DUPLICATE')
}

export async function listUndercoverWordPairs(input: { page?: number; pageSize?: number; query?: string; category?: unknown; difficulty?: unknown } = {}) {
  const page = Math.max(1, Math.trunc(input.page || 1))
  const pageSize = Math.min(50, Math.max(1, Math.trunc(input.pageSize || 20)))
  const query = sanitizeText(input.query, 100)
  const category = isUndercoverCategory(input.category) ? input.category : undefined
  const difficulty = isUndercoverDifficulty(input.difficulty) ? input.difficulty : undefined
  const where: Prisma.UndercoverWordPairWhereInput = {
    ...(query ? { OR: [{ civilianWord: { contains: query } }, { undercoverWord: { contains: query } }] } : {}),
    ...(category ? { category } : {}),
    ...(difficulty ? { difficulty } : {}),
  }
  const [rows, total] = await Promise.all([
    prisma.undercoverWordPair.findMany({ where, orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }], skip: (page - 1) * pageSize, take: pageSize }),
    prisma.undercoverWordPair.count({ where }),
  ])
  return { rows: rows.map((row) => wordPairAdminRow(row)), total, page, pageSize, totalPages: Math.max(1, Math.ceil(total / pageSize)) }
}

export async function getUndercoverWordPairAdmin(id: string) {
  const row = await prisma.undercoverWordPair.findUnique({ where: { id } })
  if (!row) throw new UndercoverStarServiceError('词组不存在。', 404, 'WORD_PAIR_NOT_FOUND')
  return wordPairAdminRow(row)
}

export async function createUndercoverWordPair(input: { civilianWord?: unknown; undercoverWord?: unknown; category?: unknown; difficulty?: unknown; enabled?: unknown }) {
  const civilianWord = validateUndercoverWord(input.civilianWord, '平民词')
  const undercoverWord = validateUndercoverWord(input.undercoverWord, '卧底词')
  if (normalizeUndercoverWord(civilianWord) === normalizeUndercoverWord(undercoverWord)) throw new UndercoverStarServiceError('平民词和卧底词不能相同。', 400, 'WORD_PAIR_SAME')
  const category = isUndercoverCategory(input.category) ? input.category : 'GENERAL'
  const difficulty = isUndercoverDifficulty(input.difficulty) ? input.difficulty : 'NORMAL'
  await assertUniqueUndercoverPair(civilianWord, undercoverWord)
  try {
    const row = await prisma.undercoverWordPair.create({
      data: {
        id: randomUUID(),
        civilianWord,
        undercoverWord,
        normalizedCivilianWord: normalizeUndercoverWord(civilianWord),
        normalizedUndercoverWord: normalizeUndercoverWord(undercoverWord),
        category,
        difficulty,
        enabled: input.enabled !== false,
      },
    })
    return row
  } catch (error) {
    if (errorCode(error) === 'P2002') throw new UndercoverStarServiceError('这组词语已经存在。', 409, 'WORD_PAIR_DUPLICATE')
    throw error
  }
}

export async function updateUndercoverWordPair(id: string, input: { civilianWord?: unknown; undercoverWord?: unknown; category?: unknown; difficulty?: unknown; enabled?: unknown }) {
  const current = await prisma.undercoverWordPair.findUnique({ where: { id } })
  if (!current) throw new UndercoverStarServiceError('词组不存在。', 404, 'WORD_PAIR_NOT_FOUND')
  const civilianWord = input.civilianWord === undefined ? current.civilianWord : validateUndercoverWord(input.civilianWord, '平民词')
  const undercoverWord = input.undercoverWord === undefined ? current.undercoverWord : validateUndercoverWord(input.undercoverWord, '卧底词')
  if (normalizeUndercoverWord(civilianWord) === normalizeUndercoverWord(undercoverWord)) throw new UndercoverStarServiceError('平民词和卧底词不能相同。', 400, 'WORD_PAIR_SAME')
  const category = input.category === undefined ? current.category : (isUndercoverCategory(input.category) ? input.category : (() => { throw new UndercoverStarServiceError('分类无效。', 400, 'CATEGORY_INVALID') })())
  const difficulty = input.difficulty === undefined ? current.difficulty : (isUndercoverDifficulty(input.difficulty) ? input.difficulty : (() => { throw new UndercoverStarServiceError('难度无效。', 400, 'DIFFICULTY_INVALID') })())
  await assertUniqueUndercoverPair(civilianWord, undercoverWord, id)
  return prisma.undercoverWordPair.update({
    where: { id },
    data: {
      civilianWord,
      undercoverWord,
      normalizedCivilianWord: normalizeUndercoverWord(civilianWord),
      normalizedUndercoverWord: normalizeUndercoverWord(undercoverWord),
      category,
      difficulty,
      ...(input.enabled === undefined ? {} : { enabled: input.enabled === true }),
    },
  })
}

export async function deleteUndercoverWordPair(id: string) {
  const used = await prisma.undercoverMatch.count({ where: { wordPairId: id } })
  if (used) throw new UndercoverStarServiceError('这组词已经被对局使用，请先停用。', 409, 'WORD_PAIR_IN_USE')
  try {
    await prisma.undercoverWordPair.delete({ where: { id } })
  } catch (error) {
    if (errorCode(error) === 'P2025') throw new UndercoverStarServiceError('词组不存在。', 404, 'WORD_PAIR_NOT_FOUND')
    throw error
  }
}

export async function getUndercoverUserStats(userId: string) {
  const stats = await prisma.undercoverStats.findUnique({ where: { userId } })
  const xp = stats?.xp || 0
  return {
    totalGames: stats?.totalGames || 0,
    totalWins: stats?.totalWins || 0,
    totalLosses: stats?.totalLosses || 0,
    winRate: stats?.totalGames ? Math.round((stats.totalWins / stats.totalGames) * 10000) / 100 : 0,
    xp,
    level: levelFromXp(xp),
    civilianGames: stats?.civilianGames || 0,
    civilianWins: stats?.civilianWins || 0,
    undercoverGames: stats?.undercoverGames || 0,
    undercoverWins: stats?.undercoverWins || 0,
    successfulUndercoverVotes: stats?.successfulUndercoverVotes || 0,
    undercoverSurvivalWins: stats?.undercoverSurvivalWins || 0,
    undercoverGuessWins: stats?.undercoverGuessWins || 0,
  }
}

export async function getUndercoverAdminOverview(now = new Date()) {
  const start = new Date(now)
  start.setHours(0, 0, 0, 0)
  const end = new Date(start)
  end.setDate(end.getDate() + 1)
  const [todayMatches, historicalCompletedGames, enabledWordPairs, allWordPairs] = await Promise.all([
    prisma.undercoverMatch.findMany({
      where: { status: 'FINISHED', finishedAt: { gte: start, lt: end } },
      select: { id: true, UndercoverMatchPlayer: { select: { userId: true } } },
    }),
    prisma.undercoverMatch.count({ where: { status: 'FINISHED' } }),
    prisma.undercoverWordPair.count({ where: { enabled: true } }),
    prisma.undercoverWordPair.count(),
  ])
  const participants = new Set(todayMatches.flatMap((match) => match.UndercoverMatchPlayer.map((player) => player.userId)))
  return {
    todayParticipants: participants.size,
    todayCompletedGames: todayMatches.length,
    historicalCompletedGames,
    enabledWordPairs,
    totalWordPairs: allWordPairs,
  }
}

// ─────────────────────────────────────────────────────────────────────────
// 等候聊天室（Phase 4）
//
// 仅在 Room 处于 WAITING 且没有进行中对局（currentMatchId === null）时开放。
// 聊天消息是独立事件：不触发 revision++、不改变 gameplay state、不刷新 ready。
// 但「房间聊天」本身算作活动时间（需求第七节），发送消息会刷新房间的
// lastActivityAt，避免活跃聊天中的等候室被误判为失活而提前销毁。
// 被踢/已离开玩家因不再属于有效成员而自然失去读写权限。
// ─────────────────────────────────────────────────────────────────────────

type RoomMessageRow = Prisma.UndercoverRoomMessageGetPayload<{ include: { User: { select: typeof publicUserSelect } } }>

function roomMessagePublic(row: RoomMessageRow): UndercoverRoomMessagePublic {
  return {
    id: row.id,
    roomId: row.roomId,
    userId: row.userId,
    name: getPublicUserDisplayName(row.User),
    avatarUrl: profileImageUrl(row.User.Profile?.avatarUrl || row.User.avatarUrl),
    content: row.content,
    createdAt: row.createdAt.toISOString(),
  }
}

function assertRoomChatMember(room: { UndercoverRoomPlayer: Array<{ id: string }> }) {
  // 调用方已用 where: { userId, leftAt: null } 过滤，存在即表示是当前有效成员。
  if (!room.UndercoverRoomPlayer.length) throw new UndercoverStarServiceError('你不在这个房间中。', 403, 'ROOM_NOT_MEMBER')
}

export async function getRoomMessages(userId: string, roomId: string, limit = 50) {
  const room = await prisma.undercoverRoom.findUnique({
    where: { id: roomId },
    include: { UndercoverRoomPlayer: { where: { userId, leftAt: null }, select: { id: true } } },
  })
  if (!room) throw new UndercoverStarServiceError('房间不存在。', 404, 'ROOM_NOT_FOUND')
  // 非成员（含被踢/已离开）禁止读取聊天历史。
  assertRoomChatMember(room)
  // 查询最新 limit 条后反转，按 createdAt 旧 → 新返回；最多读取 50～100 条。
  const rows = await prisma.undercoverRoomMessage.findMany({
    where: { roomId },
    orderBy: { createdAt: 'desc' },
    take: Math.min(Math.max(limit, 1), 100),
    include: { User: { select: publicUserSelect } },
  })
  return rows.reverse().map(roomMessagePublic)
}

export async function sendRoomMessage(userId: string, roomId: string, rawContent: unknown, now = new Date()) {
  const room = await prisma.undercoverRoom.findUnique({
    where: { id: roomId },
    include: { UndercoverRoomPlayer: { where: { userId, leftAt: null }, select: { id: true } } },
  })
  if (!room) throw new UndercoverStarServiceError('房间不存在。', 404, 'ROOM_NOT_FOUND')
  assertRoomChatMember(room)
  // 等候聊天室关闭条件：房间已开始（PLAYING）或存在进行中对局。
  if (room.status !== 'WAITING' || room.currentMatchId) {
    throw new UndercoverStarServiceError('当前不在等候阶段，无法发送聊天。', 409, 'ROOM_CHAT_UNAVAILABLE')
  }

  const raw = typeof rawContent === 'string' ? rawContent : ''
  const content = raw.trim()
  if (!content) throw new UndercoverStarServiceError('消息不能为空。', 400, 'CHAT_EMPTY')
  if (content.length > 200) throw new UndercoverStarServiceError('消息不能超过 200 字。', 400, 'CHAT_TOO_LONG')
  const safe = sanitizeText(content, 200)

  // 轻量频率限制：1 秒最多 2 条、10 秒最多 8 条（复用站内 rate limit 设施）。
  const fast = await consumeRateLimit(userId, 'undercover_chat_fast', 2, 1)
  if (fast.limited) throw new UndercoverStarServiceError('发送过快，请稍后再试。', 429, 'ROOM_CHAT_RATE_LIMITED')
  const slow = await consumeRateLimit(userId, 'undercover_chat_slow', 8, 10)
  if (slow.limited) throw new UndercoverStarServiceError('发送过于频繁，请稍后再试。', 429, 'ROOM_CHAT_RATE_LIMITED')

  // 复用站内统一违禁词审核；管理员/超级管理员按现行策略绕过。
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { role: true } })
  if (!shouldBypassForbiddenWords(user) && (await containsBannedWord(safe))) {
    throw new UndercoverStarServiceError('内容包含违禁词，请修改后再提交。', 400, 'CHAT_CONTAINS_BANNED_WORD')
  }

  const created = await prisma.undercoverRoomMessage.create({
    data: { id: randomUUID(), roomId, userId, content: safe, createdAt: now },
    include: { User: { select: publicUserSelect } },
  })
  // 聊天即活动：刷新房间 lastActivityAt，使活跃聊天中的等候室不被 TTL 清理。
  await prisma.undercoverRoom.updateMany({ where: { id: roomId, status: 'WAITING' }, data: { lastActivityAt: now, updatedAt: now } })
  return roomMessagePublic(created)
}

/**
 * 批量聚合好友的卧底巨星在线状态（presence）。
 *
 * 目标：好友列表一次请求即可得到全部好友的 presence，绝不做 N+1。
 *
 * 数据来源均为权威记录：
 * - UndercoverRoomPlayer（userId + leftAt=null 的有效成员）
 * - Room（status / currentMatchId / passwordHash / roomCode）
 * - 仅当 Room 处于 PLAYING 时，才批量二次查询 currentMatch 的真实状态。
 *
 * 返回结果严格过滤敏感字段：
 * 不暴露 passwordHash / word / role / Match privateState。
 * 只告诉客户端 roomId / roomCode / status / canJoin / requiresPassword。
 */
export async function getUndercoverPresenceForUsers(userIds: string[]): Promise<Map<string, UndercoverPresence>> {
  const result = new Map<string, UndercoverPresence>()
  if (!userIds.length) return result

  // 查询 1：所有有效（未离开）且所在房间处于 WAITING/PLAYING 的成员关系。
  const memberships = await prisma.undercoverRoomPlayer.findMany({
    where: {
      userId: { in: userIds },
      leftAt: null,
      Room: { status: { in: ['WAITING', 'PLAYING'] } },
    },
    select: {
      userId: true,
      Room: {
        select: {
          id: true,
          status: true,
          currentMatchId: true,
          roomCode: true,
          passwordHash: true,
          UndercoverRoomPlayer: { where: { leftAt: null }, select: { id: true } },
        },
      },
    },
  })

  // 收集所有 PLAYING 房间指向的 currentMatchId，批量校验真实对局状态。
  const playingRooms = memberships.filter((membership) => membership.Room.status === 'PLAYING')
  const currentMatchIds = playingRooms
    .map((membership) => membership.Room.currentMatchId)
    .filter((id): id is string => Boolean(id))
  const matchStatusById = new Map<string, string>()
  if (currentMatchIds.length) {
    // 查询 2：批量确认 PLAYING 房间的真实 Match 状态。
    const matches = await prisma.undercoverMatch.findMany({
      where: { id: { in: currentMatchIds } },
      select: { id: true, status: true },
    })
    matches.forEach((match) => matchStatusById.set(match.id, match.status))
  }

  for (const membership of memberships) {
    const room = membership.Room
    const aliveCount = room.UndercoverRoomPlayer.length
    const requiresPassword = Boolean(room.passwordHash)

    if (room.status === 'PLAYING') {
      // 必须同时满足：currentMatchId 非空 且 对应 Match 真在 PLAYING。
      // 否则视为陈旧 PLAYING（Match 已结束/不存在），忽略 presence（不显示"游戏中"）。
      const currentMatchId = room.currentMatchId
      const currentMatchStatus = currentMatchId ? matchStatusById.get(currentMatchId) : undefined
      if (!currentMatchId || currentMatchStatus !== 'PLAYING') continue
      // 游戏中：仅展示状态，不允许中途加入。
      result.set(membership.userId, {
        status: 'PLAYING',
        roomId: room.id,
        roomCode: room.roomCode,
        canJoin: false,
        requiresPassword: false,
      })
      continue
    }

    // WAITING 且 currentMatchId 为空：房间中（可跟随进入的前提）。
    // 若 currentMatchId 非空（理论不该出现在 WAITING，但做防御）也忽略 presence。
    if (room.currentMatchId) continue
    const canJoin = aliveCount < UNDERCOVER_MAX_PLAYERS
    result.set(membership.userId, {
      status: 'WAITING',
      roomId: room.id,
      roomCode: room.roomCode,
      canJoin,
      requiresPassword,
    })
  }

  return result
}
