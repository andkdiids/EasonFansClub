declare module 'next/dist/compiled/ws' {
  import type { IncomingMessage } from 'node:http'
  import type { Duplex } from 'node:stream'
  import { EventEmitter } from 'node:events'

  export class WebSocket extends EventEmitter {
    static readonly OPEN: number
    readyState: number
    send(data: string): void
    ping(): void
    close(code?: number, reason?: string): void
    terminate(): void
  }

  export class WebSocketServer extends EventEmitter {
    constructor(options?: {
      noServer?: boolean
      clientTracking?: boolean
      maxPayload?: number
      perMessageDeflate?: boolean
    })
    handleUpgrade(request: IncomingMessage, socket: Duplex, head: Buffer, callback: (socket: WebSocket) => void): void
    close(callback?: (error?: Error) => void): void
  }
}
