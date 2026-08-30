'use client'

import { useEffect, useRef, useState } from 'react'
import { UiIcon } from '@/components/UiIcon'

export function SalonViewCounter({ postId, initialCount }: Readonly<{ postId: string; initialCount: number }>) {
  const [count, setCount] = useState(Number.isFinite(initialCount) ? Math.max(0, initialCount) : 0)
  const requested = useRef(false)

  useEffect(() => {
    if (requested.current) return
    requested.current = true
    fetch(`/api/salon/posts/${encodeURIComponent(postId)}/view`, {
      method: 'POST',
      credentials: 'same-origin',
    })
      .then(async (response) => response.ok ? await response.json() as { viewCount?: number } : null)
      .then((result) => {
        if (typeof result?.viewCount === 'number' && Number.isFinite(result.viewCount)) setCount(Math.max(0, result.viewCount))
      })
      .catch(() => null)
  }, [postId])

  return <span className="salon-view-stat" aria-label={`浏览 ${count}`}><UiIcon name="eye" className="salon-stat-icon" /><span>{count}</span></span>
}
