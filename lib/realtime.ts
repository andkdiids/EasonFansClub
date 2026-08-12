import { getUnreadSummary, type UnreadSummary } from '@/lib/notifications'
import { prisma } from '@/lib/prisma'
import type { RealtimeChange, RealtimeEvent } from '@/lib/realtime-protocol'

export type RealtimeSocket = {
  readyState: number
  send: (data: string) => void
  close?: (code?: number, reason?: string) => void
}

const OPEN_STATE = 1
const REALTIME_DEBOUNCE_MS = 650
const REALTIME_MAX_WAIT_MS = 2500

type PendingRealtimeUpdate = {
  changes: Set<RealtimeChange>
  conversationIds: Set<string>
  feedbackIds: Set<string>
  requestIds: Set<string>
  debounceTimer: ReturnType<typeof setTimeout> | null
  maxWaitTimer: ReturnType<typeof setTimeout> | null
}

function createPendingUpdate(): PendingRealtimeUpdate {
  return {
    changes: new Set(),
    conversationIds: new Set(),
    feedbackIds: new Set(),
    requestIds: new Set(),
    debounceTimer: null,
    maxWaitTimer: null,
  }
}

function safeSend(socket: RealtimeSocket, event: RealtimeEvent) {
  if (socket.readyState !== OPEN_STATE) return false
  try {
    socket.send(JSON.stringify(event))
    return true
  } catch {
    return false
  }
}

export class RealtimeHub {
  private readonly connections = new Map<string, Set<RealtimeSocket>>()

  add(userId: string, socket: RealtimeSocket) {
    const userConnections = this.connections.get(userId) || new Set<RealtimeSocket>()
    userConnections.add(socket)
    this.connections.set(userId, userConnections)
    return () => this.remove(userId, socket)
  }

  remove(userId: string, socket: RealtimeSocket) {
    const userConnections = this.connections.get(userId)
    if (!userConnections) return
    userConnections.delete(socket)
    if (!userConnections.size) this.connections.delete(userId)
  }

  publish(userId: string, event: RealtimeEvent) {
    const userConnections = this.connections.get(userId)
    if (!userConnections) return 0
    let sent = 0
    for (const socket of userConnections) {
      if (safeSend(socket, event)) {
        sent += 1
      } else {
        userConnections.delete(socket)
      }
    }
    if (!userConnections.size) this.connections.delete(userId)
    return sent
  }

  broadcast(event: RealtimeEvent) {
    let sent = 0
    for (const userId of this.connections.keys()) sent += this.publish(userId, event)
    return sent
  }

  getUserIds() {
    return Array.from(this.connections.keys())
  }

  getConnectionCount(userId?: string) {
    if (userId) return this.connections.get(userId)?.size || 0
    return Array.from(this.connections.values()).reduce((total, sockets) => total + sockets.size, 0)
  }
}

export class RealtimePublisher {
  private readonly pending = new Map<string, PendingRealtimeUpdate>()

  constructor(
    private readonly hub: RealtimeHub,
    private readonly loadSummary: (userId: string) => Promise<UnreadSummary> = getUnreadSummary,
  ) {}

  emit(userId: string, change: RealtimeChange, detail: { conversationId?: string; feedbackId?: string; requestId?: string } = {}) {
    if (!userId || !this.hub.getConnectionCount(userId)) return
    const pending = this.pending.get(userId) || createPendingUpdate()
    pending.changes.add(change)
    if (detail.conversationId) pending.conversationIds.add(detail.conversationId)
    if (detail.feedbackId) pending.feedbackIds.add(detail.feedbackId)
    if (detail.requestId) pending.requestIds.add(detail.requestId)
    this.pending.set(userId, pending)

    if (!pending.debounceTimer) {
      pending.debounceTimer = setTimeout(() => void this.flush(userId), REALTIME_DEBOUNCE_MS)
    }
    if (!pending.maxWaitTimer) {
      pending.maxWaitTimer = setTimeout(() => void this.flush(userId), REALTIME_MAX_WAIT_MS)
    }
  }

  emitMany(userIds: Iterable<string>, change: RealtimeChange, detail: { conversationId?: string; feedbackId?: string; requestId?: string } = {}) {
    for (const userId of new Set(userIds)) this.emit(userId, change, detail)
  }

  async sendInitial(userId: string, socket: RealtimeSocket) {
    const summary = await this.loadSummary(userId)
    return safeSend(socket, {
      type: 'unread-summary',
      summary,
      changed: [],
      updatedAt: new Date().toISOString(),
      initial: true,
    })
  }

  broadcastChange(change: RealtimeChange) {
    for (const userId of this.hub.getUserIds()) this.emit(userId, change)
  }

  private async flush(userId: string) {
    const pending = this.pending.get(userId)
    if (!pending) return
    this.pending.delete(userId)
    if (pending.debounceTimer) clearTimeout(pending.debounceTimer)
    if (pending.maxWaitTimer) clearTimeout(pending.maxWaitTimer)
    if (!this.hub.getConnectionCount(userId)) return

    try {
      const summary = await this.loadSummary(userId)
      this.hub.publish(userId, {
        type: 'unread-summary',
        summary,
        changed: Array.from(pending.changes),
        conversationIds: Array.from(pending.conversationIds),
        feedbackIds: Array.from(pending.feedbackIds),
        requestIds: Array.from(pending.requestIds),
        updatedAt: new Date().toISOString(),
      })
    } catch (error) {
      // The HTTP API remains the fallback source of truth. A failed summary
      // read must not make a successful business write fail.
      console.error('[realtime.summary]', error)
    }
  }
}

type RealtimeGlobalState = {
  hub: RealtimeHub
  publisher: RealtimePublisher
}

const globalWithRealtime = globalThis as typeof globalThis & { __ecfcRealtime?: RealtimeGlobalState }
const realtimeState = globalWithRealtime.__ecfcRealtime || (() => {
  const hub = new RealtimeHub()
  const publisher = new RealtimePublisher(hub)
  const state = { hub, publisher }
  globalWithRealtime.__ecfcRealtime = state
  return state
})()

export const realtimeHub = realtimeState.hub
export const realtimePublisher = realtimeState.publisher

export function emitRealtime(userId: string, change: RealtimeChange, detail?: { conversationId?: string; feedbackId?: string; requestId?: string }) {
  realtimePublisher.emit(userId, change, detail)
}

export function emitRealtimeMany(userIds: Iterable<string>, change: RealtimeChange, detail?: { conversationId?: string; feedbackId?: string; requestId?: string }) {
  realtimePublisher.emitMany(userIds, change, detail)
}

export function broadcastRealtimeChange(change: RealtimeChange) {
  realtimePublisher.broadcastChange(change)
}

export async function emitRealtimeToAdmins(change: RealtimeChange, detail?: { conversationId?: string; feedbackId?: string; requestId?: string }) {
  const administrators = await prisma.user.findMany({
    where: { role: { in: ['ADMIN', 'SUPER_ADMIN'] }, status: 'ACTIVE', isDeleted: false },
    select: { id: true },
  })
  emitRealtimeMany(administrators.map((administrator) => administrator.id), change, detail)
}
