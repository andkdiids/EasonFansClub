'use client'

import { useState } from 'react'

export function AlbumReviewActions({
  reviewId,
  initialLiked,
  initialFavorited,
  initialLikeCount,
  initialFavoriteCount,
}: Readonly<{
  reviewId: string
  initialLiked: boolean
  initialFavorited: boolean
  initialLikeCount: number
  initialFavoriteCount: number
}>) {
  const [liked, setLiked] = useState(initialLiked)
  const [favorited, setFavorited] = useState(initialFavorited)
  const [likeCount, setLikeCount] = useState(initialLikeCount)
  const [favoriteCount, setFavoriteCount] = useState(initialFavoriteCount)
  const [busy, setBusy] = useState<'like' | 'favorite' | null>(null)
  const [error, setError] = useState('')

  async function interact(action: 'like' | 'favorite') {
    if (busy) return
    setBusy(action)
    setError('')
    try {
      const response = await fetch(`/api/music/reviews/${reviewId}/interactions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      })
      const data = await response.json().catch(() => null)
      if (!response.ok) throw new Error(data?.message || '操作失败')
      setLiked(Boolean(data.liked))
      setFavorited(Boolean(data.favorited))
      setLikeCount(Math.max(0, Number(data.likeCount) || 0))
      setFavoriteCount(Math.max(0, Number(data.favoriteCount) || 0))
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '操作失败')
    } finally {
      setBusy(null)
    }
  }

  return <div>
    <div className="flex flex-wrap gap-3">
      <button type="button" disabled={Boolean(busy)} onClick={() => void interact('like')} className={`min-h-11 rounded-full border px-5 text-sm font-black transition disabled:opacity-60 ${liked ? 'border-sky-300/45 bg-sky-300/20 text-sky-100' : 'border-white/15 bg-white/[0.07] text-white'}`}>
        {liked ? '已点赞' : '点赞'} · {likeCount}
      </button>
      <button type="button" disabled={Boolean(busy)} onClick={() => void interact('favorite')} className={`min-h-11 rounded-full border px-5 text-sm font-black transition disabled:opacity-60 ${favorited ? 'border-violet-300/45 bg-violet-300/20 text-violet-100' : 'border-white/15 bg-white/[0.07] text-white'}`}>
        {favorited ? '已收藏' : '收藏'} · {favoriteCount}
      </button>
    </div>
    {error ? <p className="mt-3 text-sm font-bold text-rose-300" role="alert">{error}</p> : null}
  </div>
}
