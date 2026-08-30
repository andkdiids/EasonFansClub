'use client'

import { usePathname, useSearchParams } from 'next/navigation'
import { useState } from 'react'

export function SalonLikeButton({ postId, initialLiked, initialCount, onChange }: Readonly<{
  postId: string
  initialLiked: boolean
  initialCount: number
  onChange?: (liked: boolean, count: number) => void
}>) {
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const [liked, setLiked] = useState(initialLiked)
  const [count, setCount] = useState(Math.max(0, initialCount))
  const [busy, setBusy] = useState(false)

  async function toggle() {
    if (busy) return
    setBusy(true)
    try {
      const response = await fetch(`/api/salon/posts/${encodeURIComponent(postId)}/like`, { method: 'POST' })
      const data = await response.json().catch(() => null) as { liked?: boolean; likeCount?: number; message?: string } | null
      if (response.status === 401) {
        const query = searchParams.toString()
        window.location.href = `/login?redirect=${encodeURIComponent(`${pathname}${query ? `?${query}` : ''}`)}`
        return
      }
      if (!response.ok || typeof data?.liked !== 'boolean') throw new Error(data?.message || '点赞失败')
      const nextCount = typeof data.likeCount === 'number' ? Math.max(0, data.likeCount) : count
      setLiked(data.liked)
      setCount(nextCount)
      onChange?.(data.liked, nextCount)
    } catch (error) {
      window.dispatchEvent(new CustomEvent('salon:message', { detail: { message: error instanceof Error ? error.message : '点赞失败，请稍后重试' } }))
    } finally {
      setBusy(false)
    }
  }

  return <button type="button" className={`salon-like-button${liked ? ' is-liked' : ''}`} onClick={() => void toggle()} disabled={busy} aria-pressed={liked} aria-label={liked ? '取消点赞' : '点赞'}>{liked ? '♥' : '♡'} <span>{count}</span></button>
}
