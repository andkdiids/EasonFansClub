'use client'

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { UnreadSummary } from '@/lib/notifications'

const POLL_INTERVAL_MS = 30_000

type NotificationContextValue = {
  summary: UnreadSummary
  refresh: () => Promise<void>
}

const NotificationContext = createContext<NotificationContextValue | null>(null)

export function NotificationProvider({
  children,
  userId,
  initialSummary,
}: {
  children: ReactNode
  userId: string | null
  initialSummary: UnreadSummary
}) {
  const [summary, setSummary] = useState(initialSummary)
  const requestRef = useRef<Promise<void> | null>(null)
  const controllerRef = useRef<AbortController | null>(null)

  const refresh = useCallback(() => {
    if (!userId || document.visibilityState !== 'visible') return Promise.resolve()
    if (requestRef.current) return requestRef.current

    const request = (async () => {
      const controller = new AbortController()
      controllerRef.current = controller
      if (process.env.NODE_ENV === 'development') console.debug('[notification poll]', Date.now())
      try {
        const response = await fetch('/api/notifications/unread-summary', {
          cache: 'no-store',
          signal: controller.signal,
        })
        if (!response.ok) return
        const next = await response.json() as UnreadSummary
        if (typeof next.total === 'number') setSummary(next)
      } catch {
        // A cancelled or temporarily unavailable refresh must not create another poller.
      } finally {
        if (controllerRef.current === controller) controllerRef.current = null
      }
    })()

    requestRef.current = request
    void request.finally(() => {
      if (requestRef.current === request) requestRef.current = null
    })
    return request
  }, [userId])

  useEffect(() => {
    setSummary(initialSummary)
  }, [initialSummary])

  useEffect(() => {
    if (!userId) return
    let timer: number | null = null
    const stopPolling = () => {
      if (timer === null) return
      window.clearInterval(timer)
      timer = null
    }
    const startPolling = () => {
      if (timer !== null || document.visibilityState !== 'visible') return
      timer = window.setInterval(() => void refresh(), POLL_INTERVAL_MS)
    }
    const onVisibilityChange = () => {
      if (document.visibilityState !== 'visible') {
        stopPolling()
        return
      }
      startPolling()
      void refresh()
    }
    const onRefresh = () => void refresh()
    const channel = 'BroadcastChannel' in window
      ? new BroadcastChannel(`eason-private-sync:${userId}`)
      : null
    if (channel) {
      channel.onmessage = (event) => {
        if (event.data?.userId !== userId) return
        if (event.data?.type === 'logout') {
          window.location.reload()
          return
        }
        void refresh()
      }
    }

    void refresh()
    startPolling()
    window.addEventListener('unread-summary:refresh', onRefresh)
    document.addEventListener('visibilitychange', onVisibilityChange)
    return () => {
      controllerRef.current?.abort()
      channel?.close()
      stopPolling()
      window.removeEventListener('unread-summary:refresh', onRefresh)
      document.removeEventListener('visibilitychange', onVisibilityChange)
    }
  }, [refresh, userId])

  const value = useMemo(() => ({ summary, refresh }), [refresh, summary])
  return <NotificationContext.Provider value={value}>{children}</NotificationContext.Provider>
}

export function useNotificationSummary() {
  const context = useContext(NotificationContext)
  if (!context) throw new Error('useNotificationSummary must be used within NotificationProvider')
  return context
}
