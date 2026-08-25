import { createServer, type IncomingMessage } from 'node:http'
import type { Duplex } from 'node:stream'
import next from 'next'
import { WebSocket as WsWebSocket, WebSocketServer, type WebSocket } from 'next/dist/compiled/ws'
import { authCookieName, getCurrentUserFromSessionToken } from './lib/auth'
import { getClientIpFromHeaders } from './lib/client-ip'
import { hasValidRequestOrigin } from './lib/security'
import { realtimeHub, realtimePublisher } from './lib/realtime'
import { duelRealtimeHub } from './lib/guess-song-duel-realtime'
import { undercoverRealtimeHub } from './lib/undercover-star-realtime'
import { undercoverChatHub } from './lib/undercover-star-chat-realtime'

const websocketPath = '/ws'
const duelWebsocketPath = '/ws/duel'
const undercoverWebsocketPath = '/ws/undercover'
const undercoverChatWebsocketPath = '/ws/undercover-chat'
const maxPayload = 4096
const maxConnectionsPerUser = 8
const maxConnectionsPerIp = 20
const maxAttemptsPerIp = 30
const attemptWindowMs = 60_000
const heartbeatIntervalMs = 30_000

type RateWindow = { startedAt: number; count: number }
type RealtimeSocket = WebSocket & { isAlive?: boolean; realtimeUserId?: string; realtimeIp?: string }

const activeConnectionsByUser = new Map<string, number>()
const activeConnectionsByIp = new Map<string, number>()
const upgradeAttemptsByIp = new Map<string, RateWindow>()
const realtimeSockets = new Set<RealtimeSocket>()

function firstHeader(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value
}

function requestIp(request: IncomingMessage) {
  return getClientIpFromHeaders(request.headers, request.socket.remoteAddress)
}

function cookieValues(request: IncomingMessage, name: string) {
  const cookieHeader = firstHeader(request.headers.cookie) || ''
  const values: string[] = []
  for (const part of cookieHeader.split(';')) {
    const separator = part.indexOf('=')
    if (separator <= 0 || part.slice(0, separator).trim() !== name) continue
    const value = part.slice(separator + 1).trim()
    try {
      values.push(decodeURIComponent(value))
    } catch {
      values.push(value)
    }
  }
  return values
}

function requestUrl(request: IncomingMessage) {
  const host = firstHeader(request.headers['x-forwarded-host']) || firstHeader(request.headers.host) || '127.0.0.1'
  const protocol = firstHeader(request.headers['x-forwarded-proto']) || 'http'
  return new URL(request.url || '/', `${protocol}://${host}`)
}

function toWebRequest(request: IncomingMessage) {
  const headers = new Headers()
  for (const [name, value] of Object.entries(request.headers)) {
    const normalized = Array.isArray(value) ? value.join(', ') : value
    if (normalized !== undefined) headers.set(name, normalized)
  }
  return new Request(requestUrl(request), { headers })
}

function rejectUpgrade(socket: Duplex, status: number, message: string) {
  socket.write(`HTTP/1.1 ${status} ${message}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`)
  socket.destroy()
}

function isUpgradeAllowed(ip: string) {
  const now = Date.now()
  const window = upgradeAttemptsByIp.get(ip)
  if (!window || now - window.startedAt >= attemptWindowMs) {
    upgradeAttemptsByIp.set(ip, { startedAt: now, count: 1 })
    return true
  }
  window.count += 1
  return window.count <= maxAttemptsPerIp
}

function increment(map: Map<string, number>, key: string) {
  map.set(key, (map.get(key) || 0) + 1)
}

function decrement(map: Map<string, number>, key: string) {
  const next = (map.get(key) || 1) - 1
  if (next > 0) map.set(key, next)
  else map.delete(key)
}

function parsePort() {
  const flagIndex = process.argv.findIndex((argument) => argument === '-p' || argument === '--port')
  const cliPort = flagIndex >= 0 ? process.argv[flagIndex + 1] : undefined
  const parsed = Number(cliPort || process.env.PORT || 3000)
  return Number.isInteger(parsed) && parsed > 0 && parsed < 65_536 ? parsed : 3000
}

async function authorizeUpgrade(request: IncomingMessage, socket: Duplex) {
  const url = requestUrl(request)
  if (url.pathname !== websocketPath && url.pathname !== duelWebsocketPath && url.pathname !== undercoverWebsocketPath && url.pathname !== undercoverChatWebsocketPath) {
    rejectUpgrade(socket, 404, 'Not Found')
    return null
  }

  const ip = requestIp(request)
  if (!isUpgradeAllowed(ip)) {
    rejectUpgrade(socket, 429, 'Too Many Requests')
    return null
  }

  if (!hasValidRequestOrigin(toWebRequest(request))) {
    rejectUpgrade(socket, 403, 'Forbidden')
    return null
  }

  if ((activeConnectionsByIp.get(ip) || 0) >= maxConnectionsPerIp) {
    rejectUpgrade(socket, 429, 'Too Many Requests')
    return null
  }

  const tokens = cookieValues(request, authCookieName)
  if (!tokens.length) {
    rejectUpgrade(socket, 401, 'Unauthorized')
    return null
  }

  try {
    let user: Awaited<ReturnType<typeof getCurrentUserFromSessionToken>> = null
    let authUnavailable = false
    for (const token of tokens) {
      try {
        user = await getCurrentUserFromSessionToken(token)
        if (user) break
      } catch {
        // A stale duplicate cookie must not hide a valid later cookie. Keep
        // service failures distinct from an actually unauthenticated socket.
        authUnavailable = true
      }
    }
    if (!user) {
      rejectUpgrade(socket, authUnavailable ? 503 : 401, authUnavailable ? 'Service Unavailable' : 'Unauthorized')
      return null
    }
    if ((activeConnectionsByUser.get(user.id) || 0) >= maxConnectionsPerUser) {
      rejectUpgrade(socket, 429, 'Too Many Requests')
      return null
    }
    return { user, ip, channel: url.pathname === duelWebsocketPath ? 'duel' as const : url.pathname === undercoverWebsocketPath ? 'undercover' as const : url.pathname === undercoverChatWebsocketPath ? 'undercover-chat' as const : 'summary' as const }
  } catch (error) {
    console.error('[realtime.authorize]', error)
    rejectUpgrade(socket, 503, 'Service Unavailable')
    return null
  }
}

async function start() {
  const dev = process.env.NODE_ENV === 'development'
  const port = parsePort()
  const hostname = process.env.HOST || '127.0.0.1'
  const app = next({ dev, hostname, port })
  const handle = app.getRequestHandler()
  await app.prepare()

  const server = createServer((request, response) => {
    void handle(request, response)
  })
  const websocketServer = new WebSocketServer({
    noServer: true,
    clientTracking: false,
    maxPayload,
    perMessageDeflate: false,
  })

  websocketServer.on('connection', (socket: RealtimeSocket, request: IncomingMessage, auth: { user: { id: string }; ip: string; channel: 'summary' | 'duel' | 'undercover' | 'undercover-chat' }) => {
    const { user, ip } = auth
    socket.isAlive = true
    socket.realtimeUserId = user.id
    socket.realtimeIp = ip
    realtimeSockets.add(socket)
    increment(activeConnectionsByUser, user.id)
    increment(activeConnectionsByIp, ip)
    let closed = false

    const removeFromHub = auth.channel === 'summary'
      ? realtimeHub.add(user.id, socket)
      : auth.channel === 'duel'
        ? () => duelRealtimeHub.detach(socket)
        : auth.channel === 'undercover-chat'
          ? () => undercoverChatHub.detach(socket)
          : () => undercoverRealtimeHub.detach(socket)
    if (auth.channel === 'duel') duelRealtimeHub.attach(user.id, socket)
    if (auth.channel === 'undercover') undercoverRealtimeHub.attach(user.id, socket)
    if (auth.channel === 'undercover-chat') undercoverChatHub.attach(user.id, socket)

    const cleanup = () => {
      if (closed) return
      closed = true
      realtimeSockets.delete(socket)
      removeFromHub()
      decrement(activeConnectionsByUser, user.id)
      decrement(activeConnectionsByIp, ip)
    }

    socket.on('pong', () => { socket.isAlive = true })
    socket.on('message', (data: Buffer | string) => {
      const payload = String(data)
      if (payload === 'ping') {
        if (socket.readyState === WsWebSocket.OPEN) socket.send('pong')
        return
      }
      if (auth.channel === 'duel') {
        void duelRealtimeHub.handleMessage(socket, data)
        return
      }
      if (auth.channel === 'undercover') {
        void undercoverRealtimeHub.handleMessage(socket, data)
        return
      }
      if (auth.channel === 'undercover-chat') {
        void undercoverChatHub.handleMessage(socket, data)
        return
      }
      socket.close(1008, 'read-only realtime channel')
    })
    socket.on('close', cleanup)
    socket.on('error', cleanup)

    if (auth.channel !== 'summary') return
    void realtimePublisher.sendInitial(user.id, socket).catch((error) => {
      console.error('[realtime.initial-summary]', error)
      socket.close(1011, 'summary unavailable')
    })
  })

  server.on('upgrade', (request, socket, head) => {
    void authorizeUpgrade(request, socket).then((auth) => {
      if (!auth) return
      websocketServer.handleUpgrade(request, socket, head, (websocket) => {
        websocketServer.emit('connection', websocket, request, auth)
      })
    }).catch((error) => {
      console.error('[realtime.upgrade]', error)
      rejectUpgrade(socket, 503, 'Service Unavailable')
    })
  })

  const heartbeat = setInterval(() => {
    for (const socket of realtimeSockets) {
      if (socket.isAlive === false) {
        socket.terminate()
        continue
      }
      socket.isAlive = false
      socket.ping()
    }
  }, heartbeatIntervalMs)

  const shutdown = () => {
    clearInterval(heartbeat)
    for (const socket of realtimeSockets) socket.close(1001, 'server shutdown')
    websocketServer.close()
    server.close()
  }
  process.once('SIGTERM', shutdown)
  process.once('SIGINT', shutdown)

  server.listen(port, hostname, () => {
    console.log(`[ecfc] Next + realtime server listening on http://${hostname}:${port}`)
  })
}

void start().catch((error) => {
  console.error('[ecfc.server]', error)
  process.exitCode = 1
})
