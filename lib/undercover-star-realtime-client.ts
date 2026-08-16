import type { UndercoverPublicMatchSnapshot, UndercoverRoomState, UndercoverRealtimeEvent } from '@/lib/undercover-star-protocol'

type RealtimeStatus = 'idle' | 'connecting' | 'connected' | 'disconnected'

type Options = {
  roomId?: string | null
  matchId?: string | null
  fetchRoom?: (roomId: string) => Promise<UndercoverRoomState | null>
  fetchMatch?: (matchId: string) => Promise<UndercoverPublicMatchSnapshot | null>
  onRoom?: (state: UndercoverRoomState) => void
  onMatch?: (state: UndercoverPublicMatchSnapshot) => void
  onStatus?: (status: RealtimeStatus) => void
  onError?: (message: string) => void
}

const OPEN_STATE = 1

export class UndercoverStarRealtimeClient {
  private socket: WebSocket | null = null
  private reconnectTimer: number | null = null
  private fallbackTimer: number | null = null
  private pingTimer: number | null = null
  private generation = 0
  private failures = 0
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
    this.connect(this.generation)
  }

  stop(incrementGeneration = true) {
    if (incrementGeneration) this.generation += 1
    if (this.reconnectTimer !== null) window.clearTimeout(this.reconnectTimer)
    if (this.fallbackTimer !== null) window.clearInterval(this.fallbackTimer)
    if (this.pingTimer !== null) window.clearInterval(this.pingTimer)
    this.reconnectTimer = null
    this.fallbackTimer = null
    this.pingTimer = null
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
    this.options.onStatus?.('connecting')
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    const socket = new WebSocket(`${protocol}//${window.location.host}/ws/undercover`)
    this.socket = socket
    socket.onopen = () => {
      if (generation !== this.generation) return
      this.failures = 0
      this.options.onStatus?.('connected')
      this.stopFallback()
      if (this.options.matchId) this.send({ type: 'JOIN_MATCH', matchId: this.options.matchId })
      else if (this.options.roomId) this.send({ type: 'JOIN_ROOM', roomId: this.options.roomId })
      this.pingTimer = window.setInterval(() => this.send({ type: 'PING' }), 25_000)
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
      if (generation === this.generation) this.options.onStatus?.('disconnected')
    }
    socket.onclose = () => {
      if (generation !== this.generation) return
      this.socket = null
      if (this.pingTimer !== null) window.clearInterval(this.pingTimer)
      this.pingTimer = null
      this.failures += 1
      this.options.onStatus?.('disconnected')
      this.startFallback(generation)
      const delay = Math.min(8_000, 500 * 2 ** Math.min(this.failures - 1, 4))
      this.reconnectTimer = window.setTimeout(() => this.connect(generation), delay)
    }
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
    if (event.type === 'ERROR') this.options.onError?.(event.message)
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
      } catch (error) {
        this.options.onError?.(error instanceof Error ? error.message : '恢复对局状态失败。')
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
