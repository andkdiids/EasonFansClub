'use client'

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { RealtimeClient, type RealtimeClientStatus, type RealtimeEventSource } from '@/lib/realtime-client'
import { isRealtimeEvent, type RealtimeEvent } from '@/lib/realtime-protocol'
import type { UnreadSummary } from '@/lib/notifications'

const emptySummary: UnreadSummary = {
  notifications: 0,
  system: 0,
  replies: 0,
  likes: 0,
  wall: 0,
  feedbackReplies: 0,
  feedback: 0,
  friendRequests: 0,
  directMessages: 0,
  messages: 0,
  review: 0,
  total: 0,
}

const unreadSummaryKeys: Array<keyof UnreadSummary> = [
  'notifications',
  'system',
  'replies',
  'likes',
  'feedbackReplies',
  'feedback',
  'friendRequests',
  'directMessages',
  'messages',
  'review',
  'total',
]

function isUnreadSummary(value: unknown): value is UnreadSummary {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Record<string, unknown>
  return unreadSummaryKeys.every((key) => {
    const count = candidate[key]
    return typeof count === 'number' && Number.isFinite(count) && count >= 0
  })
}

const tabPresenceIntervalMs = 5000
const tabPresenceTimeoutMs = 15_000

type NotificationContextValue = {
  summary: UnreadSummary
  summaryAvailable: boolean
  updateSummary: (updater: (current: UnreadSummary) => UnreadSummary) => void
  refresh: () => Promise<void>
  realtimeStatus: RealtimeClientStatus
}

type RealtimeBrowserEvent = RealtimeEvent & {
  source: RealtimeEventSource
}

type RealtimeCoordinationMessage = {
  kind: 'presence' | 'event' | 'status' | 'refresh'
  tabId: string
  event?: RealtimeEvent
  source?: RealtimeEventSource
  status?: RealtimeClientStatus
}

const initialStatus: RealtimeClientStatus = { state: 'idle', failureCount: 0, fallbackActive: false }
const NotificationContext = createContext<NotificationContextValue | null>(null)

function createTabId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`
}

export function NotificationProvider({
  children,
  userId,
  initialSummary,
}: {
  children: ReactNode
  userId: string | null
  initialSummary: UnreadSummary | null
}) {
  const [summary, setSummary] = useState(initialSummary || emptySummary)
  const [summaryAvailable, setSummaryAvailable] = useState(initialSummary !== null)
  const [realtimeStatus, setRealtimeStatus] = useState<RealtimeClientStatus>(initialStatus)
  const tabIdRef = useRef('')
  const initialSummaryRef = useRef<UnreadSummary | null>(initialSummary)
  const latestRealtimeAtRef = useRef(0)
  const summaryRefreshRef = useRef<Promise<void> | null>(null)

  useEffect(() => {
    initialSummaryRef.current = initialSummary
  }, [initialSummary])

  useEffect(() => {
    if (!userId) {
      setSummary(emptySummary)
      setSummaryAvailable(false)
      return
    }
    setSummary(initialSummaryRef.current || emptySummary)
    setSummaryAvailable(initialSummaryRef.current !== null)
  }, [userId])

  useEffect(() => {
    if (!userId) {
      setRealtimeStatus(initialStatus)
      return
    }

    const tabId = tabIdRef.current || (tabIdRef.current = createTabId())
    const realtimeChannel = 'BroadcastChannel' in window
      ? new BroadcastChannel(`eason-realtime:${userId}`)
      : null
    const privateChannel = 'BroadcastChannel' in window
      ? new BroadcastChannel(`eason-private-sync:${userId}`)
      : null
    const peers = new Map<string, number>([[tabId, Date.now()]])
    let leaderId = ''
    let isLeader = !realtimeChannel
    let presenceTimer: number | null = null

    const post = (message: RealtimeCoordinationMessage) => realtimeChannel?.postMessage(message)
    const announcePresence = () => {
      peers.set(tabId, Date.now())
      post({ kind: 'presence', tabId })
    }

    const applyEvent = (event: RealtimeEvent, source: RealtimeEventSource) => {
      const eventTime = Date.parse(event.updatedAt)
      if (Number.isFinite(eventTime) && eventTime < latestRealtimeAtRef.current) return
      if (Number.isFinite(eventTime)) latestRealtimeAtRef.current = eventTime
      if (event.type === 'unread-summary') {
        setSummary(event.summary)
        setSummaryAvailable(true)
      }
      window.dispatchEvent(new CustomEvent<RealtimeBrowserEvent>('realtime:event', {
        detail: { ...event, source },
      }))
    }

    const client = new RealtimeClient({
      onEvent: (event, source) => {
        applyEvent(event, source)
        if (isLeader) post({ kind: 'event', tabId, event, source })
      },
      onStatus: (status) => {
        if (isLeader) post({ kind: 'status', tabId, status })
        setRealtimeStatus(status)
      },
    })

    const updateLeadership = () => {
      const now = Date.now()
      for (const [peerId, lastSeenAt] of peers) {
        if (peerId !== tabId && now - lastSeenAt > tabPresenceTimeoutMs) peers.delete(peerId)
      }
      const nextLeaderId = Array.from(peers.keys()).sort()[0] || tabId
      if (nextLeaderId === leaderId) return
      leaderId = nextLeaderId
      isLeader = leaderId === tabId
      if (isLeader) client.start()
      else client.stop()
    }

    const onRealtimeMessage = (message: MessageEvent<RealtimeCoordinationMessage>) => {
      const data = message.data
      if (!data || data.tabId === tabId) return
      if (data.kind === 'presence') {
        peers.set(data.tabId, Date.now())
        updateLeadership()
        return
      }
      if (data.kind === 'event' && data.event && isRealtimeEvent(data.event)) {
        if (data.source) applyEvent(data.event, data.source)
        return
      }
      if (data.kind === 'status' && data.tabId === leaderId && data.status) {
        setRealtimeStatus(data.status)
        return
      }
      if (data.kind === 'refresh' && isLeader && !client.isConnected) {
        void client.requestSummary('manual')
      }
    }

    const startIfLeader = () => {
      if (isLeader) client.start()
    }

    const refresh = async () => {
      if (!userId) return
      if (client.isConnected) return
      if (!isLeader) {
        post({ kind: 'refresh', tabId })
        return
      }
      await client.requestSummary('manual')
    }

    const onVisibilityChange = () => {
      announcePresence()
      if (document.visibilityState === 'visible' && isLeader) client.reconnectNow()
    }
    const onOnline = () => {
      if (isLeader) client.reconnectNow()
    }
    const onLocalRefresh = () => void refresh()

    realtimeChannel?.addEventListener('message', onRealtimeMessage)
    if (privateChannel) {
      privateChannel.onmessage = (event) => {
        if (event.data?.type === 'logout' && event.data?.userId === userId) {
          client.stop()
          setSummary(emptySummary)
          window.location.reload()
          return
        }
        void refresh()
      }
    }
    window.addEventListener('unread-summary:refresh', onLocalRefresh)
    document.addEventListener('visibilitychange', onVisibilityChange)
    window.addEventListener('online', onOnline)

    announcePresence()
    updateLeadership()
    startIfLeader()
    presenceTimer = window.setInterval(() => {
      announcePresence()
      updateLeadership()
    }, tabPresenceIntervalMs)

    return () => {
      if (presenceTimer !== null) window.clearInterval(presenceTimer)
      client.stop()
      realtimeChannel?.removeEventListener('message', onRealtimeMessage)
      realtimeChannel?.close()
      privateChannel?.close()
      window.removeEventListener('unread-summary:refresh', onLocalRefresh)
      document.removeEventListener('visibilitychange', onVisibilityChange)
      window.removeEventListener('online', onOnline)
    }
  }, [userId])

  const refresh = useCallback(async () => {
    if (!userId) return

    const inFlight = summaryRefreshRef.current
    if (inFlight) {
      await inFlight
      return
    }

    const request = (async () => {
      try {
        const response = await fetch('/api/notifications/unread-summary', {
          cache: 'no-store',
          headers: { Accept: 'application/json' },
        })
        if (!response.ok) return

        const nextSummary: unknown = await response.json()
        if (isUnreadSummary(nextSummary)) {
          setSummary(nextSummary)
          setSummaryAvailable(true)
        }
      } catch {
        // 保留最近一次成功统计，不能把请求失败误显示成 0 条未读。
      }
    })()
    summaryRefreshRef.current = request
    try {
      await request
    } finally {
      if (summaryRefreshRef.current === request) summaryRefreshRef.current = null
    }
  }, [userId])

  const updateSummary = useCallback((updater: (current: UnreadSummary) => UnreadSummary) => {
    setSummary((current) => updater(current))
  }, [])

  const value = useMemo(() => ({ summary, summaryAvailable, updateSummary, refresh, realtimeStatus }), [realtimeStatus, refresh, summary, summaryAvailable, updateSummary])
  return <NotificationContext.Provider value={value}>{children}</NotificationContext.Provider>
}

export function useNotificationSummary() {
  const context = useContext(NotificationContext)
  if (!context) throw new Error('useNotificationSummary must be used within NotificationProvider')
  return context
}
