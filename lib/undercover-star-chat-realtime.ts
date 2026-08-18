import type { WebSocket } from 'next/dist/compiled/ws'
import { enterUndercoverRoom } from '@/lib/undercover-star'
import type { UndercoverClientChatCommand, UndercoverRealtimeEvent, UndercoverRoomMessagePublic } from '@/lib/undercover-star-protocol'

const OPEN_STATE = 1
const MAX_COMMAND_BYTES = 16_384

type ChatSocket = WebSocket & {
  undercoverUserId?: string
  undercoverRoomId?: string
}

function safeSend(socket: ChatSocket, event: UndercoverRealtimeEvent) {
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
  return '卧底巨星聊天室连接失败。'
}

function errorCode(error: unknown) {
  if (error && typeof error === 'object' && 'code' in error && typeof error.code === 'string') return error.code
  return 'UNDERCOVER_CHAT_ERROR'
}

function parseCommand(data: Buffer | string): UndercoverClientChatCommand | null {
  const text = String(data)
  if (Buffer.byteLength(text, 'utf8') > MAX_COMMAND_BYTES) return null
  try {
    const value = JSON.parse(text) as unknown
    if (!value || typeof value !== 'object' || Array.isArray(value) || typeof (value as { type?: unknown }).type !== 'string') return null
    return value as UndercoverClientChatCommand
  } catch {
    return null
  }
}

/**
 * 卧底巨星等候聊天室实时频道（undercover-chat）。
 *
 * 与游戏同步频道 undercover-realtime（/ws/undercover）完全隔离：聊天消息只在此频道
 * 流动，绝不影响房间/对局状态。每个房间一个独立订阅集合，消息按 roomId 完全隔离。
 */
export class UndercoverStarChatHub {
  private readonly sockets = new Set<ChatSocket>()
  private readonly roomSockets = new Map<string, Set<ChatSocket>>()

  attach(userId: string, socket: ChatSocket) {
    socket.undercoverUserId = userId
    this.sockets.add(socket)
    safeSend(socket, { type: 'SERVER_HELLO', serverNow: new Date().toISOString() })
    return () => this.detach(socket)
  }

  detach(socket: ChatSocket) {
    this.sockets.delete(socket)
    this.removeFromRoom(socket)
  }

  async handleMessage(socket: ChatSocket, data: Buffer | string) {
    const command = parseCommand(data)
    if (!command) {
      safeSend(socket, { type: 'ERROR', code: 'COMMAND_INVALID', message: '无效的聊天指令。' })
      return
    }
    try {
      if (command.type === 'JOIN_ROOM_CHAT' || command.type === 'SYNC_ROOM_CHAT') {
        await this.joinRoom(socket, command.roomId)
        return
      }
      if (command.type === 'PING') {
        safeSend(socket, { type: 'PONG', serverNow: new Date().toISOString() })
        return
      }
      safeSend(socket, { type: 'ERROR', code: 'COMMAND_UNSUPPORTED', message: '不支持的聊天指令。' })
    } catch (error) {
      safeSend(socket, { type: 'ERROR', code: errorCode(error), message: errorMessage(error) })
    }
  }

  /** 仅向当前房间在线成员广播一条聊天消息（best-effort）。 */
  broadcastRoomChat(roomId: string, message: UndercoverRoomMessagePublic) {
    const sockets = this.roomSockets.get(roomId)
    if (!sockets) return
    for (const socket of [...sockets]) {
      if (socket.readyState === OPEN_STATE && socket.undercoverUserId) safeSend(socket, { type: 'ROOM_CHAT_MESSAGE', message })
    }
  }

  private async joinRoom(socket: ChatSocket, roomId: string) {
    const userId = this.requireUser(socket)
    // 复用 enterUndercoverRoom 校验成员关系并顺便续活房间；非成员/过期房间会抛错拒绝订阅。
    await enterUndercoverRoom(userId, roomId)
    this.removeFromRoom(socket)
    socket.undercoverRoomId = roomId
    this.addToMap(this.roomSockets, roomId, socket)
  }

  private requireUser(socket: ChatSocket) {
    if (!socket.undercoverUserId) throw new Error('未登录的卧底巨星聊天连接。')
    return socket.undercoverUserId
  }

  private addToMap(map: Map<string, Set<ChatSocket>>, key: string, socket: ChatSocket) {
    const sockets = map.get(key) || new Set<ChatSocket>()
    sockets.add(socket)
    map.set(key, sockets)
  }

  private removeFromRoom(socket: ChatSocket) {
    const roomId = socket.undercoverRoomId
    if (!roomId) return
    const sockets = this.roomSockets.get(roomId)
    sockets?.delete(socket)
    if (sockets && !sockets.size) this.roomSockets.delete(roomId)
    socket.undercoverRoomId = undefined
  }
}

const globalWithUndercoverChat = globalThis as typeof globalThis & { __ecfcUndercoverChat?: UndercoverStarChatHub }
export const undercoverChatHub = globalWithUndercoverChat.__ecfcUndercoverChat || (() => {
  const hub = new UndercoverStarChatHub()
  globalWithUndercoverChat.__ecfcUndercoverChat = hub
  return hub
})()
