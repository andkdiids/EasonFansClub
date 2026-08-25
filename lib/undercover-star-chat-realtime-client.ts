import type { UndercoverRoomMessagePublic, UndercoverRealtimeEvent } from '@/lib/undercover-star-protocol'
import { UNDERCOVER_PRESENCE_HEARTBEAT_MS } from '@/lib/undercover-star-config'

type RealtimeStatus = 'idle' | 'connecting' | 'connected' | 'disconnected'

type Options = {
  roomId: string
  fetchMessages?: (roomId: string) => Promise<UndercoverRoomMessagePublic[]>
  onChatMessage?: (message: UndercoverRoomMessagePublic) => void
  onHistory?: (messages: UndercoverRoomMessagePublic[]) => void
  onStatus?: (status: RealtimeStatus) => void
  onError?: (message: string) => void
}

const OPEN_STATE = 1
const CONNECT_TIMEOUT_MS = 6_000
const reconnectDelays = [1_000, 2_000, 4_000, 8_000, 15_000, 30_000]
const fallbackDelays = [5_000, 10_000, 15_000, 30_000]

function jitteredDelay(baseMs: number) {
  const jitter = baseMs * 0.2 * (Math.random() * 2 - 1)
  return Math.max(250, Math.round(baseMs + jitter))
}

/**
 * 卧底巨星等候聊天室实时客户端（undercover-chat）。
 *
 * 与游戏同步客户端（UndercoverStarRealtimeClient，/ws/undercover）完全独立：
 * 只负责聊天消息的实时收发，不订阅任何房间/对局状态，避免聊天流量影响游戏同步。
 */
export class UndercoverStarChatClient {
  private socket: WebSocket | null = null
  private reconnectTimer: number | null = null
  private fallbackTimer: number | null = null
  private pingTimer: number | null = null
  private connectTimer: number | null = null
  private generation = 0
  private failures = 0
  private options: Options
  private readonly resumeConnection = () => {
    if (this.generation <= 0 || this.socket?.readyState === OPEN_STATE || document.visibilityState === 'hidden') return
    if (this.reconnectTimer !== null) window.clearTimeout(this.reconnectTimer)
    this.reconnectTimer = null
    this.connect(this.generation)
  }

  constructor(options: Options) {
    this.options = options
  }

  update(options: Options) {
    this.options = { ...this.options, ...options }
  }

  start() {
    this.stop(false)
    this.generation += 1
    this.failures = 0
    window.addEventListener('online', this.resumeConnection)
    document.addEventListener('visibilitychange', this.resumeConnection)
    this.connect(this.generation)
  }

  stop(incrementGeneration = true) {
    if (incrementGeneration) this.generation += 1
    window.removeEventListener('online', this.resumeConnection)
    document.removeEventListener('visibilitychange', this.resumeConnection)
    if (this.reconnectTimer !== null) window.clearTimeout(this.reconnectTimer)
    if (this.fallbackTimer !== null) window.clearTimeout(this.fallbackTimer)
    if (this.pingTimer !== null) window.clearInterval(this.pingTimer)
    if (this.connectTimer !== null) window.clearTimeout(this.connectTimer)
    this.reconnectTimer = null
    this.fallbackTimer = null
    this.pingTimer = null
    this.connectTimer = null
    const socket = this.socket
    this.socket = null
    if (socket && socket.readyState < 2) socket.close(1000, 'client stop')
    this.options.onStatus?.('idle')
  }

  send(command: Record<string, unknown>) {
    if (this.socket?.readyState !== OPEN_STATE) return false
    this.socket.send(JSON.stringify(command))
    return true
  }

  private connect(generation: number) {
    if (generation !== this.generation || typeof window === 'undefined') return
    if (this.socket && this.socket.readyState < 2) return
    this.options.onStatus?.('connecting')
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    const socket = new WebSocket(`${protocol}//${window.location.host}/ws/undercover-chat`)
    this.socket = socket
    this.connectTimer = window.setTimeout(() => {
      if (generation !== this.generation) return
      if (socket.readyState !== OPEN_STATE) socket.close(1000, 'connect timeout')
    }, CONNECT_TIMEOUT_MS)
    socket.onopen = () => {
      if (generation !== this.generation) return
      this.clearConnectTimer()
      this.failures = 0
      this.options.onStatus?.('connected')
      this.stopFallback()
      this.send({ type: 'JOIN_ROOM_CHAT', roomId: this.options.roomId })
      this.pingTimer = window.setInterval(() => this.send({ type: 'PING' }), UNDERCOVER_PRESENCE_HEARTBEAT_MS)
      this.resync(generation)
    }
    socket.onmessage = (message) => {
      if (generation !== this.generation) return
      try {
        const event = JSON.parse(String(message.data)) as UndercoverRealtimeEvent
        this.handleEvent(event)
      } catch {
        this.options.onError?.('聊天室消息无效。')
      }
    }
    socket.onerror = () => {
      if (generation === this.generation) this.options.onStatus?.('disconnected')
    }
    socket.onclose = () => {
      if (generation !== this.generation) return
      this.clearConnectTimer()
      this.socket = null
      if (this.pingTimer !== null) window.clearInterval(this.pingTimer)
      this.pingTimer = null
      this.failures += 1
      this.options.onStatus?.('disconnected')
      this.startFallback(generation)
      const delay = reconnectDelays[Math.min(this.failures - 1, reconnectDelays.length - 1)]
      if (navigator.onLine === false || document.visibilityState === 'hidden') return
      this.reconnectTimer = window.setTimeout(() => this.connect(generation), jitteredDelay(delay))
    }
  }

  // 一次性权威历史恢复：WS 订阅可能因帧丢失/竞态未能即时生效，HTTP 拉取保证收敛。
  private resync(generation: number) {
    if (!this.options.fetchMessages) return
    void this.options.fetchMessages(this.options.roomId).then((messages) => {
      if (generation !== this.generation) return
      this.options.onHistory?.(messages)
    }).catch(() => {})
  }

  private clearConnectTimer() {
    if (this.connectTimer !== null) window.clearTimeout(this.connectTimer)
    this.connectTimer = null
  }

  private handleEvent(event: UndercoverRealtimeEvent) {
    if (event.type === 'ROOM_CHAT_MESSAGE') {
      this.options.onChatMessage?.(event.message)
      return
    }
    if (event.type === 'ERROR') this.options.onError?.(event.message)
  }

  private startFallback(generation: number) {
    if (this.fallbackTimer !== null) return
    const poll = async () => {
      if (generation !== this.generation || this.socket?.readyState === OPEN_STATE) return
      try {
        if (this.options.fetchMessages) {
          const messages = await this.options.fetchMessages(this.options.roomId)
          if (generation !== this.generation) return
          // 兜底轮询只恢复完整历史；增量去重由 onChatMessage 的 message.id 去重保证。
          this.options.onHistory?.(messages)
        }
      } catch {
        // 静默：等待下次轮询或重连。
      }
    }
    const schedule = () => {
      if (generation !== this.generation || this.socket?.readyState === OPEN_STATE || this.fallbackTimer !== null) return
      const delay = fallbackDelays[Math.min(Math.max(this.failures - 1, 0), fallbackDelays.length - 1)]
      this.fallbackTimer = window.setTimeout(() => {
        this.fallbackTimer = null
        if (generation !== this.generation || this.socket?.readyState === OPEN_STATE) return
        void poll().finally(schedule)
      }, jitteredDelay(delay))
    }
    void poll().finally(schedule)
  }

  private stopFallback() {
    if (this.fallbackTimer !== null) window.clearTimeout(this.fallbackTimer)
    this.fallbackTimer = null
  }
}
