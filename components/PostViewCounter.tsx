'use client'

import { useEffect, useRef, useState } from 'react'

export function PostViewCounter({ postId, initialCount }: { postId: string; initialCount: number }) {
  const [count, setCount] = useState(initialCount)
  const requested = useRef(false)

  useEffect(() => {
    if (requested.current) return
    requested.current = true
    fetch(`/api/posts/${encodeURIComponent(postId)}/view`, { method: 'POST', credentials: 'same-origin' })
      .then(async (response) => {
        if (!response.ok) return null
        return await response.json() as { viewCount?: number }
      })
      .then((result) => {
        if (typeof result?.viewCount === 'number') setCount(result.viewCount)
      })
      .catch(() => null)
  }, [postId])

  return <span>浏览 {count}</span>
}
