'use client'

import { useEffect, useRef, useState } from 'react'

export function ActivityViewCounter({ activityId, initialCount }: Readonly<{ activityId: string; initialCount: number }>) {
  const [count, setCount] = useState(initialCount)
  const requested = useRef(false)

  useEffect(() => {
    if (requested.current) return
    requested.current = true
    fetch(`/api/activities/${encodeURIComponent(activityId)}/view`, { method: 'POST', credentials: 'same-origin' })
      .then(async (response) => {
        if (!response.ok) return null
        return await response.json() as { viewCount?: number }
      })
      .then((result) => {
        if (typeof result?.viewCount === 'number') setCount(result.viewCount)
      })
      .catch(() => null)
  }, [activityId])

  return <span>浏览 {count}</span>
}
