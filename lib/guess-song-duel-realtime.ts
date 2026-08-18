import type { WebSocket } from 'next/dist/compiled/ws'
import {
  finalizeDuelQuestion,
  enterDuelRoom,
  getDuelMatchParticipantId,
  getDuelMatchState,
  getDuelRoomState,
  markDuelPlayerConnected,
  markDuelPlayerDisconnected,
  settleDuelDisconnect,
  submitDuelAnswer,
  touchDuelPlayerPresence,
  touchDuelRoomPresence,
} from '@/lib/guess-song-duel-service'
import { isDuelPresenceOnline } from '@/lib/guess-song-duel-config'
import type {
  DuelClientCommand,
  DuelMatchState,
  DuelRealtimeEvent,
  DuelRoomState,
} from '@/lib/guess-song-duel-protocol'

const OPEN_STATE = 1
const MAX_COMMAND_BYTES = 16_384

type DuelSocket = WebSocket & {
  duelUserId?: string
  duelRoomId?: string
  duelMatchId?: string
  duelLastSeenAt?: number
  duelRttMs?: number
  duelTimeSyncPending?: Map<string, { serverReceivedAt: number; serverSentAt: number }>
}

type MatchTimer = ReturnType<typeof setTimeout>

function safeSend(socket: DuelSocket, event: DuelRealtimeEvent) {
  if (socket.readyState !== OPEN_STATE) return false
  try {
    socket.send(JSON.stringify(event))
    return true
  } catch {
    return false
  }
}

function errorMessage(error: unknown) {
  if (error && typeof error === 'object' && 'message' in error && typeof error.message === 'string') return error.message
  return 'Realtime duel request failed'
}

function errorCode(error: unknown) {
  if (error && typeof error === 'object' && 'code' in error && typeof error.code === 'string') return error.code
  return 'DUEL_REALTIME_ERROR'
}

function parseCommand(data: Buffer | string) {
  const text = String(data)
  if (Buffer.byteLength(text, 'utf8') > MAX_COMMAND_BYTES) return null
  try {
    const value = JSON.parse(text) as unknown
    if (!value || typeof value !== 'object' || Array.isArray(value) || typeof (value as { type?: unknown }).type !== 'string') return null
    return value as DuelClientCommand
  } catch {
    return null
  }
}

function toQuestionStart(state: DuelMatchState): DuelRealtimeEvent | null {
  if (!state.question || state.phase === 'FINISHED' || state.phase === 'INVALID' || state.phase === 'CLOSED') return null
  return { type: 'QUESTION_START', state: state.question, players: state.players, completedQuestionCount: state.completedQuestionCount }
}

export class GuessSongDuelRealtimeHub {
  private readonly sockets = new Set<DuelSocket>()
  private readonly roomSockets = new Map<string, Set<DuelSocket>>()
  private readonly matchSockets = new Map<string, Set<DuelSocket>>()
  private readonly matchTimers = new Map<string, MatchTimer>()
  private readonly disconnectTimers = new Map<string, MatchTimer>()

  attach(userId: string, socket: DuelSocket) {
    socket.duelUserId = userId
    socket.duelLastSeenAt = Date.now()
    this.sockets.add(socket)
    safeSend(socket, { type: 'SERVER_HELLO', serverNow: new Date().toISOString() })
    return () => this.detach(socket)
  }

  detach(socket: DuelSocket) {
    this.sockets.delete(socket)
    this.removeFromRoom(socket)
    const matchId = socket.duelMatchId
    const userId = socket.duelUserId
    this.removeFromMatch(socket)
    if (!matchId || !userId || this.hasMatchUserConnection(matchId, userId)) return
    void this.handleDisconnect(matchId, userId)
  }

  async handleMessage(socket: DuelSocket, data: Buffer | string) {
    const command = parseCommand(data)
    if (!command) {
      safeSend(socket, { type: 'ERROR', code: 'COMMAND_INVALID', message: 'Invalid duel command' })
      return
    }
    try {
      switch (command.type) {
        case 'JOIN_ROOM':
          await this.joinRoom(socket, command.roomId)
          return
        case 'JOIN_MATCH':
          await this.joinMatch(socket, command.matchId)
          return
        case 'TIME_SYNC_REQUEST': {
          const receivedAt = Date.now()
          const serverSentAt = Date.now()
          const pending = socket.duelTimeSyncPending || new Map<string, { serverReceivedAt: number; serverSentAt: number }>()
          pending.set(command.requestId, { serverReceivedAt: receivedAt, serverSentAt })
          socket.duelTimeSyncPending = pending
          safeSend(socket, {
            type: 'TIME_SYNC',
            requestId: command.requestId,
            clientSentAt: command.clientSentAt,
            serverReceivedAt: receivedAt,
            serverSentAt,
          })
          return
        }
        case 'TIME_SYNC_ACK': {
          const pending = socket.duelTimeSyncPending?.get(command.requestId)
          if (pending) {
            socket.duelRttMs = Math.max(0, Math.min(1_500, Date.now() - pending.serverReceivedAt))
            socket.duelTimeSyncPending?.delete(command.requestId)
          }
          return
        }
        case 'PING':
          await this.touchPresence(socket)
          safeSend(socket, { type: 'PONG', serverNow: new Date().toISOString() })
          return
        case 'ANSWER':
          await this.answer(socket, command)
          return
        default:
          safeSend(socket, { type: 'ERROR', code: 'COMMAND_UNSUPPORTED', message: 'Unsupported duel command' })
      }
    } catch (error) {
      safeSend(socket, { type: 'ERROR', code: errorCode(error), message: errorMessage(error) })
    }
  }

  isUserConnectedInRoom(roomId: string, userId: string) {
    const sockets = this.roomSockets.get(roomId)
    if (!sockets) return false
    const now = Date.now()
    for (const socket of sockets) {
      if (socket.duelUserId === userId && socket.readyState === OPEN_STATE && isDuelPresenceOnline(socket.duelLastSeenAt, now)) return true
    }
    return false
  }

  async broadcastRoom(roomId: string, state?: DuelRoomState) {
    try {
      const nextState = state || await getDuelRoomState(roomId)
      this.broadcastRoomEvent(roomId, { type: 'ROOM_STATE', state: nextState })
    } catch (error) {
      this.broadcastRoomEvent(roomId, { type: 'ERROR', code: errorCode(error), message: errorMessage(error) })
    }
  }

  broadcastMatchState(matchId: string) {
    void this.sendMatchState(matchId)
  }

  broadcastMatchStarting(matchId: string, serverStartAt: string, questionIndex = 1, totalQuestions = 30) {
    this.broadcastMatchEvent(matchId, { type: 'MATCH_STARTING', matchId, serverStartAt, questionIndex, totalQuestions })
  }

  scheduleMatch(matchId: string, at?: string | Date) {
    const existing = this.matchTimers.get(matchId)
    if (existing) clearTimeout(existing)
    const timer = setTimeout(() => {
      this.matchTimers.delete(matchId)
      void this.tickMatch(matchId)
    }, Math.max(0, (at ? new Date(at).getTime() : Date.now()) - Date.now()))
    this.matchTimers.set(matchId, timer)
  }

  async publishSubmission(matchId: string, outcome: Awaited<ReturnType<typeof submitDuelAnswer>>) {
    if ('userId' in outcome && outcome.userId) {
      this.broadcastMatchEvent(matchId, { type: 'PLAYER_ANSWERED', matchId, questionIndex: outcome.questionIndex, userId: outcome.userId })
      // Feedback travels only to the answering player. The opponent's socket
      // never receives selectedOptionKey / correct / correctOptionKey, so SCORE
      // stays isolated while BUZZER keeps its own reveal path untouched.
      this.sendToUser(outcome.userId, {
        type: 'ANSWER_ACCEPTED',
        matchId,
        questionIndex: outcome.questionIndex,
        userId: outcome.userId,
        correct: outcome.correct,
        correctOptionKey: outcome.correctOptionKey,
        selectedOptionKey: outcome.selectedOptionKey,
      })
    }
    await this.publishCompletion(matchId, outcome.questionCompletion)
  }

  async publishCompletion(matchId: string, completion: {
    questionResult: DuelMatchState['questionResult']
    nextServerStartAt: string | null
    matchResult: DuelMatchState['result']
  } | null) {
    if (!completion) return
    if (completion.questionResult) {
      this.broadcastMatchEvent(matchId, {
        type: 'QUESTION_RESULT',
        matchId,
        result: completion.questionResult,
        nextServerStartAt: completion.nextServerStartAt,
      })
    }
    if (completion.matchResult) {
      this.clearMatchTimer(matchId)
      this.broadcastMatchEvent(matchId, { type: 'MATCH_FINISHED', result: completion.matchResult })
      return
    }
    if (completion.nextServerStartAt) this.scheduleMatch(matchId, completion.nextServerStartAt)
  }

  private async joinRoom(socket: DuelSocket, roomId: string) {
    const userId = this.requireUser(socket)
    socket.duelLastSeenAt = Date.now()
    const result = await enterDuelRoom(userId, roomId, new Date(socket.duelLastSeenAt))
    for (const affectedRoom of result.affectedRooms) this.broadcastRoomEvent(affectedRoom.id, { type: 'ROOM_STATE', state: affectedRoom })
    const state = result.room
    this.removeFromRoom(socket)
    socket.duelRoomId = roomId
    this.addToMap(this.roomSockets, roomId, socket)
    safeSend(socket, { type: 'ROOM_STATE', state })
    if (state.matchId) await this.joinMatch(socket, state.matchId)
  }

  private async joinMatch(socket: DuelSocket, matchId: string) {
    const userId = this.requireUser(socket)
    await getDuelMatchState(userId, matchId)
    this.removeFromMatch(socket)
    socket.duelMatchId = matchId
    this.addToMap(this.matchSockets, matchId, socket)
    await markDuelPlayerConnected(matchId, userId)
    socket.duelLastSeenAt = Date.now()
    this.clearDisconnectTimer(matchId, userId)
    const state = await getDuelMatchState(userId, matchId)
    safeSend(socket, { type: 'MATCH_STATE', state })
    this.broadcastMatchEvent(matchId, { type: 'PLAYER_PRESENCE', matchId, userId, isOnline: true, reconnectDeadlineAt: null })
    if (state.mode === 'BUZZER' || state.question?.isOvertime) {
      if (state.phase === 'STARTING' && state.question?.serverStartedAt) this.scheduleMatch(matchId, state.question.serverStartedAt)
      else if (state.phase === 'PLAYING' && state.question?.answerDeadlineAt) this.scheduleMatch(matchId, state.question.answerDeadlineAt)
    }
  }

  private async answer(socket: DuelSocket, command: Extract<DuelClientCommand, { type: 'ANSWER' }>) {
    const userId = this.requireUser(socket)
    if (socket.duelMatchId !== command.matchId) throw new Error('Join the duel before answering')
    const outcome = await submitDuelAnswer({
      userId,
      matchId: command.matchId,
      roomId: command.roomId,
      roundId: command.roundId,
      questionId: command.questionId,
      questionToken: command.questionToken,
      answer: command.answer,
      selectedOptionKey: command.selectedOptionKey,
      clientElapsedMs: command.clientElapsedMs,
      latencyEstimateMs: Math.round((socket.duelRttMs || 0) / 2),
    })
    await this.publishSubmission(command.matchId, outcome)
  }

  private async tickMatch(matchId: string) {
    try {
      const socket = this.firstMatchSocket(matchId)
      const userId = socket?.duelUserId || await getDuelMatchParticipantId(matchId)
      if (!userId) return
      const state = await getDuelMatchState(userId, matchId)
      if (state.status === 'PLAYING' && state.mode === 'SCORE' && !state.question?.isOvertime) return
      if (state.status !== 'PLAYING' || !state.question) {
        if (state.result) this.broadcastMatchEvent(matchId, { type: 'MATCH_FINISHED', result: state.result })
        return
      }
      const now = Date.now()
      const serverStartAt = new Date(state.question.serverStartedAt).getTime()
      if (serverStartAt > now) {
        this.scheduleMatch(matchId, state.question.serverStartedAt)
        return
      }
      const startEvent = toQuestionStart(state)
      if (startEvent) this.broadcastMatchEvent(matchId, startEvent)
      const deadline = new Date(state.question.answerDeadlineAt).getTime()
      if (deadline > now) {
        this.scheduleMatch(matchId, state.question.answerDeadlineAt)
        return
      }
      const completion = await finalizeDuelQuestion(matchId, state.question.questionIndex)
      await this.publishCompletion(matchId, completion)
    } catch (error) {
      this.broadcastMatchEvent(matchId, { type: 'ERROR', code: errorCode(error), message: errorMessage(error) })
    }
  }

  private async sendMatchState(matchId: string) {
    const sockets = [...(this.matchSockets.get(matchId) || [])].filter((socket) => socket.readyState === OPEN_STATE && socket.duelUserId)
    if (!sockets.length) return
    try {
      const states = await Promise.all(sockets.map(async (socket) => ({
        socket,
        state: await getDuelMatchState(socket.duelUserId as string, matchId),
      })))
      for (const item of states) safeSend(item.socket, { type: 'MATCH_STATE', state: item.state })
      const state = states[0]?.state
      if (!state) return
      if (state.status === 'PLAYING' && state.question && (state.mode === 'BUZZER' || state.question.isOvertime)) {
        const startAt = new Date(state.question.serverStartedAt).getTime()
        this.scheduleMatch(matchId, startAt > Date.now() ? state.question.serverStartedAt : state.question.answerDeadlineAt)
      }
    } catch (error) {
      this.broadcastMatchEvent(matchId, { type: 'ERROR', code: errorCode(error), message: errorMessage(error) })
    }
  }

  private async handleDisconnect(matchId: string, userId: string) {
    if (this.hasMatchUserConnection(matchId, userId)) {
      await markDuelPlayerConnected(matchId, userId)
      return
    }
    const deadline = await markDuelPlayerDisconnected(matchId, userId)
    if (!deadline) return
    // A reconnect may have completed while the database update was in flight.
    // Repair the presence row before exposing a stale disconnect deadline.
    if (this.hasMatchUserConnection(matchId, userId)) {
      await markDuelPlayerConnected(matchId, userId)
      return
    }
    this.broadcastMatchEvent(matchId, { type: 'PLAYER_PRESENCE', matchId, userId, isOnline: false, reconnectDeadlineAt: deadline.toISOString() })
    const key = this.disconnectKey(matchId, userId)
    this.clearDisconnectTimer(matchId, userId)
    const timer = setTimeout(() => {
      this.disconnectTimers.delete(key)
      void settleDuelDisconnect(matchId, userId).then((outcome) => {
        if (!outcome) return
        this.clearMatchTimer(matchId)
        this.broadcastMatchEvent(matchId, { type: 'MATCH_FINISHED', result: outcome.result })
      }).catch((error) => {
        this.broadcastMatchEvent(matchId, { type: 'ERROR', code: errorCode(error), message: errorMessage(error) })
      })
    }, Math.max(0, deadline.getTime() - Date.now()))
    this.disconnectTimers.set(key, timer)
  }

  private requireUser(socket: DuelSocket) {
    if (!socket.duelUserId) throw new Error('Unauthenticated duel socket')
    return socket.duelUserId
  }

  private async touchPresence(socket: DuelSocket) {
    const userId = this.requireUser(socket)
    const now = new Date()
    socket.duelLastSeenAt = now.getTime()
    if (socket.duelRoomId) await touchDuelRoomPresence(userId, socket.duelRoomId, now)
    if (socket.duelMatchId) await touchDuelPlayerPresence(socket.duelMatchId, userId, now)
  }

  private firstMatchSocket(matchId: string) {
    const sockets = this.matchSockets.get(matchId)
    if (!sockets) return null
    for (const socket of sockets) if (socket.readyState === OPEN_STATE) return socket
    return null
  }

  private hasMatchUserConnection(matchId: string, userId: string) {
    const sockets = this.matchSockets.get(matchId)
    if (!sockets) return false
    for (const socket of sockets) if (socket.duelUserId === userId && socket.readyState === OPEN_STATE) return true
    return false
  }

  private sendToUser(userId: string, event: DuelRealtimeEvent) {
    for (const socket of this.sockets) if (socket.duelUserId === userId) safeSend(socket, event)
  }

  private broadcastRoomEvent(roomId: string, event: DuelRealtimeEvent) {
    for (const socket of this.roomSockets.get(roomId) || []) safeSend(socket, event)
  }

  private broadcastMatchEvent(matchId: string, event: DuelRealtimeEvent) {
    for (const socket of this.matchSockets.get(matchId) || []) safeSend(socket, event)
  }

  private addToMap(map: Map<string, Set<DuelSocket>>, key: string, socket: DuelSocket) {
    const sockets = map.get(key) || new Set<DuelSocket>()
    sockets.add(socket)
    map.set(key, sockets)
  }

  private removeFromRoom(socket: DuelSocket) {
    const roomId = socket.duelRoomId
    if (!roomId) return
    const sockets = this.roomSockets.get(roomId)
    sockets?.delete(socket)
    if (sockets && !sockets.size) this.roomSockets.delete(roomId)
    socket.duelRoomId = undefined
  }

  private removeFromMatch(socket: DuelSocket) {
    const matchId = socket.duelMatchId
    if (!matchId) return
    const sockets = this.matchSockets.get(matchId)
    sockets?.delete(socket)
    if (sockets && !sockets.size) this.matchSockets.delete(matchId)
    socket.duelMatchId = undefined
  }

  private disconnectKey(matchId: string, userId: string) {
    return `${matchId}:${userId}`
  }

  private clearDisconnectTimer(matchId: string, userId: string) {
    const key = this.disconnectKey(matchId, userId)
    const timer = this.disconnectTimers.get(key)
    if (timer) clearTimeout(timer)
    this.disconnectTimers.delete(key)
  }

  private clearMatchTimer(matchId: string) {
    const timer = this.matchTimers.get(matchId)
    if (timer) clearTimeout(timer)
    this.matchTimers.delete(matchId)
  }
}

const globalWithDuelRealtime = globalThis as typeof globalThis & { __ecfcDuelRealtime?: GuessSongDuelRealtimeHub }
export const duelRealtimeHub = globalWithDuelRealtime.__ecfcDuelRealtime || (() => {
  const hub = new GuessSongDuelRealtimeHub()
  globalWithDuelRealtime.__ecfcDuelRealtime = hub
  return hub
})()
