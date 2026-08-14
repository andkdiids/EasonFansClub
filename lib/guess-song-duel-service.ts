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
  DUEL_TOTAL_QUESTIONS,
  DUEL_WAITING_ROOM_TTL_MS,
  DUEL_WIN_REWARD,
  isDuelWaitingRoomExpired,
  isDuelPresenceOnline,
  normalizeDuelPassword,
  normalizeDuelRoomCode,
} from '@/lib/guess-song-duel-config'
import type {
  DuelMatchResult,
  DuelMatchState,
  DuelOption,
  DuelPublicUser,
  DuelQuestionResult,
  DuelQuestionState,
  DuelRoomState,
} from '@/lib/guess-song-duel-protocol'
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

function validateRoomCode(value: unknown) {
  if (value === undefined || value === null || value === '') return null
  const code = normalizeDuelRoomCode(value)
  if (!code) throw new GuessSongDuelServiceError('房间号只能使用 4～12 位英文或数字', 400, 'ROOM_CODE_INVALID')
  return code
}

function validatePassword(value: unknown) {
  const password = normalizeDuelPassword(value)
  if (password === null) throw new GuessSongDuelServiceError('房间密码只能使用 4～12 位英文或数字', 400, 'PASSWORD_INVALID')
  return password
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
  if (left.totalEffectiveAnswerMs !== right.totalEffectiveAnswerMs) {
    return { winnerId: left.totalEffectiveAnswerMs < right.totalEffectiveAnswerMs ? left.userId : right.userId, isDraw: false }
  }
  return { winnerId: null, isDraw: true }
}

function serializeDuelResult(
  match: { id: string; status: string; finishReason: string | null; winnerId: string | null; isDraw: boolean; rewardAmount: number; startedAt: Date; finishedAt: Date | null },
  players: Array<{ slot: number; userId: string; correctCount: number; totalEffectiveAnswerMs: number; User: PublicUserRow }>,
): DuelMatchResult {
  return {
    matchId: match.id,
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
      accuracy: Math.round(player.correctCount / DUEL_TOTAL_QUESTIONS * 1000) / 10,
      totalEffectiveAnswerMs: player.totalEffectiveAnswerMs,
      averageAnswerMs: player.correctCount ? Math.round(player.totalEffectiveAnswerMs / player.correctCount) : null,
    })),
  }
}

async function loadMatchForState(matchId: string) {
  const match = await prisma.guessSongDuelMatch.findUnique({
    where: { id: matchId },
    include: {
      Room: { include: roomMemberInclude },
      GuessSongDuelPlayer: { orderBy: { slot: 'asc' }, include: { User: { select: publicUserSelect } } },
    },
  })
  if (!match) throw new GuessSongDuelServiceError('对决比赛不存在', 404, 'MATCH_NOT_FOUND')
  return match
}

async function loadQuestionState(matchId: string, questionIndex: number) {
  const [question, next] = await Promise.all([
    prisma.guessSongDuelQuestion.findUnique({ where: { matchId_questionIndex: { matchId, questionIndex } } }),
    questionIndex < DUEL_TOTAL_QUESTIONS
      ? prisma.guessSongDuelQuestion.findUnique({ where: { matchId_questionIndex: { matchId, questionIndex: questionIndex + 1 } }, select: { publicToken: true } })
      : Promise.resolve(null),
  ])
  return { question, next }
}

async function loadQuestionResult(matchId: string, question: { questionIndex: number; optionsSnapshot: Prisma.JsonValue; correctOptionKey: string }) {
  const answers = await prisma.guessSongDuelAnswer.findMany({
    where: { matchId, Question: { questionIndex: question.questionIndex } },
    orderBy: { createdAt: 'asc' },
    select: { userId: true, selectedOptionKey: true, isCorrect: true, effectiveElapsedMs: true },
  })
  return {
    questionIndex: question.questionIndex,
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
    where: { isPublic: true, status: { in: ['WAITING', 'READY'] }, createdAt: { gte: cutoff } },
    include: roomMemberInclude,
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: 30,
  })
  return rooms.map((room) => ({ ...roomState({ ...room, Match: null } as RoomWithMembers), currentCount: room.challengerId ? 2 : 1 }))
}

export async function searchDuelRoom(roomCode: string) {
  const code = normalizeDuelRoomCode(roomCode)
  if (!code) throw new GuessSongDuelServiceError('请输入有效房间号', 400, 'ROOM_CODE_INVALID')
  const room = await prisma.guessSongDuelRoom.findUnique({ where: { roomCode: code }, include: roomInclude })
  if (room && isDuelWaitingRoomExpired(room.status, room.createdAt)) {
    await markExpiredDuelRoom(room.id, new Date())
    throw new GuessSongDuelServiceError('Duel room expired', 410, 'ROOM_EXPIRED')
  }
  if (!room || !['WAITING', 'READY'].includes(room.status)) {
    throw new GuessSongDuelServiceError('没有找到可加入的对决房间', 404, 'ROOM_NOT_JOINABLE')
  }
  return roomState(room)
}

export async function createDuelRoom(userId: string, input: { roomCode?: unknown; password?: unknown; isPublic?: unknown }, now = new Date()) {
  const requestedCode = validateRoomCode(input.roomCode)
  const password = validatePassword(input.password)
  const passwordHash = password ? await bcrypt.hash(password, 10) : null
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const roomCode = requestedCode || String(randomInt(100_000, 1_000_000))
    try {
      const room = await prisma.$transaction(async (tx) => {
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
        return tx.guessSongDuelRoom.create({
          data: {
            roomCode,
            passwordHash,
            isPublic: input.isPublic !== false,
            hostId: userId,
            hostLastSeenAt: now,
          },
          include: roomInclude,
        })
      })
      const state = roomState(room)
      console.info('[duel.create]', { roomId: state.id, roomCode: state.roomCode, hostId: userId, status: state.status })
      return state
    } catch (error) {
      if (isKnownPrismaError(error, 'P2002') && !requestedCode) continue
      if (isKnownPrismaError(error, 'P2002')) throw new GuessSongDuelServiceError('该房间号已被使用', 409, 'ROOM_CODE_TAKEN')
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
  if (!token) return false
  const invite = await tx.guessSongDuelInvite.findFirst({
    where: { id: token.id, tokenHash: hashToken(token.raw), roomId, inviteeId: userId, acceptedAt: null, expiresAt: { gt: now } },
    select: { id: true },
  })
  if (!invite) return false
  await tx.guessSongDuelInvite.update({ where: { id: invite.id }, data: { acceptedAt: now } })
  return true
}

export async function joinDuelRoom(userId: string, roomId: string, input: { password?: unknown; inviteToken?: unknown }, now = new Date()) {
  const password = validatePassword(input.password)
  await markExpiredDuelRoom(roomId, now)
  const room = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM GuessSongDuelRoom WHERE id = ${roomId} FOR UPDATE`
    const current = await findRoomForTransaction(tx, roomId)
    if (!['WAITING', 'READY'].includes(current.status)) throw new GuessSongDuelServiceError('该对决房间已经开始或已关闭', 409, 'ROOM_NOT_JOINABLE')
    if (current.hostId === userId || current.challengerId === userId) {
      return tx.guessSongDuelRoom.update({
        where: { id: roomId },
        data: current.hostId === userId ? { hostLastSeenAt: now } : { challengerLastSeenAt: now },
        include: roomInclude,
      })
    }
    if (current.challengerId) throw new GuessSongDuelServiceError('房间已满', 409, 'ROOM_FULL')

    const invited = await acceptInviteInTransaction(tx, userId, roomId, input.inviteToken, now)
    if (current.passwordHash && !invited) {
      if (!password || !(await bcrypt.compare(password, current.passwordHash))) {
        throw new GuessSongDuelServiceError('房间密码错误', 403, 'ROOM_PASSWORD_WRONG')
      }
    }
    return tx.guessSongDuelRoom.update({
      where: { id: roomId },
      data: { challengerId: userId, challengerLastSeenAt: now, status: 'READY', challengerReady: false },
      include: roomInclude,
    })
  })
  const state = roomState(room)
  console.info('[duel.join]', { roomId: state.id, roomCode: state.roomCode, hostId: state.host.id, guestId: state.challenger?.id || null, status: state.status })
  return state
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
    await tx.$queryRaw`SELECT id FROM GuessSongDuelRoom WHERE id = ${roomId} FOR UPDATE`
    const current = await findRoomForTransaction(tx, roomId)
    if (current.Match?.status === 'PLAYING') throw new GuessSongDuelServiceError('比赛进行中，请使用退出比赛', 409, 'MATCH_ACTIVE')
    if (current.hostId === userId) {
      return tx.guessSongDuelRoom.update({ where: { id: roomId }, data: { status: 'CLOSED', closedAt: now }, include: roomInclude })
    }
    if (current.challengerId !== userId) throw new GuessSongDuelServiceError('你不在这个对决房间内', 403, 'ROOM_NOT_MEMBER')
    return tx.guessSongDuelRoom.update({
      where: { id: roomId },
      data: { challengerId: null, hostReady: false, challengerReady: false, status: 'WAITING' },
      include: roomInclude,
    })
  })
  return roomState(room)
}

export async function createDuelInvite(userId: string, roomId: string, inviteeId: string, now = new Date()) {
  const token = randomBytes(32).toString('base64url')
  await markExpiredDuelRoom(roomId, now)
  const room = await prisma.guessSongDuelRoom.findUnique({ where: { id: roomId }, select: { hostId: true, challengerId: true, status: true, roomCode: true } })
  if (!room || !['WAITING', 'READY'].includes(room.status)) throw new GuessSongDuelServiceError('房间已经开始或已关闭', 409, 'ROOM_NOT_INVITABLE')
  if (room.hostId !== userId && room.challengerId !== userId) throw new GuessSongDuelServiceError('你不在这个对决房间内', 403, 'ROOM_NOT_MEMBER')
  if (inviteeId === userId) throw new GuessSongDuelServiceError('不能邀请自己', 400, 'INVITEE_INVALID')

  const [friendship, invitee] = await Promise.all([
    prisma.friendship.findFirst({ where: { OR: [{ userAId: userId, userBId: inviteeId }, { userAId: inviteeId, userBId: userId }] }, select: { id: true } }),
    prisma.user.findFirst({ where: { id: inviteeId, status: 'ACTIVE', isDeleted: false }, select: { id: true } }),
  ])
  if (!friendship || !invitee) throw new GuessSongDuelServiceError('只能邀请当前好友列表中的用户', 403, 'INVITEE_NOT_FRIEND')

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
        title: '听听·对决邀请',
        content: `你的好友邀请你参加听听·对决，房间：${room.roomCode}`,
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
          questionCount: DUEL_TOTAL_QUESTIONS,
        }
      }
      throw new GuessSongDuelServiceError('Duel room is already in progress', 409, 'ROOM_NOT_STARTABLE')
    }
    if (room.hostId !== userId) throw new GuessSongDuelServiceError('只有房主可以开始游戏', 403, 'HOST_ONLY')
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

    const active = await tx.guessSongDuelPlayer.findFirst({
      where: { userId: { in: [room.hostId, room.challengerId] }, Match: { status: 'PLAYING' } },
      select: { id: true },
    })
    if (active) throw new GuessSongDuelServiceError('有玩家已经在另一场对决中', 409, 'PLAYER_MATCH_ACTIVE')

    const quizConfig = await getGuessSongQuizConfigOrDefault()
    const candidates = await getEligibleDuelCandidates(tx, quizConfig.enabled)
    if (candidates.length < DUEL_TOTAL_QUESTIONS) {
      throw new GuessSongDuelServiceError('当前可用曲库不足 30 首，暂时无法开始对决', 409, 'QUESTION_POOL_TOO_SMALL')
    }
    const selected = shuffle(candidates).slice(0, DUEL_TOTAL_QUESTIONS)
    const firstStartAt = new Date(now.getTime() + DUEL_COUNTDOWN_MS)
    const firstTimes = questionTimes(firstStartAt)
    const questions = selected.map((candidate, index) => {
      const built = buildOptions(candidate)
      if (!built) throw new GuessSongDuelServiceError('题库存在无效四选一数据，请联系管理员', 409, 'QUESTION_OPTIONS_INVALID')
      const first = index === 0
      return {
        publicToken: createUUID(),
        questionIndex: index + 1,
        optionsSnapshot: built.options,
        correctOptionKey: built.correctOptionKey,
        songTitle: candidate.songTitle,
        albumTitle: candidate.albumTitle,
        audioStoragePath: candidate.GuessSongAudioVariant[0].storagePath,
        audioDurationSeconds: candidate.GuessSongAudioVariant[0].durationSeconds,
        ...(first ? firstTimes : {}),
        sourceQuestionId: candidate.id,
      }
    })
    const match = await tx.guessSongDuelMatch.create({
      data: {
        roomId,
        startedAt: now,
        currentQuestionIndex: 1,
        totalQuestions: DUEL_TOTAL_QUESTIONS,
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
  const match = await loadMatchForState(matchId)
  if (!match.GuessSongDuelPlayer.some((player) => player.userId === userId)) throw new GuessSongDuelServiceError('你不在这场对决中', 403, 'MATCH_NOT_MEMBER')
  const { question, next } = await loadQuestionState(matchId, match.currentQuestionIndex)
  const answers = question
    ? await prisma.guessSongDuelAnswer.findMany({ where: { matchId, questionId: question.id }, select: { userId: true } })
    : []
  const answeredIds = new Set(answers.map((answer) => answer.userId))
  const players = match.GuessSongDuelPlayer.map((player) => ({
    ...publicUser(player.User),
    userId: player.userId,
    isOnline: player.isOnline && isDuelPresenceOnline(player.lastSeenAt, now.getTime()),
    slot: player.slot === 1 ? 1 as const : 2 as const,
    correctCount: player.correctCount,
    totalEffectiveAnswerMs: player.totalEffectiveAnswerMs,
    submitted: answeredIds.has(player.userId),
    suspicious: player.suspicious,
  }))
  const activeQuestion = question && question.serverStartedAt && question.audioStartAt && question.answerDeadlineAt
    ? {
        id: question.id,
        publicToken: question.publicToken,
        questionIndex: question.questionIndex,
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
    ? await loadQuestionResult(matchId, question)
    : null
  const result = match.status !== 'PLAYING'
    ? serializeDuelResult(match, match.GuessSongDuelPlayer)
    : null
  const phase = match.status === 'PLAYING'
    ? (question?.serverStartedAt && question.serverStartedAt > now ? 'STARTING' : 'PLAYING')
    : match.status
  return {
    matchId: match.id,
    roomId: match.Room.id,
    status: match.status,
    phase,
    currentQuestionIndex: match.currentQuestionIndex,
    totalQuestions: match.totalQuestions,
    completedQuestionCount: match.completedQuestionCount,
    serverNow: now.toISOString(),
    players,
    question: activeQuestion,
    questionResult,
    result,
  }
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
  return serializeDuelResult(match, players)
}

async function completeQuestionTx(tx: Prisma.TransactionClient, matchId: string, questionIndex: number, now: Date): Promise<CompletionOutcome | null> {
  const match = await tx.guessSongDuelMatch.findUnique({ where: { id: matchId } })
  if (!match || match.status !== 'PLAYING' || match.currentQuestionIndex !== questionIndex) return null
  const question = await tx.guessSongDuelQuestion.findUnique({ where: { matchId_questionIndex: { matchId, questionIndex } } })
  if (!question || question.revealedAt) return null
  const answers = await tx.guessSongDuelAnswer.findMany({ where: { matchId, questionId: question.id } })
  if (answers.length < 2 && (!question.answerDeadlineAt || now < question.answerDeadlineAt)) return null
  const updatedQuestion = await tx.guessSongDuelQuestion.updateMany({ where: { id: question.id, revealedAt: null }, data: { revealedAt: now } })
  if (updatedQuestion.count !== 1) return null
  const questionResult: DuelQuestionResult = {
    questionIndex,
    correctOptionKey: question.correctOptionKey,
    correctLabel: getOptionLabel(question.optionsSnapshot, question.correctOptionKey),
    answers: answers.map((answer) => ({ userId: answer.userId, selectedOptionKey: answer.selectedOptionKey, correct: answer.isCorrect, effectiveElapsedMs: answer.effectiveElapsedMs })),
  }
  await tx.guessSongDuelMatch.update({ where: { id: matchId }, data: { completedQuestionCount: { increment: 1 } } })
  if (questionIndex >= match.totalQuestions) {
    const players = await tx.guessSongDuelPlayer.findMany({ where: { matchId }, select: { userId: true, correctCount: true, totalEffectiveAnswerMs: true } })
    const winner = compareDuelPlayers(players)
    const settled = await settleMatchTx(tx, matchId, { finishReason: 'ALL_QUESTIONS', winnerId: winner.winnerId, isDraw: winner.isDraw, valid: true, now })
    return { questionResult, nextServerStartAt: null, matchResult: await resultForTransaction(tx, matchId), syncUserIds: settled.userIds }
  }
  const nextStartAt = new Date(now.getTime() + DUEL_RESULT_PAUSE_MS)
  const times = questionTimes(nextStartAt)
  await tx.guessSongDuelQuestion.update({ where: { matchId_questionIndex: { matchId, questionIndex: questionIndex + 1 } }, data: times })
  await tx.guessSongDuelMatch.update({ where: { id: matchId }, data: { currentQuestionIndex: questionIndex + 1 } })
  return { questionResult, nextServerStartAt: nextStartAt.toISOString(), matchResult: null, syncUserIds: [] }
}

async function syncDuelUsers(userIds: readonly string[]) {
  await Promise.all([...new Set(userIds)].map((userId) => syncUserAchievements(userId, ['DUEL']).catch((error) => {
    console.error('[guess-song-duel.achievements]', { userId, error })
  })))
}

export async function submitDuelAnswer(input: {
  userId: string
  matchId: string
  questionToken: string
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
    const player = await tx.guessSongDuelPlayer.findUnique({ where: { matchId_userId: { matchId: input.matchId, userId: input.userId } } })
    if (!player) throw new GuessSongDuelServiceError('你不在这场对决中', 403, 'MATCH_NOT_MEMBER')
    const question = await tx.guessSongDuelQuestion.findUnique({ where: { publicToken: input.questionToken } })
    if (!question || question.matchId !== input.matchId || question.questionIndex !== match.currentQuestionIndex) throw new GuessSongDuelServiceError('当前题目已经切换', 409, 'QUESTION_CHANGED')
    if (!question.audioStartAt || !question.answerDeadlineAt || receivedAt < question.audioStartAt) throw new GuessSongDuelServiceError('题目尚未开始播放', 409, 'QUESTION_TOO_EARLY')
    if (receivedAt > question.answerDeadlineAt) throw new GuessSongDuelServiceError('本题已超时', 409, 'QUESTION_TIMEOUT')
    const existing = await tx.guessSongDuelAnswer.findUnique({ where: { matchId_questionId_userId: { matchId: input.matchId, questionId: question.id, userId: input.userId } } })
    if (existing) return { duplicate: true, accepted: true, matchId: input.matchId, questionIndex: question.questionIndex, questionCompletion: null as CompletionOutcome | null }
    const optionKey = typeof input.selectedOptionKey === 'string' ? input.selectedOptionKey.trim().toUpperCase() : ''
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
    const updatedPlayerCorrect = player.correctCount + (correct ? 1 : 0)
    if (correct && updatedPlayerCorrect >= DUEL_TARGET_CORRECT) {
      await tx.guessSongDuelQuestion.update({ where: { id: question.id }, data: { revealedAt: receivedAt } })
      await tx.guessSongDuelMatch.update({ where: { id: input.matchId }, data: { completedQuestionCount: { increment: 1 } } })
      const answerRows = await tx.guessSongDuelAnswer.findMany({ where: { matchId: input.matchId, questionId: question.id } })
      const questionResult: DuelQuestionResult = {
        questionIndex: question.questionIndex,
        correctOptionKey: question.correctOptionKey,
        correctLabel: getOptionLabel(question.optionsSnapshot, question.correctOptionKey),
        answers: answerRows.map((answer) => ({ userId: answer.userId, selectedOptionKey: answer.selectedOptionKey, correct: answer.isCorrect, effectiveElapsedMs: answer.effectiveElapsedMs })),
      }
      const settled = await settleMatchTx(tx, input.matchId, { finishReason: 'SCORE_THRESHOLD', winnerId: input.userId, isDraw: false, valid: true, now: receivedAt })
      questionCompletion = { questionResult, nextServerStartAt: null, matchResult: await resultForTransaction(tx, input.matchId), syncUserIds: settled.userIds }
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
  return rows.map((row) => ({
    result: serializeDuelResult(row.Match, row.Match.GuessSongDuelPlayer),
    roomCode: row.Match.Room.roomCode,
  }))
}

export async function getDuelAdminMatches(limit = 100) {
  const matches = await prisma.guessSongDuelMatch.findMany({
    orderBy: { createdAt: 'desc' },
    take: Math.min(200, Math.max(1, limit)),
    include: {
      Room: { select: { roomCode: true } },
      GuessSongDuelPlayer: { orderBy: { slot: 'asc' }, include: { User: { select: publicUserSelect } } },
      GuessSongDuelQuestion: { orderBy: { questionIndex: 'asc' }, select: { id: true, questionIndex: true, songTitle: true, correctOptionKey: true, revealedAt: true } },
      GuessSongDuelAnswer: { select: { questionId: true, userId: true, selectedOptionKey: true, isCorrect: true, receivedAt: true, effectiveElapsedMs: true, latencyEstimateMs: true, suspicious: true } },
    },
  })
  return matches.map((match) => ({
    id: match.id,
    roomCode: match.Room.roomCode,
    status: match.status,
    finishReason: match.finishReason,
    winnerId: match.winnerId,
    isDraw: match.isDraw,
    isSuspicious: match.isSuspicious,
    rewardAmount: match.rewardAmount,
    startedAt: match.startedAt.toISOString(),
    finishedAt: match.finishedAt?.toISOString() || null,
    players: match.GuessSongDuelPlayer.map((player) => ({ userId: player.userId, name: getPublicUserDisplayName(player.User), correctCount: player.correctCount, slot: player.slot })),
    questions: match.GuessSongDuelQuestion,
    answers: match.GuessSongDuelAnswer.map((answer) => ({ ...answer, receivedAt: answer.receivedAt.toISOString() })),
  }))
}
