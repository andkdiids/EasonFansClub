import type { UndercoverPublicMatchSnapshot, UndercoverRoomState, UndercoverRealtimeEvent } from '@/lib/undercover-star-protocol'
import { UNDERCOVER_PRESENCE_HEARTBEAT_MS } from '@/lib/undercover-star-config'

export type UndercoverRealtimeStatus = 'idle' | 'connecting' | 'connected' | 'reconnecting' | 'offline'

type Options = {
  roomId?: string | null
  matchId?: string | null
  fetchRoom?: (roomId: string) => Promise<UndercoverRoomState | null>
  fetchMatch?: (matchId: string) => Promise<UndercoverPublicMatchSnapshot | null>
  onRoom?: (state: UndercoverRoomState) => void
  onMatch?: (state: UndercoverPublicMatchSnapshot) => void
  onStatus?: (status: UndercoverRealtimeStatus) => void
  onError?: (message: string, code?: string) => void
  onKicked?: (payload: { roomId: string }) => void
}

const OPEN_STATE = 1
const CONNECT_TIMEOUT_MS = 6_000

export class UndercoverStarRealtimeClient {
  private socket: WebSocket | null = null
  private reconnectTimer: number | null = null
  private fallbackTimer: number | null = null
  private pingTimer: number | null = null
  private connectTimer: number | null = null
  private generation = 0
  private failures = 0
  private hadConnectionFailure = false
  private options: Options

  constructor(options: Options = {}) {
    this.options = options
  }

  update(options: Options) {
    this.options = { ...this.options, ...options }
  }

  start() {
    this.stop(false)
    this.generation += 1
    this.failures = 0
    this.hadConnectionFailure = false
    this.connect(this.generation)
  }

  stop(incrementGeneration = true) {
    if (incrementGeneration) this.generation += 1
    if (this.reconnectTimer !== null) window.clearTimeout(this.reconnectTimer)
    if (this.fallbackTimer !== null) window.clearInterval(this.fallbackTimer)
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

  /** 请求一次服务端快照；客户端永远不直接改写 phase。 */
  syncMatchState() {
    this.resync(this.generation)
  }

  private connect(generation: number) {
    if (generation !== this.generation || typeof window === 'undefined') return
    this.options.onStatus?.('connecting')
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    const socket = new WebSocket(`${protocol}//${window.location.host}/ws/undercover`)
    this.socket = socket
    // A WebSocket can sit in CONNECTING forever if a reverse proxy accepts the
    // TCP/HTTP upgrade but never completes it (onopen and onclose never fire).
    // Without this guard the client would believe it is "connecting", never
    // subscribe, never start the fallback poll, and miss every broadcast. Force
    // the socket closed so onclose runs and the fallback/reconnect path engages.
    this.connectTimer = window.setTimeout(() => {
      if (generation !== this.generation) return
      if (socket.readyState !== OPEN_STATE) socket.close(1000, 'connect timeout')
    }, CONNECT_TIMEOUT_MS)
    socket.onopen = () => {
      if (generation !== this.generation) return
      this.clearConnectTimer()
      this.failures = 0
      this.options.onStatus?.('connected')
      if (this.hadConnectionFailure) {
        console.info('[undercover.connection.recover]', JSON.stringify({ result: 'CONNECTED' }))
        this.hadConnectionFailure = false
      }
      this.stopFallback()
      if (this.options.matchId) this.send({ type: 'JOIN_MATCH', matchId: this.options.matchId })
      else if (this.options.roomId) this.send({ type: 'JOIN_ROOM', roomId: this.options.roomId })
      this.pingTimer = window.setInterval(() => this.send({ type: 'PING' }), UNDERCOVER_PRESENCE_HEARTBEAT_MS)
      this.resync(generation)
    }
    socket.onmessage = (message) => {
      if (generation !== this.generation) return
      try {
        const event = JSON.parse(String(message.data)) as UndercoverRealtimeEvent
        this.handleEvent(event)
      } catch {
        this.options.onError?.('实时同步消息无效。')
      }
    }
    socket.onerror = () => {
      if (generation === this.generation) {
        this.hadConnectionFailure = true
        this.options.onStatus?.('reconnecting')
      }
    }
    socket.onclose = () => {
      if (generation !== this.generation) return
      this.clearConnectTimer()
      this.socket = null
      if (this.pingTimer !== null) window.clearInterval(this.pingTimer)
      this.pingTimer = null
      this.failures += 1
      this.hadConnectionFailure = true
      this.options.onStatus?.(this.failures >= 3 ? 'offline' : 'reconnecting')
      this.startFallback(generation)
      const delay = Math.min(8_000, 500 * 2 ** Math.min(this.failures - 1, 4))
      this.reconnectTimer = window.setTimeout(() => this.connect(generation), delay)
    }
  }

  // One-shot authoritative snapshot on (re)connect. The JOIN_* command already
  // makes the hub send current state, but a separate HTTP read guarantees
  // convergence even if that WS frame is dropped, arrives before the socket is
  // fully subscribed, or was sent for a state the client has since moved past.
  // The onRoom/onMatch callbacks apply their own staleness guards, so a late
  // HTTP response can never clobber a newer WS snapshot.
  private resync(generation: number) {
    if (this.options.matchId && this.options.fetchMatch) {
      void this.options.fetchMatch(this.options.matchId).then((state) => {
        if (generation !== this.generation || !state) return
        this.options.onMatch?.(state)
      })
    } else if (this.options.roomId && this.options.fetchRoom) {
      void this.options.fetchRoom(this.options.roomId).then((state) => {
        if (generation !== this.generation || !state) return
        this.options.onRoom?.(state)
      })
    }
  }

  private clearConnectTimer() {
    if (this.connectTimer !== null) window.clearTimeout(this.connectTimer)
    this.connectTimer = null
  }

  private handleEvent(event: UndercoverRealtimeEvent) {
    if (event.type === 'ROOM_STATE') {
      this.options.onRoom?.(event.state)
      return
    }
    if (event.type === 'MATCH_STATE') {
      this.options.onMatch?.(event.state)
      if (event.state.status === 'FINISHED') this.stop()
      return
    }
    if (event.type === 'ERROR') this.options.onError?.(event.message, event.code)
    if (event.type === 'ROOM_KICKED') this.options.onKicked?.(event)
  }

  private startFallback(generation: number) {
    if (this.fallbackTimer !== null) return
    const poll = async () => {
      if (generation !== this.generation || this.socket?.readyState === OPEN_STATE) return
      try {
        if (this.options.matchId && this.options.fetchMatch) {
          const state = await this.options.fetchMatch(this.options.matchId)
          if (generation !== this.generation || !state) return
          this.options.onMatch?.(state)
          if (state.status === 'FINISHED') this.stop()
        } else if (this.options.roomId && this.options.fetchRoom) {
          const state = await this.options.fetchRoom(this.options.roomId)
          if (generation !== this.generation || !state) return
          this.options.onRoom?.(state)
        }
      } catch {
        this.options.onStatus?.('reconnecting')
      }
    }
    void poll()
    this.fallbackTimer = window.setInterval(() => void poll(), 3_000)
  }

  private stopFallback() {
    if (this.fallbackTimer !== null) window.clearInterval(this.fallbackTimer)
    this.fallbackTimer = null
  }
}
