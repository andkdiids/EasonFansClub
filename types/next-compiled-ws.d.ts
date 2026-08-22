declare module 'next/dist/compiled/ws' {
  import type { IncomingMessage } from 'node:http'

  type EventListener<Args extends unknown[] = unknown[]> = (...args: Args) => void

  export interface WebSocket {
    readyState: number
    send(data: string): void
    close(code?: number, reason?: string): void
    terminate(): void
    ping(): void
    on<Args extends unknown[]>(event: string, listener: EventListener<Args>): this
  }

  export const WebSocket: { OPEN: number }

  export class WebSocketServer {
    constructor(options?: Record<string, unknown>)
    on<Args extends unknown[]>(event: string, listener: EventListener<Args>): this
    emit<Args extends unknown[]>(event: string, ...args: Args): boolean
    handleUpgrade(request: IncomingMessage, socket: unknown, head: unknown, callback: (websocket: WebSocket) => void): void
    close(callback?: () => void): void
  }
}
