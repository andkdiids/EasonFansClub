import type { WebSocket } from 'next/dist/compiled/ws'
import {
  advanceExpiredUndercoverMatch,
  enterUndercoverRoom,
  getUndercoverMatchSnapshot,
  getUndercoverRoomPublicState,
  getUndercoverRoomState,
  setUndercoverPresence,
  touchUndercoverPresence,
} from '@/lib/undercover-star'
import type { UndercoverClientCommand, UndercoverRealtimeEvent } from '@/lib/undercover-star-protocol'

const OPEN_STATE = 1
const MAX_COMMAND_BYTES = 16_384
type MatchTimer = ReturnType<typeof setTimeout>

type UndercoverSocket = WebSocket & {
  undercoverUserId?: string
  undercoverRoomId?: string
  undercoverMatchId?: string
  undercoverLastSeenAt?: number
}

function safeSend(socket: UndercoverSocket, event: UndercoverRealtimeEvent) {
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
  return '卧底巨星实时同步失败。'
}

function errorCode(error: unknown) {
  if (error && typeof error === 'object' && 'code' in error && typeof error.code === 'string') return error.code
  return 'UNDERCOVER_REALTIME_ERROR'
}

function parseCommand(data: Buffer | string): UndercoverClientCommand | null {
  const text = String(data)
  if (Buffer.byteLength(text, 'utf8') > MAX_COMMAND_BYTES) return null
  try {
    const value = JSON.parse(text) as unknown
    if (!value || typeof value !== 'object' || Array.isArray(value) || typeof (value as { type?: unknown }).type !== 'string') return null
    return value as UndercoverClientCommand
  } catch {
    return null
  }
}

export class UndercoverStarRealtimeHub {
  private readonly sockets = new Set<UndercoverSocket>()
  private readonly roomSockets = new Map<string, Set<UndercoverSocket>>()
  private readonly matchSockets = new Map<string, Set<UndercoverSocket>>()
  private readonly matchTimers = new Map<string, MatchTimer>()

  attach(userId: string, socket: UndercoverSocket) {
    socket.undercoverUserId = userId
    socket.undercoverLastSeenAt = Date.now()
    this.sockets.add(socket)
    safeSend(socket, { type: 'SERVER_HELLO', serverNow: new Date().toISOString() })
    return () => this.detach(socket)
  }

  detach(socket: UndercoverSocket) {
    this.sockets.delete(socket)
    const userId = socket.undercoverUserId
    const roomId = socket.undercoverRoomId
    const matchId = socket.undercoverMatchId
    this.removeFromRoom(socket)
    this.removeFromMatch(socket)
    if (!userId || !roomId || (matchId && this.hasMatchUserConnection(matchId, userId))) return
    void setUndercoverPresence(userId, roomId, matchId, false).catch((error) => console.error('[undercover-star.presence]', error))
  }

  async handleMessage(socket: UndercoverSocket, data: Buffer | string) {
    const command = parseCommand(data)
    if (!command) {
      safeSend(socket, { type: 'ERROR', code: 'COMMAND_INVALID', message: '无效的实时指令。' })
      return
    }
    try {
      if (command.type === 'JOIN_ROOM' || command.type === 'SYNC_ROOM') {
        await this.joinRoom(socket, command.roomId)
        return
      }
      if (command.type === 'JOIN_MATCH' || command.type === 'SYNC_MATCH') {
        await this.joinMatch(socket, command.matchId)
        return
      }
      if (command.type === 'PING') {
        await this.touchPresence(socket)
        safeSend(socket, { type: 'PONG', serverNow: new Date().toISOString() })
        return
      }
      safeSend(socket, { type: 'ERROR', code: 'COMMAND_UNSUPPORTED', message: '不支持的实时指令。' })
    } catch (error) {
      safeSend(socket, { type: 'ERROR', code: errorCode(error), message: errorMessage(error) })
    }
  }

  async broadcastRoom(roomId: string) {
    const sockets = [...(this.roomSockets.get(roomId) || [])].filter((socket) => socket.readyState === OPEN_STATE && socket.undercoverUserId)
    if (!sockets.length) return
    try {
      const states = await Promise.all(sockets.map(async (socket) => {
        const userId = socket.undercoverUserId as string
        try {
          return { socket, state: await getUndercoverRoomState(userId, roomId) }
        } catch {
          return { socket, state: await getUndercoverRoomPublicState(roomId) }
        }
      }))
      for (const item of states) safeSend(item.socket, { type: 'ROOM_STATE', state: item.state })
    } catch (error) {
      for (const socket of sockets) safeSend(socket, { type: 'ERROR', code: errorCode(error), message: errorMessage(error) })
    }
  }

  broadcastMatchState(matchId: string) {
    void this.sendMatchState(matchId)
  }

  scheduleMatch(matchId: string, deadline: string | Date | null) {
    const existing = this.matchTimers.get(matchId)
    if (existing) clearTimeout(existing)
    if (!deadline) {
      this.matchTimers.delete(matchId)
      return
    }
    const timer = setTimeout(() => {
      this.matchTimers.delete(matchId)
      void this.tickMatch(matchId)
    }, Math.max(0, new Date(deadline).getTime() - Date.now()))
    this.matchTimers.set(matchId, timer)
  }

  stopMatch(matchId: string) {
    const timer = this.matchTimers.get(matchId)
    if (timer) clearTimeout(timer)
    this.matchTimers.delete(matchId)
  }

  private async joinRoom(socket: UndercoverSocket, roomId: string) {
    const userId = this.requireUser(socket)
    const state = await enterUndercoverRoom(userId, roomId)
    this.removeFromRoom(socket)
    socket.undercoverRoomId = roomId
    this.addToMap(this.roomSockets, roomId, socket)
    safeSend(socket, { type: 'ROOM_STATE', state })
    await this.broadcastRoom(roomId)
    if (state.matchId) await this.joinMatch(socket, state.matchId)
  }

  private async joinMatch(socket: UndercoverSocket, matchId: string) {
    const userId = this.requireUser(socket)
    const snapshot = await getUndercoverMatchSnapshot(userId, matchId)
    this.removeFromMatch(socket)
    socket.undercoverMatchId = matchId
    this.addToMap(this.matchSockets, matchId, socket)
    socket.undercoverLastSeenAt = Date.now()
    await touchUndercoverPresence(userId, snapshot.roomId, matchId, new Date(socket.undercoverLastSeenAt))
    safeSend(socket, { type: 'MATCH_STATE', state: snapshot })
    this.scheduleMatch(matchId, snapshot.phaseDeadline)
    this.broadcastMatchState(matchId)
  }

  private async sendMatchState(matchId: string) {
    const sockets = [...(this.matchSockets.get(matchId) || [])].filter((socket) => socket.readyState === OPEN_STATE && socket.undercoverUserId)
    if (!sockets.length) return
    try {
      const states = await Promise.all(sockets.map(async (socket) => ({ socket, state: await getUndercoverMatchSnapshot(socket.undercoverUserId as string, matchId) })))
      for (const item of states) safeSend(item.socket, { type: 'MATCH_STATE', state: item.state })
      const first = states[0]?.state
      if (!first) return
      if (first.status === 'FINISHED') this.stopMatch(matchId)
      else this.scheduleMatch(matchId, first.phaseDeadline)
    } catch (error) {
      for (const socket of sockets) safeSend(socket, { type: 'ERROR', code: errorCode(error), message: errorMessage(error) })
    }
  }

  private async tickMatch(matchId: string) {
    try {
      await advanceExpiredUndercoverMatch(matchId)
      this.broadcastMatchState(matchId)
    } catch (error) {
      for (const socket of this.matchSockets.get(matchId) || []) safeSend(socket, { type: 'ERROR', code: errorCode(error), message: errorMessage(error) })
    }
  }

  private async touchPresence(socket: UndercoverSocket) {
    const userId = this.requireUser(socket)
    socket.undercoverLastSeenAt = Date.now()
    if (socket.undercoverRoomId) await touchUndercoverPresence(userId, socket.undercoverRoomId, socket.undercoverMatchId, new Date(socket.undercoverLastSeenAt))
  }

  private requireUser(socket: UndercoverSocket) {
    if (!socket.undercoverUserId) throw new Error('未登录的卧底巨星连接。')
    return socket.undercoverUserId
  }

  private hasMatchUserConnection(matchId: string, userId: string) {
    return [...(this.matchSockets.get(matchId) || [])].some((socket) => socket.readyState === OPEN_STATE && socket.undercoverUserId === userId)
  }

  private addToMap(map: Map<string, Set<UndercoverSocket>>, key: string, socket: UndercoverSocket) {
    const sockets = map.get(key) || new Set<UndercoverSocket>()
    sockets.add(socket)
    map.set(key, sockets)
  }

  private removeFromRoom(socket: UndercoverSocket) {
    const roomId = socket.undercoverRoomId
    if (!roomId) return
    const sockets = this.roomSockets.get(roomId)
    sockets?.delete(socket)
    if (sockets && !sockets.size) this.roomSockets.delete(roomId)
    socket.undercoverRoomId = undefined
  }

  private removeFromMatch(socket: UndercoverSocket) {
    const matchId = socket.undercoverMatchId
    if (!matchId) return
    const sockets = this.matchSockets.get(matchId)
    sockets?.delete(socket)
    if (sockets && !sockets.size) this.matchSockets.delete(matchId)
    socket.undercoverMatchId = undefined
  }
}

const globalWithUndercoverRealtime = globalThis as typeof globalThis & { __ecfcUndercoverRealtime?: UndercoverStarRealtimeHub }
export const undercoverRealtimeHub = globalWithUndercoverRealtime.__ecfcUndercoverRealtime || (() => {
  const hub = new UndercoverStarRealtimeHub()
  globalWithUndercoverRealtime.__ecfcUndercoverRealtime = hub
  return hub
})()
