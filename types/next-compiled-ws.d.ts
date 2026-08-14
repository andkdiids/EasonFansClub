declare module 'next/dist/compiled/ws' {
  import type { IncomingMessage } from 'node:http'

  export interface WebSocket {
    readyState: number
    send(data: string): void
    close(code?: number, reason?: string): void
    terminate(): void
    ping(): void
    on(event: string, listener: (...args: any[]) => void): this
  }

  export const WebSocket: { OPEN: number }

  export class WebSocketServer {
    constructor(options?: Record<string, unknown>)
    on(event: string, listener: (...args: any[]) => void): this
    emit(event: string, ...args: any[]): boolean
    handleUpgrade(request: IncomingMessage, socket: unknown, head: unknown, callback: (websocket: WebSocket) => void): void
    close(callback?: () => void): void
  }
}
