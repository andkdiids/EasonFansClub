'use client'

import { useState } from 'react'
import { AnywhereDoorPostCard } from '@/components/anywhere-door/AnywhereDoorPostCard'
import type { SocialPostView } from '@/lib/social-posts'

type Feed = { items: SocialPostView[]; nextCursor: string | null }

export function AnywhereDoorFeed({ initial }: Readonly<{ initial: Feed }>) {
  const [items, setItems] = useState(initial.items)
  const [nextCursor, setNextCursor] = useState(initial.nextCursor)
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState('')

  async function loadMore() {
    if (!nextCursor || loading) return
    setLoading(true)
    setMessage('')
    try {
      const response = await fetch(`/api/anywhere-door?cursor=${encodeURIComponent(nextCursor)}`, { cache: 'no-store' })
      const payload = await response.json().catch(() => null)
      if (!response.ok) throw new Error(payload?.message || '加载失败')
      setItems((current) => [...current, ...(payload.items || [])])
      setNextCursor(payload.nextCursor || null)
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '加载失败，请稍后重试')
    } finally {
      setLoading(false)
    }
  }

  async function toggleLike(postId: string) {
    const response = await fetch(`/api/anywhere-door/${postId}/like`, { method: 'POST' })
    const payload = await response.json().catch(() => null)
    if (!response.ok) {
      setMessage(payload?.message || '点赞失败，请稍后重试')
      return
    }
    setItems((current) => current.map((item) => item.id === postId ? { ...item, viewerLiked: payload.liked, likeCount: payload.likeCount } : item))
  }

  return (
    <div className="space-y-5">
      {items.length ? items.map((post) => <AnywhereDoorPostCard key={post.id} post={post} onLike={(id) => void toggleLike(id)} />) : <section className="rounded-[28px] border border-dashed border-sky-200 bg-white/70 p-10 text-center"><p className="text-lg font-black text-brand-950">随意门正在等待第一批动态</p><p className="mt-2 text-sm font-bold text-slate-500">管理员完成同步后，公开且已存储的内容会出现在这里。</p></section>}
      {message ? <p className="rounded-2xl bg-red-50 px-4 py-3 text-sm font-bold text-red-700" role="alert">{message}</p> : null}
      {nextCursor ? <button type="button" onClick={() => void loadMore()} disabled={loading} className="mx-auto block min-h-11 rounded-full border border-sky-200 bg-white px-6 text-sm font-black text-brand-700 disabled:opacity-50">{loading ? '加载中…' : '加载更多'}</button> : items.length ? <p className="text-center text-xs font-bold text-slate-400">已经看到全部动态</p> : null}
    </div>
  )
}
