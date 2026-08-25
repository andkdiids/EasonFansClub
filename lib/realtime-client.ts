'use client'

import { isRealtimeEvent, type RealtimeEvent } from '@/lib/realtime-protocol'

export type RealtimeEventSource = 'ws' | 'fallback' | 'manual'
export type RealtimeClientState = 'idle' | 'connecting' | 'open' | 'retrying' | 'fallback'

export type RealtimeClientStatus = {
  state: RealtimeClientState
  failureCount: number
  fallbackActive: boolean
}

type RealtimeClientOptions = {
  onEvent: (event: RealtimeEvent, source: RealtimeEventSource) => void
  onStatus?: (status: RealtimeClientStatus) => void
}

const reconnectDelays = [1000, 2000, 4000, 8000, 15_000, 30_000]
const fallbackIntervalMs = 90_000
const fallbackAfterFailures = 3
const reconnectJitterRatio = 0.2

function jitteredDelay(baseMs: number) {
  const jitter = baseMs * reconnectJitterRatio * (Math.random() * 2 - 1)
  return Math.max(250, Math.round(baseMs + jitter))
}

function websocketUrl() {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  return `${protocol}//${window.location.host}/ws`
}

export class RealtimeClient {
  private socket: WebSocket | null = null
  private reconnectTimer: number | null = null
  private fallbackTimer: number | null = null
  private summaryRequest: Promise<void> | null = null
  private stopped = true
  private reconnectAttempt = 0
  private failureCount = 0
  private fallbackActive = false
  private state: RealtimeClientState = 'idle'

  constructor(private readonly options: RealtimeClientOptions) {}

  start() {
    this.stopped = false
    this.connect()
  }

  stop() {
    this.stopped = true
    this.clearReconnectTimer()
    this.clearFallbackTimer()
    const socket = this.socket
    this.socket = null
    if (socket) {
      socket.onopen = null
      socket.onmessage = null
      socket.onerror = null
      socket.onclose = null
      socket.close()
    }
    this.failureCount = 0
    this.reconnectAttempt = 0
    this.fallbackActive = false
    this.setStatus('idle')
  }

  reconnectNow() {
    if (this.stopped || this.isConnected) return
    this.clearReconnectTimer()
    this.connect()
  }

  get isConnected() {
    return this.state === 'open' && this.socket?.readyState === WebSocket.OPEN
  }

  get status(): RealtimeClientStatus {
    return { state: this.state, failureCount: this.failureCount, fallbackActive: this.fallbackActive }
  }

  async requestSummary(source: RealtimeEventSource = 'manual') {
    if (this.summaryRequest) return this.summaryRequest
    this.summaryRequest = (async () => {
      try {
        const response = await fetch('/api/notifications/unread-summary', { cache: 'no-store' })
        if (!response.ok) return
        const summary = await response.json()
        const event: RealtimeEvent = {
          type: 'unread-summary',
          summary,
          changed: [],
          updatedAt: new Date().toISOString(),
        }
        if (!isRealtimeEvent(event)) return
        this.options.onEvent(event, source)
      } catch {
        // The next fallback tick or reconnect will retry the authoritative read.
      } finally {
        this.summaryRequest = null
      }
    })()
    return this.summaryRequest
  }

  private connect() {
    if (this.stopped || this.socket || this.isConnected) return
    if (typeof window.WebSocket !== 'function') {
      this.failureCount = fallbackAfterFailures
      this.activateFallback()
      return
    }
    if (navigator.onLine === false) {
      this.setStatus('retrying')
      return
    }

    this.setStatus('connecting')
    let socket: WebSocket
    try {
      socket = new window.WebSocket(websocketUrl())
    } catch {
      this.handleConnectionFailure()
      return
    }
    this.socket = socket

    socket.onopen = () => {
      if (this.socket !== socket || this.stopped) return
      this.reconnectAttempt = 0
      this.failureCount = 0
      this.disableFallback()
      this.setStatus('open')
    }
    socket.onmessage = (message) => {
      if (this.socket !== socket || this.stopped) return
      try {
        const event = JSON.parse(String(message.data)) as unknown
        if (isRealtimeEvent(event)) this.options.onEvent(event, 'ws')
      } catch {
        // Ignore the small application-level pong and malformed payloads.
      }
    }
    socket.onerror = () => {
      // onclose owns reconnect scheduling so one failed socket creates one retry.
    }
    socket.onclose = () => {
      if (this.socket !== socket) return
      this.socket = null
      if (this.stopped) return
      this.handleConnectionFailure()
    }
  }

  private handleConnectionFailure() {
    this.failureCount += 1
    if (this.failureCount >= fallbackAfterFailures) this.activateFallback()
    const delay = reconnectDelays[Math.min(this.reconnectAttempt, reconnectDelays.length - 1)]
    this.reconnectAttempt += 1
    this.setStatus(this.fallbackActive ? 'fallback' : 'retrying')
    this.clearReconnectTimer()
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return
    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = null
      this.connect()
    }, jitteredDelay(delay))
  }

  private activateFallback() {
    if (this.fallbackActive) return
    this.fallbackActive = true
    this.setStatus('fallback')
    this.scheduleFallback()
  }

  private disableFallback() {
    this.fallbackActive = false
    this.clearFallbackTimer()
  }

  private scheduleFallback() {
    if (!this.fallbackActive || this.stopped || this.fallbackTimer !== null) return
    this.fallbackTimer = window.setTimeout(() => {
      this.fallbackTimer = null
      if (this.isConnected) return
      void this.requestSummary('fallback').finally(() => this.scheduleFallback())
    }, fallbackIntervalMs)
  }

  private clearReconnectTimer() {
    if (this.reconnectTimer === null) return
    window.clearTimeout(this.reconnectTimer)
    this.reconnectTimer = null
  }

  private clearFallbackTimer() {
    if (this.fallbackTimer === null) return
    window.clearTimeout(this.fallbackTimer)
    this.fallbackTimer = null
  }

  private setStatus(state: RealtimeClientState) {
    this.state = state
    this.options.onStatus?.(this.status)
  }
}
