'use client'

import { useEffect, useRef } from 'react'

const REFRESH_INTERVAL_MS = 30_000

type TopicActivityV2LotteryVisibleRefreshProps = {
  enabled: boolean
  state: string | null
  onRefresh: () => void | Promise<void>
}

/** Refresh read-only lottery state while the visible page is open. */
export function useTopicActivityV2LotteryVisibleRefresh({ enabled, state, onRefresh }: TopicActivityV2LotteryVisibleRefreshProps) {
  const refreshRef = useRef(onRefresh)

  useEffect(() => {
    refreshRef.current = onRefresh
  }, [onRefresh])

  useEffect(() => {
    if (!enabled || state === 'DRAWN') return
    let disposed = false
    let timer: ReturnType<typeof setInterval> | null = null
    const isVisible = () => typeof document === 'undefined' || document.visibilityState === 'visible'
    const refresh = () => {
      if (disposed || !isVisible()) return
      void refreshRef.current()
    }
    const schedule = () => {
      if (timer) clearInterval(timer)
      timer = isVisible() ? setInterval(refresh, REFRESH_INTERVAL_MS) : null
    }
    const onFocus = () => {
      if (isVisible()) {
        refresh()
        schedule()
      }
    }
    const onVisibilityChange = () => {
      schedule()
      if (isVisible()) refresh()
    }
    window.addEventListener('focus', onFocus)
    document.addEventListener('visibilitychange', onVisibilityChange)
    schedule()
    return () => {
      disposed = true
      if (timer) clearInterval(timer)
      window.removeEventListener('focus', onFocus)
      document.removeEventListener('visibilitychange', onVisibilityChange)
    }
  }, [enabled, state])
}
