'use client'

import { useEffect, useState } from 'react'

export function useServerClock(serverNow: string, refreshEveryMs = 1_000) {
  const [now, setNow] = useState(() => {
    const parsed = Date.parse(serverNow)
    return Number.isFinite(parsed) ? parsed : 0
  })

  useEffect(() => {
    const serverTimestamp = Date.parse(serverNow)
    if (!Number.isFinite(serverTimestamp)) {
      setNow(0)
      return
    }

    const monotonicStart = performance.now()
    setNow(serverTimestamp)
    const timer = window.setInterval(() => {
      setNow(serverTimestamp + Math.max(0, performance.now() - monotonicStart))
    }, Math.max(250, refreshEveryMs))

    return () => window.clearInterval(timer)
  }, [serverNow, refreshEveryMs])

  return now
}
