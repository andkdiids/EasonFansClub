'use client'

import { useEffect, useState } from 'react'
import { redirectToLoginAfterConfirmedSessionInvalid } from '@/lib/client-auth'

type EasMusicLikeType = 'song' | 'album'

type EasMusicLikeEvent = {
  type?: EasMusicLikeType
  targetId?: string
  liked?: boolean
  likeCount?: number
}

type EasMusicLikeButtonProps = {
  type: EasMusicLikeType
  targetId: string
  initialLiked: boolean
  initialCount: number
  loggedIn: boolean
  className?: string
}

const countFormatter = new Intl.NumberFormat('zh-CN')

function endpointFor(type: EasMusicLikeType, targetId: string) {
  const collection = type === 'song' ? 'songs' : 'albums'
  return `/api/music/${collection}/${encodeURIComponent(targetId)}/like`
}

function currentPath() {
  return `${window.location.pathname}${window.location.search}` || '/'
}

function emitLikeEvent(detail: EasMusicLikeEvent) {
  window.dispatchEvent(new CustomEvent('ecfc:easmusic-like', { detail }))
}

export function EasMusicLikeButton({ type, targetId, initialLiked, initialCount, loggedIn, className }: Readonly<EasMusicLikeButtonProps>) {
  const [liked, setLiked] = useState(initialLiked)
  const [count, setCount] = useState(Math.max(0, initialCount))
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    const syncLike = (event: Event) => {
      const detail = (event as CustomEvent<EasMusicLikeEvent>).detail
      if (detail?.type !== type || detail.targetId !== targetId) return
      if (typeof detail.liked === 'boolean') setLiked(detail.liked)
      if (typeof detail.likeCount === 'number') setCount(Math.max(0, detail.likeCount))
    }
    window.addEventListener('ecfc:easmusic-like', syncLike)
    return () => window.removeEventListener('ecfc:easmusic-like', syncLike)
  }, [targetId, type])

  async function toggleLike() {
    if (isSubmitting) return
    if (!loggedIn) {
      window.location.assign(`/login?next=${encodeURIComponent(currentPath())}`)
      return
    }

    const previousLiked = liked
    const previousCount = count
    const nextLiked = !previousLiked
    const endpoint = endpointFor(type, targetId)
    setError('')
    setIsSubmitting(true)
    setLiked(nextLiked)
    setCount(Math.max(0, previousCount + (nextLiked ? 1 : -1)))

    try {
      const response = await fetch(endpoint, {
        method: nextLiked ? 'POST' : 'DELETE',
        credentials: 'same-origin',
        cache: 'no-store',
      })
      const data = await response.json().catch(() => ({})) as { liked?: unknown; likeCount?: unknown; message?: unknown }
      if (response.status === 401 && await redirectToLoginAfterConfirmedSessionInvalid(response, endpoint)) {
        setLiked(previousLiked)
        setCount(previousCount)
        return
      }
      if (!response.ok) throw new Error(typeof data.message === 'string' ? data.message : '点赞操作失败，请稍后重试')

      const serverLiked = data.liked === true
      const serverCount = Number(data.likeCount)
      setLiked(serverLiked)
      setCount(Number.isFinite(serverCount) ? Math.max(0, serverCount) : previousCount)
      emitLikeEvent({ type, targetId, liked: serverLiked, likeCount: Number.isFinite(serverCount) ? Math.max(0, serverCount) : previousCount })
    } catch (reason) {
      setLiked(previousLiked)
      setCount(previousCount)
      setError(reason instanceof Error ? reason.message : '点赞操作失败，请稍后重试')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div>
      <button
        type="button"
        disabled={isSubmitting}
        aria-pressed={liked}
        aria-label={liked ? '取消点赞' : '点赞'}
        data-liked={liked}
        onClick={() => void toggleLike()}
        className={className || 'inline-flex min-h-8 items-center gap-1 border border-white/15 px-2.5 py-1 text-xs font-black text-slate-200 transition hover:border-sky-200/40 hover:text-white disabled:cursor-wait disabled:opacity-50'}
      >
        <span aria-hidden="true" className={liked ? 'text-rose-300' : ''}>{liked ? '♥' : '♡'}</span>
        <span>{countFormatter.format(count)}</span>
      </button>
      {error ? <p className="mt-1 text-xs font-bold text-red-300" role="alert">{error}</p> : null}
    </div>
  )
}
