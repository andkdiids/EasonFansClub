import { createHash, randomBytes, randomInt } from 'node:crypto'
import bcrypt from 'bcryptjs'
import { Prisma, type GuessSongDuelFinishReason } from '@prisma/client'
import { getPublicUserDisplayName } from '@/lib/friend-remarks'
import { publicImageUrl } from '@/lib/images'
import { getShanghaiDayRange } from '@/lib/checkin'
import { awardRegistrationFee } from '@/lib/registration-fee'
import { syncUserAchievements } from '@/lib/achievements'
import { prisma } from '@/lib/prisma'
import {
  DUEL_ANSWER_SECONDS,
  DUEL_AUDIO_DELAY_MS,
  DUEL_AUDIO_DURATION_SECONDS,
  DUEL_COUNTDOWN_MS,
  DUEL_INVITE_RETENTION_MS,
  DUEL_MIN_VALID_QUESTIONS,
  DUEL_ONLINE_TIMEOUT_MS,
  DUEL_RECONNECT_GRACE_MS,
  DUEL_RESULT_PAUSE_MS,
  DUEL_TARGET_CORRECT,
  DUEL_WAITING_ROOM_TTL_MS,
  DUEL_WIN_REWARD,
  getDuelBaseQuestionCount,
  isDuelWaitingRoomExpired,
  isDuelPresenceOnline,
  normalizeDuelMode,
  normalizeDuelPassword,
  normalizeDuelRoomCode,
} from '@/lib/guess-song-duel-config'
import type {
  DuelMatchResult,
  DuelMatchState,
  DuelActiveState,
  DuelOption,
  DuelPublicUser,
  DuelQuestionResult,
  DuelQuestionState,
  DuelRoomState,
} from '@/lib/guess-song-duel-protocol'
import type { DuelMode } from '@/lib/guess-song-duel-config'
import { normalizeGuessSongAnswer } from '@/lib/guess-song-config'
import { getGuessSongQuizConfigOrDefault, GUESS_SONG_QUESTION_TYPE_AUTO, GUESS_SONG_QUESTION_TYPE_MANUAL } from '@/lib/guess-song-quiz-config'
import { createUUID } from '@/lib/utils/uuid'

const publicUserSelect = {
  id: true,
  uid: true,
  nickname: true,
  usernameModerationStatus: true,
  nicknameModerationStatus: true,
  avatarUrl: true,
  isOnline: true,
  Profile: { select: { displayName: true, displayNameModerationStatus: true, avatarUrl: true } },
} as const

const roomMemberInclude = {
  Host: { select: publicUserSelect },
  Challenger: { select: publicUserSelect },
} as const

const roomInclude = {
  ...roomMemberInclude,
  Match: { select: { id: true, status: true, startedAt: true } },
} as const

type RoomWithMembers = Prisma.GuessSongDuelRoomGetPayload<{ include: typeof roomInclude }>
type PublicUserRow = Prisma.UserGetPayload<{ select: typeof publicUserSelect }>

export type DuelRoomOperationResult = {
  room: DuelRoomState
  affectedRooms: DuelRoomState[]
}

export type DuelActiveStateResult = DuelActiveState & {
  affectedRooms: DuelRoomState[]
}

type DuelCandidate = {
  id: string
  songTitle: string
  albumTitle: string | null
  musicSongId: string | null
  correctAnswer: string
  wrongOption1: string
  wrongOption2: string
  wrongOption3: string
  GuessSongAudioVariant: Array<{ storagePath: string; durationSeconds: number }>
}

type StoredOption = DuelOption

type CompletionOutcome = {
  questionResult: DuelQuestionResult
  nextServerStartAt: string | null
  matchResult: DuelMatchResult | null
  syncUserIds: string[]
}

export class GuessSongDuelServiceError extends Error {
  constructor(
    message: string,
    readonly status = 400,
    readonly code = 'GUESS_SONG_DUEL_ERROR',
  ) {
    super(message)
    this.name = 'GuessSongDuelServiceError'
  }
}

function waitingRoomCutoff(now: Date) {
  return new Date(now.getTime() - DUEL_WAITING_ROOM_TTL_MS)
}

async function markExpiredDuelRoom(roomId: string, now: Date) {
  const result = await prisma.guessSongDuelRoom.updateMany({
    where: { id: roomId, status: { in: ['WAITING', 'READY'] }, createdAt: { lt: waitingRoomCutoff(now) } },
    data: { status: 'CLOSED', closedAt: now },
  })
  if (result.count) console.info('[duel.expire]', { roomId, count: result.count, at: now.toISOString() })
}

async function markExpiredWaitingDuelRooms(now: Date) {
  const result = await prisma.guessSongDuelRoom.updateMany({
    where: { status: { in: ['WAITING', 'READY'] }, createdAt: { lt: waitingRoomCutoff(now) } },
    data: { status: 'CLOSED', closedAt: now },
  })
  if (result.count) console.info('[duel.expire]', { count: result.count, at: now.toISOString() })
}

function isKnownPrismaError(error: unknown, code: string) {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === code
}

function hashToken(value: string) {
  return createHash('sha256').update(value).digest('hex')
}

function publicUser(user: PublicUserRow, isOnline = user.isOnline): DuelPublicUser {
  return {
    id: user.id,
    uid: user.uid,
    name: getPublicUserDisplayName(user),
    avatarUrl: publicImageUrl(user.Profile?.avatarUrl || user.avatarUrl),
    isOnline,
  }
}

function roomState(room: RoomWithMembers): DuelRoomState {
  const now = Date.now()
  return {
    id: room.id,
    roomCode: room.roomCode,
    mode: room.mode as DuelMode,
    hasPassword: Boolean(room.passwordHash),
    isPublic: room.isPublic,
    status: room.status,
    hostReady: room.hostReady,
    challengerReady: room.challengerReady,
    host: publicUser(room.Host, isDuelPresenceOnline(room.hostLastSeenAt, now)),
    challenger: room.Challenger ? publicUser(room.Challenger, isDuelPresenceOnline(room.challengerLastSeenAt, now)) : null,
    currentCount: room.challengerId ? 2 : 1,
    matchId: room.Match?.id || null,
  }
}

async function findRoom(roomId: string) {
  await markExpiredDuelRoom(roomId, new Date())
  const room = await prisma.guessSongDuelRoom.findUnique({ where: { id: roomId }, include: roomInclude })
  if (!room) throw new GuessSongDuelServiceError('对决房间不存在', 404, 'ROOM_NOT_FOUND')
  return room
}

async function findRoomForTransaction(tx: Prisma.TransactionClient, roomId: string) {
  const room = await tx.guessSongDuelRoom.findUnique({ where: { id: roomId }, include: roomInclude })
  if (!room) throw new GuessSongDuelServiceError('对决房间不存在', 404, 'ROOM_NOT_FOUND')
  if (isDuelWaitingRoomExpired(room.status, room.createdAt)) {
    throw new GuessSongDuelServiceError('Duel room expired', 410, 'ROOM_EXPIRED')
  }
  return room
}

type DuelRoomLifecycle = 'WAITING' | 'PLAYING' | 'FINISHED' | 'CLOSED'

export function getDuelRoomLifecycle(room: {
  status: string
  Match?: { status: string } | null
}): DuelRoomLifecycle {
  if (room.Match?.status === 'PLAYING' && room.status === 'PLAYING') return 'PLAYING'
  if (room.Match) return 'FINISHED'
  if (room.status === 'WAITING' || room.status === 'READY') return 'WAITING'
  if (room.status === 'FINISHED') return 'FINISHED'
  return 'CLOSED'
}

async function lockDuelUserTx(tx: Prisma.TransactionClient, userId: string) {
  await tx.$queryRaw`SELECT id FROM User WHERE id = ${userId} FOR UPDATE`
}

async function findAndLockDuelMembershipsTx(tx: Prisma.TransactionClient, userId: string) {
  const rows = await tx.$queryRaw<Array<{ id: string }>>`
    SELECT id
    FROM GuessSongDuelRoom
    WHERE (hostId = ${userId} OR challengerId = ${userId})
      AND status IN ('WAITING', 'READY', 'PLAYING')
    ORDER BY id
    FOR UPDATE
  `
  if (!rows.length) return [] as RoomWithMembers[]
  return tx.guessSongDuelRoom.findMany({
    where: { id: { in: rows.map((row) => row.id) } },
    include: roomInclude,
    orderBy: { id: 'asc' },
  })
}

function closedRoomState(room: RoomWithMembers, now: Date) {
  return roomState({
    ...room,
    status: 'CLOSED',
    closedAt: now,
    hostReady: false,
    challengerReady: false,
  })
}

type DuelActiveMembershipRecord = {
  userId: string
  matchId: string
  matchStatus: string
  room: {
    id: string
    status: string
    hostId: string
    challengerId: string | null
    matchId: string | null
    matchStatus: string | null
  } | null
}

export function isValidActiveDuelMembership(record: DuelActiveMembershipRecord, userId: string) {
  return record.userId === userId
    && record.matchStatus === 'PLAYING'
    && Boolean(record.room)
    && record.room?.status === 'PLAYING'
    && record.room.matchId === record.matchId
    && record.room.matchStatus === 'PLAYING'
    && (record.room.hostId === userId || record.room.challengerId === userId)
}

async function findDuelPlayerMatchesTx(tx: Prisma.TransactionClient, userId: string) {
  return tx.guessSongDuelPlayer.findMany({
    where: { userId, Match: { status: 'PLAYING' } },
    orderBy: { createdAt: 'desc' },
    include: {
      Match: {
        include: {
          Room: {
            select: {
              id: true,
              status: true,
              hostId: true,
              challengerId: true,
              Match: { select: { id: true, status: true } },
            },
          },
        },
      },
    },
  })
}

async function invalidateStaleDuelMatchTx(tx: Prisma.TransactionClient, matchId: string, roomId: string | null, now: Date) {
  const updated = await tx.guessSongDuelMatch.updateMany({
    where: { id: matchId, status: 'PLAYING' },
    data: {
      status: 'INVALID',
      finishReason: 'DISCONNECT_INVALID',
      finishedAt: now,
    },
  })
  if (roomId) {
    await tx.guessSongDuelRoom.updateMany({
      where: { id: roomId, status: { in: ['WAITING', 'READY', 'PLAYING', 'FINISHED'] } },
      data: { status: 'CLOSED', closedAt: now },
    })
  }
  return updated.count === 1
}

async function normalizeDuelPlayerMatchesTx(
  tx: Prisma.TransactionClient,
  userId: string,
  now: Date,
  options: { keepRoomId?: string; rejectPlaying: boolean },
) {
  const playerMatches = await findDuelPlayerMatchesTx(tx, userId)
  const activeMatches: Array<{ id: string; roomId: string; status: 'PLAYING' }> = []
  const affectedRoomIds = new Set<string>()

  for (const player of playerMatches) {
    if (player.Match.status !== 'PLAYING') continue
    const room = player.Match.Room
    const record: DuelActiveMembershipRecord = {
      userId: player.userId,
      matchId: player.matchId,
      matchStatus: player.Match.status,
      room: room
        ? {
            id: room.id,
            status: room.status,
            hostId: room.hostId,
            challengerId: room.challengerId,
            matchId: room.Match?.id || null,
            matchStatus: room.Match?.status || null,
          }
        : null,
    }
    const valid = isValidActiveDuelMembership(record, userId)
    if (valid && (options.keepRoomId === room?.id || !options.rejectPlaying)) {
      if (!activeMatches.some((match) => match.id === player.matchId)) {
        activeMatches.push({ id: player.matchId, roomId: room!.id, status: 'PLAYING' })
      }
      continue
    }
    if (valid && options.rejectPlaying) {
      throw new GuessSongDuelServiceError('你当前正在进行一场对决，请先结束当前比赛', 409, 'MATCH_ACTIVE')
    }

    await invalidateStaleDuelMatchTx(tx, player.matchId, room?.id || null, now)
    if (room) affectedRoomIds.add(room.id)
  }

  const affectedRooms = affectedRoomIds.size
    ? (await tx.guessSongDuelRoom.findMany({ where: { id: { in: [...affectedRoomIds] } }, include: roomInclude })).map((room) => roomState(room))
    : []
  return { activeMatch: activeMatches[0] || null, affectedRooms }
}

async function removeWaitingDuelMembershipTx(tx: Prisma.TransactionClient, membership: RoomWithMembers, userId: string, now: Date) {
  if (membership.hostId === userId) {
    const closed = closedRoomState(membership, now)
    await tx.guessSongDuelRoom.delete({ where: { id: membership.id } })
    return closed
  }
  if (membership.challengerId !== userId) return null
  const updated = await tx.guessSongDuelRoom.update({
    where: { id: membership.id },
    data: {
      challengerId: null,
      challengerReady: false,
      hostReady: false,
      status: 'WAITING',
    },
    include: roomInclude,
  })
  return roomState(updated)
}

async function cleanupDuelMembershipTx(
  tx: Prisma.TransactionClient,
  userId: string,
  now: Date,
  options: { keepRoomId?: string; rejectPlaying: boolean },
) {
  const normalizedMatches = await normalizeDuelPlayerMatchesTx(tx, userId, now, options)
  const memberships = await findAndLockDuelMembershipsTx(tx, userId)
  const affectedRooms: DuelRoomState[] = [...normalizedMatches.affectedRooms]

  for (const membership of memberships) {
    if (membership.id === options.keepRoomId && membership.Match?.status !== 'PLAYING') continue
    if (membership.Match?.status === 'PLAYING') {
      const isValidActiveMatch = normalizedMatches.activeMatch?.id === membership.Match.id
      if (membership.id === options.keepRoomId && isValidActiveMatch) continue
      if (isValidActiveMatch && options.rejectPlaying) {
        throw new GuessSongDuelServiceError('你当前正在进行一场对决，请先结束当前比赛', 409, 'MATCH_ACTIVE')
      }
      if (!isValidActiveMatch) {
        await invalidateStaleDuelMatchTx(tx, membership.Match.id, membership.id, now)
        affectedRooms.push(closedRoomState(membership, now))
      }
      continue
    }
    if (membership.Match) {
      // A historical or invalid match must never turn back into a joinable room.
      const closed = await tx.guessSongDuelRoom.update({
        where: { id: membership.id },
        data: { status: 'CLOSED', closedAt: now },
        include: roomInclude,
      })
      affectedRooms.push(roomState(closed))
      continue
    }
    if (!['WAITING', 'READY', 'PLAYING'].includes(membership.status)) continue
    if (membership.status === 'PLAYING') {
      const closed = closedRoomState(membership, now)
      await tx.guessSongDuelRoom.delete({ where: { id: membership.id } })
      affectedRooms.push(closed)
      continue
    }

    const affected = await removeWaitingDuelMembershipTx(tx, membership, userId, now)
    if (affected) affectedRooms.push(affected)
  }

  return affectedRooms
}

async function resolveDuelActiveStateTx(tx: Prisma.TransactionClient, userId: string, now: Date): Promise<DuelActiveStateResult> {
  const normalizedMatches = await normalizeDuelPlayerMatchesTx(tx, userId, now, { rejectPlaying: false })
  const memberships = await findAndLockDuelMembershipsTx(tx, userId)
  const affectedRooms: DuelRoomState[] = [...normalizedMatches.affectedRooms]
  const addAffectedRoom = (state: DuelRoomState) => {
    const index = affectedRooms.findIndex((room) => room.id === state.id)
    if (index >= 0) affectedRooms[index] = state
    else affectedRooms.push(state)
  }

  let activeRoom: DuelRoomState | null = null
  let activeMatch: DuelActiveState['activeMatch'] = normalizedMatches.activeMatch
  const waitingRooms: RoomWithMembers[] = []

  for (const membership of memberships) {
    if (membership.Match?.status === 'PLAYING' && membership.status === 'PLAYING' && membership.Match.id === activeMatch?.id) {
      activeRoom = roomState(membership)
      continue
    }
    if (membership.Match?.status === 'PLAYING') {
      // A PLAYING Match without a valid current room membership is stale. The
      // player-row normalizer normally handles this; this branch also covers a
      // room row that changed while the membership snapshot was being read.
      await invalidateStaleDuelMatchTx(tx, membership.Match.id, membership.id, now)
      addAffectedRoom(roomState({ ...membership, status: 'CLOSED', closedAt: now, hostReady: false, challengerReady: false }))
      continue
    }
    if (membership.Match) {
      const closed = await tx.guessSongDuelRoom.update({
        where: { id: membership.id },
        data: { status: 'CLOSED', closedAt: now },
        include: roomInclude,
      })
      addAffectedRoom(roomState(closed))
      continue
    }
    if (membership.status === 'PLAYING') {
      const closed = closedRoomState(membership, now)
      await tx.guessSongDuelRoom.delete({ where: { id: membership.id } })
      addAffectedRoom(closed)
      continue
    }
    if (!['WAITING', 'READY'].includes(membership.status)) continue
    if (isDuelWaitingRoomExpired(membership.status, membership.createdAt, now.getTime())) {
      const affected = await removeWaitingDuelMembershipTx(tx, membership, userId, now)
      if (affected) addAffectedRoom(affected)
      continue
    }
    waitingRooms.push(membership)
  }

  if (activeRoom || activeMatch) {
    // A valid PLAYING match is the only state that may block a new duel. Any
    // duplicate waiting memberships are stale and can be removed safely.
    for (const membership of waitingRooms) {
      const affected = await removeWaitingDuelMembershipTx(tx, membership, userId, now)
      if (affected) addAffectedRoom(affected)
    }
  } else if (waitingRooms.length) {
    // Keep the newest valid waiting room and normalize duplicate memberships.
    waitingRooms.sort((left, right) => {
      const createdDelta = right.createdAt.getTime() - left.createdAt.getTime()
      return createdDelta || right.id.localeCompare(left.id)
    })
    activeRoom = roomState(waitingRooms[0])
    for (const membership of waitingRooms.slice(1)) {
      const affected = await removeWaitingDuelMembershipTx(tx, membership, userId, now)
      if (affected) addAffectedRoom(affected)
    }
  }

  if (!activeRoom && activeMatch) {
    const room = await tx.guessSongDuelRoom.findUnique({ where: { id: activeMatch.roomId }, include: roomInclude })
    if (room && getDuelRoomLifecycle(room) === 'PLAYING') activeRoom = roomState(room)
  }
  if (!activeRoom) activeMatch = null

  return {
    activeRoom,
    activeMatch,
    isInActiveDuel: Boolean(activeRoom || activeMatch),
    affectedRooms,
  }
}

export async function resolveActiveDuelForUser(userId: string, now = new Date()): Promise<DuelActiveStateResult> {
  return prisma.$transaction(async (tx) => {
    await lockDuelUserTx(tx, userId)
    return resolveDuelActiveStateTx(tx, userId, now)
  })
}

export async function cleanupStaleDuelMembership(userId: string, now = new Date()) {
  const state = await resolveActiveDuelForUser(userId, now)
  return state.affectedRooms
}

function validatePassword(value: unknown) {
  const password = normalizeDuelPassword(value)
  if (password === null) throw new GuessSongDuelServiceError('房间密码只能使用 4～12 位英文或数字', 400, 'PASSWORD_INVALID')
  return password
}

function validateDuelMode(value: unknown): DuelMode {
  if (value === undefined || value === null || value === '') return 'SCORE'
  const mode = normalizeDuelMode(value)
  if (!mode) throw new GuessSongDuelServiceError('对决模式无效', 400, 'DUEL_MODE_INVALID')
  return mode
}

function shuffle<T>(items: readonly T[]) {
  const result = [...items]
  for (let index = result.length - 1; index > 0; index -= 1) {
    const target = randomInt(index + 1)
    ;[result[index], result[target]] = [result[target], result[index]]
  }
  return result
}

function buildOptions(candidate: DuelCandidate) {
  const labels = [candidate.correctAnswer, candidate.wrongOption1, candidate.wrongOption2, candidate.wrongOption3]
  const normalized = labels.map((item) => normalizeGuessSongAnswer(item))
  if (normalized.some((item) => !item) || new Set(normalized).size !== 4) return null
  const keys = ['A', 'B', 'C', 'D']
  const options = shuffle(labels).map((label, index) => ({ key: keys[index], label }))
  const correctOptionKey = options.find((option) => normalizeGuessSongAnswer(option.label) === normalized[0])?.key
  if (!correctOptionKey) return null
  return { options, correctOptionKey }
}

function parseOptions(value: Prisma.JsonValue): StoredOption[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return []
    const record = item as Record<string, unknown>
    return typeof record.key === 'string' && typeof record.label === 'string'
      ? [{ key: record.key, label: record.label }]
      : []
  })
}

function getOptionLabel(options: Prisma.JsonValue, key: string) {
  return parseOptions(options).find((option) => option.key === key)?.label || ''
}

function duelStateRevision(
  match: { updatedAt: Date; status: string },
  question: { createdAt: Date } | null,
  players: Array<{ updatedAt: Date }>,
) {
  const updatedAt = Math.max(
    match.updatedAt.getTime(),
    question?.createdAt.getTime() || 0,
    ...players.map((player) => player.updatedAt.getTime()),
  )
  // Keep status transitions above any in-flight PLAYING snapshot while still
  // allowing an answer/presence update in the same millisecond to advance.
  return updatedAt * 10 + (match.status === 'PLAYING' ? 1 : 9)
}

function questionTimes(startAt: Date) {
  const audioStartAt = new Date(startAt.getTime() + DUEL_AUDIO_DELAY_MS)
  const answerDeadlineAt = new Date(audioStartAt.getTime() + DUEL_ANSWER_SECONDS * 1000)
  return { serverStartedAt: startAt, audioStartAt, answerDeadlineAt }
}

function questionAudioUrl(matchId: string, publicToken: string) {
  return `/api/entertainment/guess-song/duel/matches/${encodeURIComponent(matchId)}/audio?questionId=${encodeURIComponent(publicToken)}`
}

function clampClientElapsed(value: unknown) {
  const number = typeof value === 'number' && Number.isFinite(value) ? Math.round(value) : null
  if (number === null) return null
  return Math.max(0, Math.min(60_000, number))
}

export function effectiveElapsedMs(receivedAt: Date, audioStartAt: Date, latencyEstimateMs: number) {
  const raw = Math.max(0, receivedAt.getTime() - audioStartAt.getTime())
  const compensation = Math.max(0, Math.min(1_500, Math.round(latencyEstimateMs)))
  return Math.max(0, Math.min(DUEL_ANSWER_SECONDS * 1000, raw - compensation))
}

function isSuspiciousAnswer(correct: boolean, effectiveMs: number, clientElapsedMs: number | null) {
  if (correct && effectiveMs <= 120) return true
  if (clientElapsedMs !== null && Math.abs(clientElapsedMs - effectiveMs) > 5_000) return true
  return false
}

export function compareDuelPlayers(players: Array<{ userId: string; correctCount: number; totalEffectiveAnswerMs: number }>) {
  if (players.length !== 2) return { winnerId: null, isDraw: true }
  const [left, right] = players
  if (left.correctCount !== right.correctCount) {
    return { winnerId: left.correctCount > right.correctCount ? left.userId : right.userId, isDraw: false }
  }
  return { winnerId: null, isDraw: true }
}

export function resolveBuzzerRound(answers: Array<{ userId: string; isCorrect: boolean }>) {
  const correct = answers.find((answer) => answer.isCorrect)
  if (correct) return { outcome: 'SCORED' as const, winnerId: correct.userId }
  if (answers.length >= 2) return { outcome: 'NO_SCORE' as const, winnerId: null }
  return { outcome: 'WAITING' as const, winnerId: null }
}

export function countDuelBaseCorrectAnswers(answers: Array<{ userId: string; isCorrect: boolean; isOvertime: boolean }>) {
  const counts = new Map<string, number>()
  for (const answer of answers) {
    if (!answer.isCorrect || answer.isOvertime) continue
    counts.set(answer.userId, (counts.get(answer.userId) || 0) + 1)
  }
  return counts
}

type DuelAnswerReader = Pick<Prisma.TransactionClient, 'guessSongDuelAnswer'>

async function loadDuelBaseCorrectCounts(db: DuelAnswerReader, matchId: string) {
  const answers = await db.guessSongDuelAnswer.findMany({
    where: { matchId },
    select: { userId: true, isCorrect: true, Question: { select: { isOvertime: true } } },
  })
  return countDuelBaseCorrectAnswers(answers.map((answer) => ({
    userId: answer.userId,
    isCorrect: answer.isCorrect,
    isOvertime: answer.Question.isOvertime,
  })))
}

async function serializeDuelResult(
  db: DuelAnswerReader,
  match: { id: string; mode: string; totalQuestions: number; status: string; finishReason: string | null; winnerId: string | null; isDraw: boolean; rewardAmount: number; startedAt: Date; finishedAt: Date | null },
  players: Array<{ slot: number; userId: string; correctCount: number; totalEffectiveAnswerMs: number; User: PublicUserRow }>,
): Promise<DuelMatchResult> {
  const mode = match.mode as DuelMode
  const baseTotalQuestions = getDuelBaseQuestionCount(mode)
  const baseCorrectCounts = await loadDuelBaseCorrectCounts(db, match.id)
  return {
    matchId: match.id,
    mode,
    baseTotalQuestions,
    status: match.status as DuelMatchResult['status'],
    finishReason: match.finishReason,
    winnerId: match.winnerId,
    isDraw: match.isDraw,
    rewardAmount: match.rewardAmount,
    startedAt: match.startedAt.toISOString(),
    finishedAt: match.finishedAt?.toISOString() || null,
    players: players.map((player) => ({
      userId: player.userId,
      slot: player.slot === 1 ? 1 : 2,
      name: getPublicUserDisplayName(player.User),
      avatarUrl: publicImageUrl(player.User.Profile?.avatarUrl || player.User.avatarUrl),
      correctCount: player.correctCount,
      baseCorrectCount: baseCorrectCounts.get(player.userId) || 0,
      accuracy: mode === 'SCORE'
        ? Math.round((baseCorrectCounts.get(player.userId) || 0) / baseTotalQuestions * 1000) / 10
        : Math.round(player.correctCount / baseTotalQuestions * 1000) / 10,
      totalEffectiveAnswerMs: player.totalEffectiveAnswerMs,
      averageAnswerMs: player.correctCount ? Math.round(player.totalEffectiveAnswerMs / player.correctCount) : null,
    })),
  }
}

async function loadMatchForState(db: Prisma.TransactionClient, matchId: string) {
  const match = await db.guessSongDuelMatch.findUnique({
    where: { id: matchId },
    include: {
      Room: { include: roomMemberInclude },
      GuessSongDuelPlayer: { orderBy: { slot: 'asc' }, include: { User: { select: publicUserSelect } } },
    },
  })
  if (!match) throw new GuessSongDuelServiceError('对决比赛不存在', 404, 'MATCH_NOT_FOUND')
  return match
}

async function loadQuestionState(db: Prisma.TransactionClient, matchId: string, questionIndex: number) {
  const [question, next, lastResolved] = await Promise.all([
    db.guessSongDuelQuestion.findUnique({ where: { matchId_questionIndex: { matchId, questionIndex } } }),
    db.guessSongDuelQuestion.findUnique({ where: { matchId_questionIndex: { matchId, questionIndex: questionIndex + 1 } }, select: { publicToken: true } }),
    db.guessSongDuelQuestion.findFirst({
      where: { matchId, questionIndex: { lt: questionIndex }, revealedAt: { not: null } },
      orderBy: { questionIndex: 'desc' },
    }),
  ])
  return { question, next, lastResolved }
}

async function loadQuestionResult(db: Prisma.TransactionClient, matchId: string, question: { questionIndex: number; isOvertime: boolean; overtimeIndex: number | null; optionsSnapshot: Prisma.JsonValue; correctOptionKey: string }) {
  const answers = await db.guessSongDuelAnswer.findMany({
    where: { matchId, Question: { questionIndex: question.questionIndex } },
    orderBy: { createdAt: 'asc' },
    select: { userId: true, selectedOptionKey: true, isCorrect: true, effectiveElapsedMs: true },
  })
  return {
    questionIndex: question.questionIndex,
    isOvertime: question.isOvertime,
    overtimeIndex: question.overtimeIndex,
    correctOptionKey: question.correctOptionKey,
    correctLabel: getOptionLabel(question.optionsSnapshot, question.correctOptionKey),
    answers: answers.map((answer) => ({
      userId: answer.userId,
      selectedOptionKey: answer.selectedOptionKey,
      correct: answer.isCorrect,
      effectiveElapsedMs: answer.effectiveElapsedMs,
    })),
  } satisfies DuelQuestionResult
}

export async function getDuelRoomState(roomId: string) {
  return roomState(await findRoom(roomId))
}

export async function listDuelRooms() {
  const now = new Date()
  const cutoff = waitingRoomCutoff(now)
  await markExpiredWaitingDuelRooms(now)
  const rooms = await prisma.guessSongDuelRoom.findMany({
    where: {
      isPublic: true,
      passwordHash: null,
      status: 'WAITING',
      challengerId: null,
      Match: null,
      createdAt: { gte: cutoff },
    },
    include: roomMemberInclude,
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: 30,
  })
  return rooms.map((room) => roomState({ ...room, Match: null } as RoomWithMembers))
}

export async function searchDuelRoom(roomCode: string) {
  const code = normalizeDuelRoomCode(roomCode)
  if (!code) throw new GuessSongDuelServiceError('请输入有效房间号', 400, 'ROOM_CODE_INVALID')
  const room = await prisma.guessSongDuelRoom.findUnique({ where: { roomCode: code }, include: roomInclude })
  if (room && isDuelWaitingRoomExpired(room.status, room.createdAt)) {
    await markExpiredDuelRoom(room.id, new Date())
    throw new GuessSongDuelServiceError('Duel room expired', 410, 'ROOM_EXPIRED')
  }
  if (!room || getDuelRoomLifecycle(room) !== 'WAITING') {
    throw new GuessSongDuelServiceError('没有找到可加入的对决房间', 404, 'ROOM_NOT_JOINABLE')
  }
  return roomState(room)
}

export async function createDuelRoom(userId: string, input: { roomCode?: unknown; password?: unknown; mode?: unknown }, now = new Date()): Promise<DuelRoomOperationResult> {
  if (input.roomCode !== undefined) throw new GuessSongDuelServiceError('房间号由服务端自动生成', 400, 'ROOM_CODE_SERVER_GENERATED')
  const password = validatePassword(input.password)
  const mode = validateDuelMode(input.mode)
  const passwordHash = password ? await bcrypt.hash(password, 10) : null
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const roomCode = String(randomInt(100_000, 1_000_000))
    try {
      const result = await prisma.$transaction(async (tx) => {
        await lockDuelUserTx(tx, userId)
        const affectedRooms = await cleanupDuelMembershipTx(tx, userId, now, { rejectPlaying: true })
        await tx.$queryRaw`SELECT id FROM GuessSongDuelRoom WHERE roomCode = ${roomCode} FOR UPDATE`
        const existing = await tx.guessSongDuelRoom.findUnique({
          where: { roomCode },
          select: { id: true, status: true, createdAt: true, Match: { select: { id: true } } },
        })
        if (existing) {
          const reusable = !existing.Match && (existing.status === 'CLOSED' || isDuelWaitingRoomExpired(existing.status, existing.createdAt, now.getTime()))
          if (!reusable) throw new GuessSongDuelServiceError('Duel room code already used', 409, 'ROOM_CODE_TAKEN')
          await tx.guessSongDuelRoom.delete({ where: { id: existing.id } })
        }
        const room = await tx.guessSongDuelRoom.create({
          data: {
            roomCode,
            mode,
            passwordHash,
            isPublic: !password,
            hostId: userId,
            hostLastSeenAt: now,
          },
          include: roomInclude,
        })
        return { room, affectedRooms }
      })
      const state = roomState(result.room)
      console.info('[duel.create]', { roomId: state.id, roomCode: state.roomCode, mode: state.mode, hostId: userId, status: state.status })
      return { room: state, affectedRooms: result.affectedRooms }
    } catch (error) {
      if (isKnownPrismaError(error, 'P2002')) continue
      throw error
    }
  }
  throw new GuessSongDuelServiceError('暂时无法生成房间号，请重试', 503, 'ROOM_CODE_UNAVAILABLE')
}

function splitInviteToken(value: unknown) {
  if (typeof value !== 'string') return null
  const separator = value.indexOf('.')
  if (separator <= 0 || separator === value.length - 1) return null
  return { id: value.slice(0, separator), raw: value.slice(separator + 1) }
}

async function acceptInviteInTransaction(tx: Prisma.TransactionClient, userId: string, roomId: string, inviteToken: unknown, now: Date) {
  const token = splitInviteToken(inviteToken)
  if (!token) return null
  const invite = await tx.guessSongDuelInvite.findFirst({
    where: { id: token.id, tokenHash: hashToken(token.raw), roomId, inviteeId: userId, acceptedAt: null, expiresAt: { gt: now } },
    select: { id: true },
  })
  return invite?.id || null
}

export async function joinDuelRoom(userId: string, roomId: string, input: { password?: unknown; inviteToken?: unknown }, now = new Date()): Promise<DuelRoomOperationResult> {
  const password = validatePassword(input.password)
  await markExpiredDuelRoom(roomId, now)
  const result = await prisma.$transaction(async (tx) => {
    await lockDuelUserTx(tx, userId)
    await tx.$queryRaw`SELECT id FROM GuessSongDuelRoom WHERE id = ${roomId} FOR UPDATE`
    const current = await findRoomForTransaction(tx, roomId)
    if (getDuelRoomLifecycle(current) !== 'WAITING') throw new GuessSongDuelServiceError('该对决房间已经开始或已关闭', 409, 'ROOM_NOT_JOINABLE')
    if (current.hostId === userId || current.challengerId === userId) {
      const affectedRooms = await cleanupDuelMembershipTx(tx, userId, now, { keepRoomId: roomId, rejectPlaying: true })
      const room = await tx.guessSongDuelRoom.update({
        where: { id: roomId },
        data: current.hostId === userId ? { hostLastSeenAt: now } : { challengerLastSeenAt: now },
        include: roomInclude,
      })
      return { room, affectedRooms }
    }
    if (current.challengerId) throw new GuessSongDuelServiceError('房间已满', 409, 'ROOM_FULL')

    const inviteId = await acceptInviteInTransaction(tx, userId, roomId, input.inviteToken, now)
    if (current.passwordHash && !inviteId) {
      if (!password || !(await bcrypt.compare(password, current.passwordHash))) {
        throw new GuessSongDuelServiceError('房间密码错误', 403, 'ROOM_PASSWORD_WRONG')
      }
    }
    if (inviteId) await tx.guessSongDuelInvite.update({ where: { id: inviteId }, data: { acceptedAt: now } })
    const affectedRooms = await cleanupDuelMembershipTx(tx, userId, now, { keepRoomId: roomId, rejectPlaying: true })
    const room = await tx.guessSongDuelRoom.update({
      where: { id: roomId },
      data: { challengerId: userId, challengerLastSeenAt: now, status: 'READY', challengerReady: false },
      include: roomInclude,
    })
    return { room, affectedRooms }
  })
  const state = roomState(result.room)
  console.info('[duel.join]', { roomId: state.id, roomCode: state.roomCode, hostId: state.host.id, guestId: state.challenger?.id || null, status: state.status })
  return { room: state, affectedRooms: result.affectedRooms }
}

export async function acceptDuelInvite(userId: string, inviteToken: unknown, now = new Date()) {
  const token = splitInviteToken(inviteToken)
  if (!token) throw new GuessSongDuelServiceError('对决邀请无效或已过期', 400, 'INVITE_INVALID')
  const invite = await prisma.guessSongDuelInvite.findFirst({
    where: { id: token.id, tokenHash: hashToken(token.raw), inviteeId: userId, acceptedAt: null, expiresAt: { gt: now } },
    select: { roomId: true },
  })
  if (!invite) throw new GuessSongDuelServiceError('对决邀请无效或已过期', 410, 'INVITE_EXPIRED')
  return joinDuelRoom(userId, invite.roomId, { inviteToken }, now)
}

export async function enterDuelRoom(userId: string, roomId: string, now = new Date()): Promise<DuelRoomOperationResult> {
  await markExpiredDuelRoom(roomId, now)
  const result = await prisma.$transaction(async (tx) => {
    await lockDuelUserTx(tx, userId)
    await tx.$queryRaw`SELECT id FROM GuessSongDuelRoom WHERE id = ${roomId} FOR UPDATE`
    const current = await findRoomForTransaction(tx, roomId)
    if (current.hostId !== userId && current.challengerId !== userId) {
      throw new GuessSongDuelServiceError('你不在这个对决房间内', 403, 'ROOM_NOT_MEMBER')
    }
    if ((getDuelRoomLifecycle(current) === 'FINISHED' || getDuelRoomLifecycle(current) === 'CLOSED') && !current.Match) {
      throw new GuessSongDuelServiceError('该对决房间已经结束或关闭', 410, 'ROOM_NOT_JOINABLE')
    }
    if (current.Match && current.Match.status !== 'PLAYING') {
      const affectedRooms = await cleanupDuelMembershipTx(tx, userId, now, { keepRoomId: roomId, rejectPlaying: true })
      return { room: current, affectedRooms }
    }
    const affectedRooms = await cleanupDuelMembershipTx(tx, userId, now, { keepRoomId: roomId, rejectPlaying: true })
    const room = await tx.guessSongDuelRoom.update({
      where: { id: roomId },
      data: current.hostId === userId ? { hostLastSeenAt: now } : { challengerLastSeenAt: now },
      include: roomInclude,
    })
    return { room, affectedRooms }
  })
  return { room: roomState(result.room), affectedRooms: result.affectedRooms }
}

export async function setDuelRoomReady(userId: string, roomId: string, ready: boolean, now = new Date()) {
  await markExpiredDuelRoom(roomId, now)
  const room = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM GuessSongDuelRoom WHERE id = ${roomId} FOR UPDATE`
    const current = await findRoomForTransaction(tx, roomId)
    if (current.hostId !== userId && current.challengerId !== userId) throw new GuessSongDuelServiceError('你不在这个对决房间内', 403, 'ROOM_NOT_MEMBER')
    if (!['WAITING', 'READY'].includes(current.status)) throw new GuessSongDuelServiceError('房间已经开始或已关闭', 409, 'ROOM_NOT_EDITABLE')
    const data = current.hostId === userId
      ? { hostReady: ready, hostLastSeenAt: now }
      : { challengerReady: ready, challengerLastSeenAt: now }
    return tx.guessSongDuelRoom.update({ where: { id: roomId }, data, include: roomInclude })
  })
  const state = roomState(room)
  console.info('[duel.ready]', { roomId: state.id, roomCode: state.roomCode, userId, ready, hostReady: state.hostReady, guestReady: state.challengerReady, status: state.status })
  return state
}

export async function touchDuelRoomPresence(userId: string, roomId: string, now = new Date()) {
  await markExpiredDuelRoom(roomId, now)
  const room = await prisma.guessSongDuelRoom.findUnique({
    where: { id: roomId },
    select: { hostId: true, challengerId: true, status: true },
  })
  if (!room || !['WAITING', 'READY', 'PLAYING'].includes(room.status)) return false
  const data = room.hostId === userId
    ? { hostLastSeenAt: now }
    : room.challengerId === userId
      ? { challengerLastSeenAt: now }
      : null
  if (!data) return false
  const updated = await prisma.guessSongDuelRoom.updateMany({ where: { id: roomId }, data })
  if (process.env.NODE_ENV !== 'production') {
    console.debug('[guess-song-duel.heartbeat]', { roomId, userId, at: now.toISOString() })
  }
  return updated.count === 1
}

export async function leaveDuelRoom(userId: string, roomId: string, now = new Date()) {
  await markExpiredDuelRoom(roomId, now)
  const room = await prisma.$transaction(async (tx) => {
    await lockDuelUserTx(tx, userId)
    await tx.$queryRaw`SELECT id FROM GuessSongDuelRoom WHERE id = ${roomId} FOR UPDATE`
    const current = await findRoomForTransaction(tx, roomId)
    const isMember = current.hostId === userId || current.challengerId === userId
    if (!isMember) throw new GuessSongDuelServiceError('你不在这个对决房间内', 403, 'ROOM_NOT_MEMBER')
    const player = current.Match?.status === 'PLAYING'
      ? await tx.guessSongDuelPlayer.findUnique({
          where: { matchId_userId: { matchId: current.Match.id, userId } },
          select: { id: true },
        })
      : null
    if (current.Match?.status === 'PLAYING' && getDuelRoomLifecycle(current) === 'PLAYING' && player) {
      throw new GuessSongDuelServiceError('比赛进行中，请使用退出比赛', 409, 'MATCH_ACTIVE')
    }
    if (current.Match?.status === 'PLAYING') {
      await invalidateStaleDuelMatchTx(tx, current.Match.id, current.id, now)
      const closed = await tx.guessSongDuelRoom.update({
        where: { id: roomId },
        data: { status: 'CLOSED', closedAt: now, hostReady: false, challengerReady: false },
        include: roomInclude,
      })
      return roomState(closed)
    }
    if (current.Match) {
      const updated = await tx.guessSongDuelRoom.update({ where: { id: roomId }, data: { status: 'CLOSED', closedAt: now }, include: roomInclude })
      return roomState(updated)
    }
    if (current.hostId === userId) {
      const closed = closedRoomState(current, now)
      if (!current.Match) {
        await tx.guessSongDuelRoom.delete({ where: { id: roomId } })
        return closed
      }
      const updated = await tx.guessSongDuelRoom.update({ where: { id: roomId }, data: { status: 'CLOSED', closedAt: now }, include: roomInclude })
      return roomState(updated)
    }
    if (current.challengerId !== userId) throw new GuessSongDuelServiceError('你不在这个对决房间内', 403, 'ROOM_NOT_MEMBER')
    const updated = await tx.guessSongDuelRoom.update({
      where: { id: roomId },
      data: { challengerId: null, hostReady: false, challengerReady: false, status: 'WAITING' },
      include: roomInclude,
    })
    return roomState(updated)
  })
  return room
}

export async function createDuelInvite(userId: string, roomId: string, inviteeId: string, now = new Date()) {
  const token = randomBytes(32).toString('base64url')
  await markExpiredDuelRoom(roomId, now)
  const room = await prisma.guessSongDuelRoom.findUnique({ where: { id: roomId }, select: { hostId: true, challengerId: true, status: true, roomCode: true, mode: true } })
  if (!room || !['WAITING', 'READY'].includes(room.status)) throw new GuessSongDuelServiceError('房间已经开始或已关闭', 409, 'ROOM_NOT_INVITABLE')
  if (room.hostId !== userId && room.challengerId !== userId) throw new GuessSongDuelServiceError('你不在这个对决房间内', 403, 'ROOM_NOT_MEMBER')
  if (inviteeId === userId) throw new GuessSongDuelServiceError('不能邀请自己', 400, 'INVITEE_INVALID')

  const [friendship, invitee, inviter] = await Promise.all([
    prisma.friendship.findFirst({ where: { OR: [{ userAId: userId, userBId: inviteeId }, { userAId: inviteeId, userBId: userId }] }, select: { id: true } }),
    prisma.user.findFirst({ where: { id: inviteeId, status: 'ACTIVE', isDeleted: false }, select: { id: true } }),
    prisma.user.findUnique({ where: { id: userId }, select: publicUserSelect }),
  ])
  if (!friendship || !invitee) throw new GuessSongDuelServiceError('只能邀请当前好友列表中的用户', 403, 'INVITEE_NOT_FRIEND')
  const inviterName = inviter ? getPublicUserDisplayName(inviter) : '好友'

  const result = await prisma.$transaction(async (tx) => {
    await tx.guessSongDuelInvite.updateMany({
      where: { roomId, inviteeId, acceptedAt: null },
      data: { acceptedAt: now },
    })
    const invite = await tx.guessSongDuelInvite.create({
      data: {
        tokenHash: hashToken(token),
        expiresAt: new Date(now.getTime() + DUEL_INVITE_RETENTION_MS),
        roomId,
        inviterId: userId,
        inviteeId,
      },
      select: { id: true },
    })
    await tx.notification.create({
      data: {
        recipientId: inviteeId,
        actorId: userId,
        type: 'GUESS_SONG_DUEL_INVITE',
        title: `听听 · ${room.mode === 'BUZZER' ? '抢答模式' : '比分模式'}邀请`,
        content: `${inviterName} 邀请你进行「听听 · ${room.mode === 'BUZZER' ? '抢答模式' : '比分模式'}」，房间：${room.roomCode}`,
        link: `/games/guess-song/duel?invite=${encodeURIComponent(`${invite.id}.${token}`)}`,
        key: `guess-song-duel-invite:${invite.id}`,
      },
    })
    return invite
  })
  return { id: result.id, roomCode: room.roomCode }
}

async function getEligibleDuelCandidates(tx: Prisma.TransactionClient, autoEnabled: boolean) {
  const where: Prisma.GuessSongQuestionWhereInput = {
    enabled: true,
    processingStatus: 'READY',
    OR: [
      { questionType: GUESS_SONG_QUESTION_TYPE_MANUAL, difficulty: { in: ['EASY', 'ADVANCED', 'HARD'] } },
      ...(autoEnabled ? [{ questionType: GUESS_SONG_QUESTION_TYPE_AUTO, MusicSong: { MusicAlbum: { status: 'PUBLISHED' } } } as Prisma.GuessSongQuestionWhereInput] : []),
    ],
    GuessSongAudioVariant: { some: { durationSeconds: { in: [DUEL_AUDIO_DURATION_SECONDS, 5, 3] }, purpose: 'GAME' } },
  }
  const candidates = await tx.guessSongQuestion.findMany({
    where,
    select: {
      id: true,
      songTitle: true,
      albumTitle: true,
      musicSongId: true,
      correctAnswer: true,
      wrongOption1: true,
      wrongOption2: true,
      wrongOption3: true,
      GuessSongAudioVariant: { where: { durationSeconds: { in: [DUEL_AUDIO_DURATION_SECONDS, 5, 3] }, purpose: 'GAME' }, orderBy: { durationSeconds: 'desc' }, select: { storagePath: true, durationSeconds: true } },
    },
  })
  const unique = new Map<string, DuelCandidate>()
  for (const candidate of candidates) {
    const options = buildOptions(candidate)
    if (!options || !candidate.GuessSongAudioVariant[0]) continue
    const identity = candidate.musicSongId || normalizeGuessSongAnswer(candidate.songTitle)
    if (!identity || unique.has(identity)) continue
    unique.set(identity, candidate)
  }
  return [...unique.values()]
}

function buildStoredDuelQuestion(
  candidate: DuelCandidate,
  questionIndex: number,
  options: { times?: ReturnType<typeof questionTimes>; isOvertime?: boolean; overtimeIndex?: number | null } = {},
) {
  const built = buildOptions(candidate)
  if (!built) throw new GuessSongDuelServiceError('题库存在无效四选一数据，请联系管理员', 409, 'QUESTION_OPTIONS_INVALID')
  return {
    publicToken: createUUID(),
    questionIndex,
    isOvertime: options.isOvertime === true,
    overtimeIndex: options.isOvertime === true ? options.overtimeIndex || null : null,
    optionsSnapshot: built.options,
    correctOptionKey: built.correctOptionKey,
    songTitle: candidate.songTitle,
    albumTitle: candidate.albumTitle,
    audioStoragePath: candidate.GuessSongAudioVariant[0].storagePath,
    audioDurationSeconds: candidate.GuessSongAudioVariant[0].durationSeconds,
    ...(options.times || {}),
    sourceQuestionId: candidate.id,
  }
}

export async function startDuelMatch(userId: string, roomId: string, now = new Date()) {
  await markExpiredDuelRoom(roomId, now)
  const result = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM GuessSongDuelRoom WHERE id = ${roomId} FOR UPDATE`
    const room = await findRoomForTransaction(tx, roomId)
    if (room.status === 'PLAYING' && room.hostId === userId) {
      if (room.Match?.id && room.Match.status === 'PLAYING') {
        return {
          matchId: room.Match.id,
          serverStartAt: new Date(room.Match.startedAt.getTime() + DUEL_COUNTDOWN_MS).toISOString(),
          reused: true,
          statusBefore: room.status,
          hostId: room.hostId,
          guestId: room.challengerId,
          questionCount: getDuelBaseQuestionCount(room.mode as DuelMode),
        }
      }
      throw new GuessSongDuelServiceError('Duel room is already in progress', 409, 'ROOM_NOT_STARTABLE')
    }
    if (room.hostId !== userId) throw new GuessSongDuelServiceError('只有房主可以开始游戏', 403, 'HOST_ONLY')
    if (room.Match) throw new GuessSongDuelServiceError('该房间已经有历史对决记录，不能重新开始', 409, 'ROOM_NOT_STARTABLE')
    if (!room.challengerId) throw new GuessSongDuelServiceError('需要两名玩家才能开始', 409, 'TWO_PLAYERS_REQUIRED')
    if (!room.hostReady || !room.challengerReady) throw new GuessSongDuelServiceError('双方都准备后才能开始', 409, 'PLAYERS_NOT_READY')
    if (!['WAITING', 'READY'].includes(room.status)) throw new GuessSongDuelServiceError('房间已经开始或已关闭', 409, 'ROOM_NOT_STARTABLE')

    // Starting the match is itself a presence signal for the host. Re-read the
    // locked room after refreshing that signal so the guest is checked against
    // the latest database heartbeat, never against a client snapshot or stale
    // in-process WebSocket membership.
    const latestRoom = await tx.guessSongDuelRoom.update({
      where: { id: roomId },
      data: { hostLastSeenAt: now },
      include: roomInclude,
    })
    const hostOnline = isDuelPresenceOnline(latestRoom.hostLastSeenAt, now.getTime())
    const guestOnline = Boolean(latestRoom.challengerId && isDuelPresenceOnline(latestRoom.challengerLastSeenAt, now.getTime()))
    console.info('[guess-song-duel.start]', {
      roomId,
      hostId: latestRoom.hostId,
      guestId: latestRoom.challengerId,
      hostReady: latestRoom.hostReady,
      guestReady: latestRoom.challengerReady,
      hostLastSeenAt: latestRoom.hostLastSeenAt?.toISOString() || null,
      guestLastSeenAt: latestRoom.challengerLastSeenAt?.toISOString() || null,
      hostOnline,
      guestOnline,
      onlineTimeoutMs: DUEL_ONLINE_TIMEOUT_MS,
      now: now.toISOString(),
    })
    if (!hostOnline || !guestOnline) {
      throw new GuessSongDuelServiceError('对方当前不在线，请等待对方重新进入房间。', 409, 'PLAYERS_NOT_ONLINE')
    }

    for (const participantId of [room.hostId, room.challengerId]) {
      const activeState = await normalizeDuelPlayerMatchesTx(tx, participantId, now, { rejectPlaying: false })
      if (activeState.activeMatch) throw new GuessSongDuelServiceError('有玩家已经在另一场对决中', 409, 'PLAYER_MATCH_ACTIVE')
    }

    const quizConfig = await getGuessSongQuizConfigOrDefault()
    const mode = room.mode as DuelMode
    const totalQuestions = getDuelBaseQuestionCount(mode)
    const candidates = await getEligibleDuelCandidates(tx, quizConfig.enabled)
    if (candidates.length < totalQuestions) {
      throw new GuessSongDuelServiceError(`当前可用曲库不足 ${totalQuestions} 首，暂时无法开始对决`, 409, 'QUESTION_POOL_TOO_SMALL')
    }
    const selected = shuffle(candidates).slice(0, totalQuestions)
    const firstStartAt = new Date(now.getTime() + DUEL_COUNTDOWN_MS)
    const firstTimes = questionTimes(firstStartAt)
    const questions = selected.map((candidate, index) => buildStoredDuelQuestion(candidate, index + 1, { times: index === 0 ? firstTimes : undefined }))
    const match = await tx.guessSongDuelMatch.create({
      data: {
        roomId,
        mode,
        startedAt: now,
        currentQuestionIndex: 1,
        totalQuestions,
        GuessSongDuelPlayer: {
          create: [
            { slot: 1, userId: room.hostId, isOnline: true, lastSeenAt: now },
            { slot: 2, userId: room.challengerId, isOnline: true, lastSeenAt: now },
          ],
        },
        GuessSongDuelQuestion: { create: questions },
      },
      select: { id: true },
    })
    await tx.guessSongDuelRoom.update({ where: { id: roomId }, data: { status: 'PLAYING' } })
    return {
      matchId: match.id,
      serverStartAt: firstStartAt.toISOString(),
      reused: false,
      statusBefore: room.status,
      hostId: room.hostId,
      guestId: room.challengerId,
      questionCount: questions.length,
    }
  })
  console.info('[duel.start]', {
    roomId,
    hostId: result.hostId,
    guestId: result.guestId,
    statusBefore: result.statusBefore,
    statusAfter: 'PLAYING',
    gameId: result.matchId,
    questionCount: result.questionCount,
    startedAt: now.toISOString(),
    reused: result.reused,
  })
  return result
}

export async function getDuelMatchParticipantId(matchId: string) {
  const player = await prisma.guessSongDuelPlayer.findFirst({
    where: { matchId },
    orderBy: { slot: 'asc' },
    select: { userId: true },
  })
  return player?.userId || null
}

export async function getDuelMatchState(userId: string, matchId: string, now = new Date()): Promise<DuelMatchState> {
  return prisma.$transaction(async (tx) => {
    const match = await loadMatchForState(tx, matchId)
    if (!match.GuessSongDuelPlayer.some((player) => player.userId === userId)) throw new GuessSongDuelServiceError('你不在这场对决中', 403, 'MATCH_NOT_MEMBER')
    const { question, next, lastResolved } = await loadQuestionState(tx, matchId, match.currentQuestionIndex)
    const answers = question
      ? await tx.guessSongDuelAnswer.findMany({
          where: { matchId, questionId: question.id },
          orderBy: { createdAt: 'asc' },
          select: { userId: true, selectedOptionKey: true, isCorrect: true, effectiveElapsedMs: true },
        })
      : []
    const answerByUser = new Map(answers.map((answer) => [answer.userId, answer]))
    const revealCorrectness = match.mode === 'BUZZER' || Boolean(question?.revealedAt) || match.status !== 'PLAYING'
    const players = match.GuessSongDuelPlayer.map((player) => {
      const answer = answerByUser.get(player.userId)
      return {
        ...publicUser(player.User),
        userId: player.userId,
        isOnline: player.isOnline && isDuelPresenceOnline(player.lastSeenAt, now.getTime()),
        slot: player.slot === 1 ? 1 as const : 2 as const,
        correctCount: player.correctCount,
        totalEffectiveAnswerMs: player.totalEffectiveAnswerMs,
        submitted: Boolean(answer),
        selectedOptionKey: answer?.selectedOptionKey || null,
        answerCorrect: answer && revealCorrectness ? answer.isCorrect : null,
        suspicious: player.suspicious,
      }
    })
    const activeQuestion = match.status === 'PLAYING' && question && question.serverStartedAt && question.audioStartAt && question.answerDeadlineAt
      ? {
          matchId,
          id: question.id,
          roundId: question.id,
          publicToken: question.publicToken,
          questionId: question.publicToken,
          questionIndex: question.questionIndex,
          isOvertime: question.isOvertime,
          overtimeIndex: question.overtimeIndex,
          options: parseOptions(question.optionsSnapshot),
          audioDurationSeconds: question.audioDurationSeconds,
          serverStartedAt: question.serverStartedAt.toISOString(),
          audioStartAt: question.audioStartAt.toISOString(),
          answerDeadlineAt: question.answerDeadlineAt.toISOString(),
          audioUrl: questionAudioUrl(matchId, question.publicToken),
          preloadAudioUrl: next ? questionAudioUrl(matchId, next.publicToken) : null,
        } satisfies DuelQuestionState
      : null
    const questionResult = question && (Boolean(question.revealedAt) || match.status !== 'PLAYING')
      ? await loadQuestionResult(tx, matchId, question)
      : null
    const lastQuestionResult = lastResolved && !question?.revealedAt
      ? await loadQuestionResult(tx, matchId, lastResolved)
      : null
    const result = match.status !== 'PLAYING'
      ? await serializeDuelResult(tx, match, match.GuessSongDuelPlayer)
      : null
    const phase = match.status === 'PLAYING'
      ? (question?.serverStartedAt && question.serverStartedAt > now ? 'STARTING' : 'PLAYING')
      : match.status
    const revision = duelStateRevision(match, question, match.GuessSongDuelPlayer)
    return {
      matchId: match.id,
      roomId: match.Room.id,
      mode: match.mode as DuelMode,
      revision,
      status: match.status,
      phase,
      currentQuestionIndex: match.currentQuestionIndex,
      totalQuestions: match.totalQuestions,
      completedQuestionCount: match.completedQuestionCount,
      roundId: activeQuestion?.roundId || question?.id || null,
      questionId: activeQuestion?.questionId || question?.publicToken || null,
      questionToken: activeQuestion?.publicToken || question?.publicToken || null,
      serverNow: now.toISOString(),
      players,
      answers: players.map((player) => ({
        userId: player.userId,
        selectedOptionKey: player.selectedOptionKey,
        submitted: player.submitted,
        isCorrect: player.answerCorrect,
      })),
      question: activeQuestion,
      questionResult,
      lastQuestionResult,
      result,
    }
  })
}

export async function getDuelAudioSource(userId: string, matchId: string, publicToken: string) {
  const match = await prisma.guessSongDuelMatch.findUnique({
    where: { id: matchId },
    select: { status: true, currentQuestionIndex: true, GuessSongDuelPlayer: { where: { userId }, select: { id: true } } },
  })
  if (!match || !match.GuessSongDuelPlayer.length) throw new GuessSongDuelServiceError('你不在这场对决中', 403, 'MATCH_NOT_MEMBER')
  if (match.status !== 'PLAYING') throw new GuessSongDuelServiceError('比赛已经结束', 410, 'MATCH_FINISHED')
  const question = await prisma.guessSongDuelQuestion.findUnique({ where: { publicToken } })
  if (!question || question.matchId !== matchId || question.questionIndex < match.currentQuestionIndex || question.questionIndex > match.currentQuestionIndex + 1) {
    throw new GuessSongDuelServiceError('音频资源当前不可用', 404, 'AUDIO_NOT_AVAILABLE')
  }
  return { storagePath: question.audioStoragePath }
}

async function settleMatchTx(
  tx: Prisma.TransactionClient,
  matchId: string,
  input: { finishReason: GuessSongDuelFinishReason; winnerId: string | null; isDraw: boolean; valid: boolean; now: Date },
) {
  const match = await tx.guessSongDuelMatch.findUnique({ where: { id: matchId } })
  if (!match) throw new GuessSongDuelServiceError('对决比赛不存在', 404, 'MATCH_NOT_FOUND')
  if (match.status !== 'PLAYING') return { match, userIds: [] as string[], newlySettled: false }
  const players = await tx.guessSongDuelPlayer.findMany({ where: { matchId }, orderBy: { slot: 'asc' }, include: { User: { select: publicUserSelect } } })
  const userIds = players.map((player) => player.userId).sort()
  for (const userId of userIds) await tx.$queryRaw`SELECT id FROM User WHERE id = ${userId} FOR UPDATE`

  let rewardAmount = 0
  if (input.valid) {
    for (const player of players) {
      await tx.guessSongDuelStats.upsert({
        where: { userId: player.userId },
        update: { participations: { increment: 1 }, ...(input.winnerId === player.userId ? { wins: { increment: 1 } } : {}) },
        create: { userId: player.userId, participations: 1, wins: input.winnerId === player.userId ? 1 : 0 },
      })
    }
    if (input.winnerId) {
      const { dateKey } = getShanghaiDayRange(input.now)
      const reward = await awardRegistrationFee(tx, {
        userId: input.winnerId,
        requestedAmount: DUEL_WIN_REWARD,
        action: 'GUESS_SONG_DUEL_WIN',
        reason: '听听·对决获胜奖励',
        businessKey: `guess-song-duel-reward:${input.winnerId}:${dateKey}`,
        now: input.now,
      })
      rewardAmount = reward.awardedAmount
    }
  }
  const updated = await tx.guessSongDuelMatch.update({
    where: { id: matchId },
    data: {
      status: input.valid ? 'FINISHED' : 'INVALID',
      finishReason: input.finishReason,
      winnerId: input.winnerId,
      isDraw: input.isDraw,
      finishedAt: input.now,
      rewardAmount,
    },
  })
  await tx.guessSongDuelRoom.update({ where: { id: match.roomId }, data: { status: 'FINISHED', closedAt: input.now } })
  return { match: updated, userIds, newlySettled: true }
}

async function resultForTransaction(tx: Prisma.TransactionClient, matchId: string) {
  const [match, players] = await Promise.all([
    tx.guessSongDuelMatch.findUniqueOrThrow({ where: { id: matchId } }),
    tx.guessSongDuelPlayer.findMany({ where: { matchId }, orderBy: { slot: 'asc' }, include: { User: { select: publicUserSelect } } }),
  ])
  return serializeDuelResult(tx, match, players)
}

function buildQuestionResult(
  question: { questionIndex: number; isOvertime: boolean; overtimeIndex: number | null; optionsSnapshot: Prisma.JsonValue; correctOptionKey: string },
  answers: Array<{ userId: string; selectedOptionKey: string | null; isCorrect: boolean; effectiveElapsedMs: number | null }>,
): DuelQuestionResult {
  return {
    questionIndex: question.questionIndex,
    isOvertime: question.isOvertime,
    overtimeIndex: question.overtimeIndex,
    correctOptionKey: question.correctOptionKey,
    correctLabel: getOptionLabel(question.optionsSnapshot, question.correctOptionKey),
    answers: answers.map((answer) => ({
      userId: answer.userId,
      selectedOptionKey: answer.selectedOptionKey,
      correct: answer.isCorrect,
      effectiveElapsedMs: answer.effectiveElapsedMs,
    })),
  }
}

async function createDuelOvertimeQuestionTx(
  tx: Prisma.TransactionClient,
  match: { id: string; totalQuestions: number },
  questionIndex: number,
  now: Date,
) {
  const quizConfig = await getGuessSongQuizConfigOrDefault()
  const candidates = await getEligibleDuelCandidates(tx, quizConfig.enabled)
  const usedRows = await tx.guessSongDuelQuestion.findMany({ where: { matchId: match.id }, select: { sourceQuestionId: true } })
  const usedIds = new Set(usedRows.map((row) => row.sourceQuestionId).filter((id): id is string => Boolean(id)))
  const candidate = shuffle(candidates.filter((item) => !usedIds.has(item.id)))[0] || shuffle(candidates)[0]
  if (!candidate) throw new GuessSongDuelServiceError('当前没有可用的加赛题目', 409, 'OVERTIME_QUESTION_POOL_EMPTY')
  const overtimeCount = await tx.guessSongDuelQuestion.count({ where: { matchId: match.id, isOvertime: true } })
  const nextStartAt = new Date(now.getTime() + DUEL_RESULT_PAUSE_MS)
  const question = await tx.guessSongDuelQuestion.create({
    data: {
      ...buildStoredDuelQuestion(candidate, questionIndex, {
        times: questionTimes(nextStartAt),
        isOvertime: true,
        overtimeIndex: overtimeCount + 1,
      }),
      matchId: match.id,
    },
  })
  await tx.guessSongDuelMatch.update({ where: { id: match.id }, data: { currentQuestionIndex: questionIndex } })
  return { question, nextServerStartAt: nextStartAt.toISOString() }
}

async function advanceDuelQuestionTx(
  tx: Prisma.TransactionClient,
  match: { id: string; totalQuestions: number; mode: string },
  question: { questionIndex: number; isOvertime: boolean },
  now: Date,
) {
  const nextQuestionIndex = question.questionIndex + 1
  if (!question.isOvertime && nextQuestionIndex <= match.totalQuestions) {
    const nextStartAt = new Date(now.getTime() + DUEL_RESULT_PAUSE_MS)
    await tx.guessSongDuelQuestion.update({
      where: { matchId_questionIndex: { matchId: match.id, questionIndex: nextQuestionIndex } },
      data: questionTimes(nextStartAt),
    })
    await tx.guessSongDuelMatch.update({ where: { id: match.id }, data: { currentQuestionIndex: nextQuestionIndex } })
    return { nextServerStartAt: nextStartAt.toISOString() }
  }
  return createDuelOvertimeQuestionTx(tx, match, nextQuestionIndex, now)
}

async function completeResolvedQuestionTx(
  tx: Prisma.TransactionClient,
  match: { id: string; mode: string; totalQuestions: number; currentQuestionIndex: number },
  question: { id: string; questionIndex: number; isOvertime: boolean; overtimeIndex: number | null; optionsSnapshot: Prisma.JsonValue; correctOptionKey: string },
  answers: Array<{ userId: string; selectedOptionKey: string | null; isCorrect: boolean; effectiveElapsedMs: number | null }>,
  now: Date,
): Promise<CompletionOutcome | null> {
  const updatedQuestion = await tx.guessSongDuelQuestion.updateMany({ where: { id: question.id, revealedAt: null }, data: { revealedAt: now } })
  if (updatedQuestion.count !== 1) return null
  const questionResult = buildQuestionResult(question, answers)
  await tx.guessSongDuelMatch.update({ where: { id: match.id }, data: { completedQuestionCount: { increment: 1 } } })
  const mode = match.mode as DuelMode

  if (mode === 'BUZZER') {
    const players = await tx.guessSongDuelPlayer.findMany({ where: { matchId: match.id }, select: { userId: true, correctCount: true } })
    const winner = players.find((player) => player.correctCount >= DUEL_TARGET_CORRECT)
    if (winner) {
      const settled = await settleMatchTx(tx, match.id, { finishReason: 'SCORE_THRESHOLD', winnerId: winner.userId, isDraw: false, valid: true, now })
      return { questionResult, nextServerStartAt: null, matchResult: await resultForTransaction(tx, match.id), syncUserIds: settled.userIds }
    }
    const next = await advanceDuelQuestionTx(tx, match, question, now)
    return { questionResult, nextServerStartAt: next.nextServerStartAt, matchResult: null, syncUserIds: [] }
  }

  if (question.isOvertime) {
    const correctAnswers = answers.filter((answer) => answer.isCorrect)
    if (correctAnswers.length === 1) {
      const settled = await settleMatchTx(tx, match.id, { finishReason: 'TIEBREAKER', winnerId: correctAnswers[0].userId, isDraw: false, valid: true, now })
      return { questionResult, nextServerStartAt: null, matchResult: await resultForTransaction(tx, match.id), syncUserIds: settled.userIds }
    }
    const next = await advanceDuelQuestionTx(tx, match, question, now)
    return { questionResult, nextServerStartAt: next.nextServerStartAt, matchResult: null, syncUserIds: [] }
  }

  if (question.questionIndex >= match.totalQuestions) {
    const players = await tx.guessSongDuelPlayer.findMany({ where: { matchId: match.id }, select: { userId: true, correctCount: true, totalEffectiveAnswerMs: true } })
    const winner = compareDuelPlayers(players)
    if (winner.winnerId) {
      const settled = await settleMatchTx(tx, match.id, { finishReason: 'ALL_QUESTIONS', winnerId: winner.winnerId, isDraw: false, valid: true, now })
      return { questionResult, nextServerStartAt: null, matchResult: await resultForTransaction(tx, match.id), syncUserIds: settled.userIds }
    }
  }

  const next = await advanceDuelQuestionTx(tx, match, question, now)
  return { questionResult, nextServerStartAt: next.nextServerStartAt, matchResult: null, syncUserIds: [] }
}

async function completeQuestionTx(tx: Prisma.TransactionClient, matchId: string, questionIndex: number, now: Date): Promise<CompletionOutcome | null> {
  await tx.$queryRaw`SELECT id FROM GuessSongDuelMatch WHERE id = ${matchId} FOR UPDATE`
  const match = await tx.guessSongDuelMatch.findUnique({ where: { id: matchId } })
  if (!match || match.status !== 'PLAYING' || match.currentQuestionIndex !== questionIndex) return null
  const question = await tx.guessSongDuelQuestion.findUnique({ where: { matchId_questionIndex: { matchId, questionIndex } } })
  if (!question || question.revealedAt) return null
  const answers = await tx.guessSongDuelAnswer.findMany({ where: { matchId, questionId: question.id } })
  if (match.mode === 'BUZZER' && resolveBuzzerRound(answers).outcome === 'SCORED') {
    return completeResolvedQuestionTx(tx, match, question, answers, now)
  }
  if (answers.length < 2 && (!question.answerDeadlineAt || now < question.answerDeadlineAt)) return null
  return completeResolvedQuestionTx(tx, match, question, answers, now)
}

async function syncDuelUsers(userIds: readonly string[]) {
  await Promise.all([...new Set(userIds)].map((userId) => syncUserAchievements(userId, ['DUEL']).catch((error) => {
    console.error('[guess-song-duel.achievements]', { userId, error })
  })))
}

export async function submitDuelAnswer(input: {
  userId: string
  matchId: string
  roomId: string
  roundId: string
  questionId: string
  questionToken: string
  answer: string
  selectedOptionKey: string
  clientElapsedMs?: unknown
  latencyEstimateMs?: number
  receivedAt?: Date
}) {
  const receivedAt = input.receivedAt || new Date()
  const outcome = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM GuessSongDuelMatch WHERE id = ${input.matchId} FOR UPDATE`
    const match = await tx.guessSongDuelMatch.findUnique({ where: { id: input.matchId } })
    if (!match) throw new GuessSongDuelServiceError('对决比赛不存在', 404, 'MATCH_NOT_FOUND')
    if (match.status !== 'PLAYING') throw new GuessSongDuelServiceError('比赛已经结束', 409, 'MATCH_FINISHED')
    if (input.roomId !== match.roomId) throw new GuessSongDuelServiceError('答题请求不属于当前房间', 409, 'STALE_ROUND')
    const player = await tx.guessSongDuelPlayer.findUnique({ where: { matchId_userId: { matchId: input.matchId, userId: input.userId } } })
    if (!player) throw new GuessSongDuelServiceError('你不在这场对决中', 403, 'MATCH_NOT_MEMBER')
    const question = await tx.guessSongDuelQuestion.findUnique({ where: { matchId_questionIndex: { matchId: input.matchId, questionIndex: match.currentQuestionIndex } } })
    if (!question || question.matchId !== input.matchId || input.roundId !== question.id || input.questionId !== question.publicToken || input.questionToken !== question.publicToken) {
      throw new GuessSongDuelServiceError('当前题目已经切换', 409, 'STALE_ROUND')
    }
    if (question.revealedAt) throw new GuessSongDuelServiceError('当前题目已经结算', 409, 'STALE_ROUND')
    const existing = await tx.guessSongDuelAnswer.findUnique({ where: { matchId_questionId_userId: { matchId: input.matchId, questionId: question.id, userId: input.userId } } })
    if (existing) throw new GuessSongDuelServiceError('本题已经作答，不能重复提交', 409, 'ANSWER_ALREADY_SUBMITTED')
    if (!question.audioStartAt || !question.answerDeadlineAt || receivedAt < question.audioStartAt) throw new GuessSongDuelServiceError('题目尚未开始播放', 409, 'QUESTION_TOO_EARLY')
    if (receivedAt > question.answerDeadlineAt) throw new GuessSongDuelServiceError('本题已超时', 409, 'QUESTION_TIMEOUT')
    const optionKey = typeof input.answer === 'string' ? input.answer.trim().toUpperCase() : ''
    const options = parseOptions(question.optionsSnapshot)
    if (!options.some((option) => option.key === optionKey)) throw new GuessSongDuelServiceError('答案选项无效', 400, 'OPTION_INVALID')
    const correct = optionKey === question.correctOptionKey
    const latencyEstimateMs = Math.max(0, Math.min(1_500, Math.round(input.latencyEstimateMs || 0)))
    const effectiveMs = effectiveElapsedMs(receivedAt, question.audioStartAt, latencyEstimateMs)
    const clientElapsedMs = clampClientElapsed(input.clientElapsedMs)
    const suspicious = isSuspiciousAnswer(correct, effectiveMs, clientElapsedMs)
    await tx.guessSongDuelAnswer.create({
      data: {
        matchId: input.matchId,
        questionId: question.id,
        userId: input.userId,
        selectedOptionKey: optionKey,
        isCorrect: correct,
        clientElapsedMs,
        receivedAt,
        latencyEstimateMs,
        effectiveElapsedMs: correct ? effectiveMs : null,
        suspicious,
      },
    })
    await tx.guessSongDuelPlayer.update({
      where: { id: player.id },
      data: {
        correctCount: { increment: correct ? 1 : 0 },
        totalEffectiveAnswerMs: { increment: correct ? effectiveMs : 0 },
        suspicious: suspicious ? true : undefined,
      },
    })
    if (suspicious) await tx.guessSongDuelMatch.update({ where: { id: input.matchId }, data: { isSuspicious: true } })

    let questionCompletion: CompletionOutcome | null = null
    if (match.mode === 'BUZZER' && correct) {
      const answerRows = await tx.guessSongDuelAnswer.findMany({ where: { matchId: input.matchId, questionId: question.id } })
      questionCompletion = await completeResolvedQuestionTx(tx, match, question, answerRows, receivedAt)
    } else {
      const answerCount = await tx.guessSongDuelAnswer.count({ where: { matchId: input.matchId, questionId: question.id } })
      if (answerCount >= 2) questionCompletion = await completeQuestionTx(tx, input.matchId, question.questionIndex, receivedAt)
    }
    return { duplicate: false, accepted: true, matchId: input.matchId, questionIndex: question.questionIndex, userId: input.userId, questionCompletion }
  }, { timeout: 15_000 })
  if (outcome.questionCompletion?.syncUserIds.length) await syncDuelUsers(outcome.questionCompletion.syncUserIds)
  return outcome
}

export async function finalizeDuelQuestion(matchId: string, questionIndex: number, now = new Date()) {
  const outcome = await prisma.$transaction((tx) => completeQuestionTx(tx, matchId, questionIndex, now), { timeout: 15_000 })
  if (outcome?.syncUserIds.length) await syncDuelUsers(outcome.syncUserIds)
  return outcome
}

export async function markDuelPlayerConnected(matchId: string, userId: string, now = new Date()) {
  const player = await prisma.guessSongDuelPlayer.updateMany({
    where: { matchId, userId, Match: { status: 'PLAYING' } },
    data: { isOnline: true, lastSeenAt: now, disconnectedAt: null, reconnectDeadlineAt: null },
  })
  return player.count === 1
}

export async function touchDuelPlayerPresence(matchId: string, userId: string, now = new Date()) {
  const updated = await prisma.guessSongDuelPlayer.updateMany({
    where: { matchId, userId, Match: { status: 'PLAYING' } },
    data: { isOnline: true, lastSeenAt: now, disconnectedAt: null, reconnectDeadlineAt: null },
  })
  if (process.env.NODE_ENV !== 'production') {
    console.debug('[guess-song-duel.heartbeat]', { matchId, userId, at: now.toISOString() })
  }
  return updated.count === 1
}

export async function markDuelPlayerDisconnected(matchId: string, userId: string, now = new Date()) {
  const updated = await prisma.guessSongDuelPlayer.updateMany({
    where: { matchId, userId, Match: { status: 'PLAYING' } },
    data: { isOnline: false, lastSeenAt: now, disconnectedAt: now, reconnectDeadlineAt: new Date(now.getTime() + DUEL_RECONNECT_GRACE_MS) },
  })
  return updated.count === 1 ? new Date(now.getTime() + DUEL_RECONNECT_GRACE_MS) : null
}

export async function settleDuelDisconnect(matchId: string, userId: string, now = new Date()) {
  const outcome = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM GuessSongDuelMatch WHERE id = ${matchId} FOR UPDATE`
    const match = await tx.guessSongDuelMatch.findUnique({ where: { id: matchId } })
    if (!match || match.status !== 'PLAYING') return null
    const disconnected = await tx.guessSongDuelPlayer.findUnique({ where: { matchId_userId: { matchId, userId } } })
    if (!disconnected || disconnected.isOnline || !disconnected.reconnectDeadlineAt || disconnected.reconnectDeadlineAt > now) return null
    const other = await tx.guessSongDuelPlayer.findFirst({ where: { matchId, userId: { not: userId } }, select: { userId: true, isOnline: true, lastSeenAt: true } })
    const valid = match.completedQuestionCount >= DUEL_MIN_VALID_QUESTIONS
    const settledValid = valid && Boolean(other?.isOnline && isDuelPresenceOnline(other.lastSeenAt, now.getTime()))
    const settled = await settleMatchTx(tx, matchId, {
      finishReason: settledValid ? 'DISCONNECT' : 'DISCONNECT_INVALID',
      winnerId: settledValid ? other?.userId || null : null,
      isDraw: false,
      valid: settledValid,
      now,
    })
    return { ...settled, result: await resultForTransaction(tx, matchId) }
  }, { timeout: 15_000 })
  if (outcome?.userIds.length) await syncDuelUsers(outcome.userIds)
  return outcome
}

export async function forfeitDuelMatch(userId: string, matchId: string, now = new Date()) {
  const outcome = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM GuessSongDuelMatch WHERE id = ${matchId} FOR UPDATE`
    const match = await tx.guessSongDuelMatch.findUnique({ where: { id: matchId } })
    if (!match || match.status !== 'PLAYING') throw new GuessSongDuelServiceError('比赛已经结束', 409, 'MATCH_FINISHED')
    const player = await tx.guessSongDuelPlayer.findUnique({ where: { matchId_userId: { matchId, userId } } })
    if (!player) throw new GuessSongDuelServiceError('你不在这场对决中', 403, 'MATCH_NOT_MEMBER')
    const other = await tx.guessSongDuelPlayer.findFirst({ where: { matchId, userId: { not: userId } }, select: { userId: true } })
    const valid = match.completedQuestionCount >= DUEL_MIN_VALID_QUESTIONS
    const settled = await settleMatchTx(tx, matchId, {
      finishReason: valid ? 'FORFEIT' : 'FORFEIT_INVALID',
      winnerId: valid ? other?.userId || null : null,
      isDraw: false,
      valid,
      now,
    })
    return { ...settled, result: await resultForTransaction(tx, matchId) }
  }, { timeout: 15_000 })
  if (outcome.userIds.length) await syncDuelUsers(outcome.userIds)
  return outcome.result
}

export async function getDuelStats(userId: string) {
  const stats = await prisma.guessSongDuelStats.findUnique({ where: { userId } })
  const wins = stats?.wins || 0
  const participations = stats?.participations || 0
  return { wins, participations, winRate: participations ? Math.round(wins / participations * 1000) / 10 : 0 }
}

export async function listDuelHistory(userId: string) {
  const rows = await prisma.guessSongDuelPlayer.findMany({
    where: { userId, Match: { status: { in: ['FINISHED', 'INVALID'] } } },
    orderBy: { Match: { finishedAt: 'desc' } },
    take: 30,
    include: {
      Match: {
        include: {
          Room: { select: { roomCode: true } },
          GuessSongDuelPlayer: { orderBy: { slot: 'asc' }, include: { User: { select: publicUserSelect } } },
        },
      },
    },
  })
  return Promise.all(rows.map(async (row) => ({
    result: await serializeDuelResult(prisma, row.Match, row.Match.GuessSongDuelPlayer),
    roomCode: row.Match.Room.roomCode,
  })))
}

export async function getDuelAdminMatches(limit = 100) {
  const matches = await prisma.guessSongDuelMatch.findMany({
    orderBy: { createdAt: 'desc' },
    take: Math.min(200, Math.max(1, limit)),
    include: {
      Room: { select: { roomCode: true } },
      GuessSongDuelPlayer: { orderBy: { slot: 'asc' }, include: { User: { select: publicUserSelect } } },
      GuessSongDuelQuestion: { orderBy: { questionIndex: 'asc' }, select: { id: true, questionIndex: true, isOvertime: true, songTitle: true, correctOptionKey: true, revealedAt: true } },
      GuessSongDuelAnswer: { select: { questionId: true, userId: true, selectedOptionKey: true, isCorrect: true, receivedAt: true, effectiveElapsedMs: true, latencyEstimateMs: true, suspicious: true } },
    },
  })
  return matches.map((match) => {
    const questionIsOvertime = new Map(match.GuessSongDuelQuestion.map((question) => [question.id, question.isOvertime]))
    const baseCorrectCounts = countDuelBaseCorrectAnswers(match.GuessSongDuelAnswer.map((answer) => ({
      userId: answer.userId,
      isCorrect: answer.isCorrect,
      isOvertime: questionIsOvertime.get(answer.questionId) || false,
    })))
    return {
      id: match.id,
      roomCode: match.Room.roomCode,
      mode: match.mode,
      status: match.status,
      finishReason: match.finishReason,
      winnerId: match.winnerId,
      isDraw: match.isDraw,
      isSuspicious: match.isSuspicious,
      rewardAmount: match.rewardAmount,
      startedAt: match.startedAt.toISOString(),
      finishedAt: match.finishedAt?.toISOString() || null,
      players: match.GuessSongDuelPlayer.map((player) => ({
        userId: player.userId,
        name: getPublicUserDisplayName(player.User),
        correctCount: player.correctCount,
        baseCorrectCount: baseCorrectCounts.get(player.userId) || 0,
        slot: player.slot,
      })),
      questions: match.GuessSongDuelQuestion,
      answers: match.GuessSongDuelAnswer.map((answer) => ({ ...answer, receivedAt: answer.receivedAt.toISOString() })),
    }
  })
}
