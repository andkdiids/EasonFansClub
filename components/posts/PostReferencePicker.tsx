'use client'

import { useEffect, useState } from 'react'
import { formatUid } from '@/lib/uid'

export type PostReferencePost = {
  id: string
  title: string
  authorName: string
  authorUid: number
  boardName?: string
  createdAt?: string
}

type PostReferenceSearchResponse = { posts?: PostReferencePost[] }

export function PostReferencePicker({
  open,
  onClose,
  onSelect,
}: Readonly<{
  open: boolean
  onClose: () => void
  onSelect: (post: PostReferencePost) => void
}>) {
  const [query, setQuery] = useState('')
  const [posts, setPosts] = useState<PostReferencePost[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!open) return
    setQuery('')
    setPosts([])
    setError('')
  }, [open])

  useEffect(() => {
    if (!open) return
    const trimmedQuery = query.trim()
    setPosts([])
    setError('')
    if (!trimmedQuery) {
      setIsLoading(false)
      return
    }

    setIsLoading(true)
    const controller = new AbortController()
    const timer = window.setTimeout(() => {
      void fetch(`/api/posts/reference-search?q=${encodeURIComponent(trimmedQuery)}`, {
        signal: controller.signal,
        cache: 'no-store',
      })
        .then(async (response) => {
          if (!response.ok) throw new Error('帖子搜索失败')
          return await response.json() as PostReferenceSearchResponse
        })
        .then((data) => setPosts(Array.isArray(data.posts) ? data.posts.slice(0, 15) : []))
        .catch((reason: unknown) => {
          if (reason instanceof DOMException && reason.name === 'AbortError') return
          setError(reason instanceof Error ? reason.message : '帖子搜索失败，请稍后重试')
          setPosts([])
        })
        .finally(() => {
          if (!controller.signal.aborted) setIsLoading(false)
        })
    }, 300)

    return () => {
      window.clearTimeout(timer)
      controller.abort()
    }
  }, [open, query])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-[80] grid place-items-center bg-slate-950/45 p-4" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
      <section className="flex max-h-[min(680px,calc(100dvh-32px))] w-full max-w-lg flex-col border border-[var(--border)] bg-[var(--surface)] p-4 shadow-2xl" role="dialog" aria-modal="true" aria-labelledby="post-reference-picker-title">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 id="post-reference-picker-title" className="text-lg font-black text-brand-950">引用帖子</h2>
            <p className="mt-1 text-xs font-bold text-slate-500">搜索标题、作者或 UID，结果仅来自当前可访问的公开帖子。</p>
          </div>
          <button type="button" className="shrink-0 px-2 py-1 text-lg font-black text-slate-500" aria-label="关闭帖子搜索" onClick={onClose}>×</button>
        </div>
        <input
          autoFocus
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="搜索帖子标题、作者或 UID"
          aria-label="搜索引用帖子"
          className="mt-4 min-h-11 w-full border border-[var(--border)] bg-[var(--surface-subtle)] px-3 text-sm font-bold text-brand-950 outline-none focus:border-brand-500"
        />
        <div className="mt-3 min-h-0 flex-1 overflow-y-auto" aria-live="polite">
          {!query.trim() ? <p className="p-4 text-sm font-bold text-slate-500">输入关键词搜索站内帖子</p> : null}
          {isLoading ? <p className="p-4 text-sm font-bold text-slate-500">搜索中…</p> : null}
          {error ? <p className="p-4 text-sm font-bold text-red-600" role="alert">{error}</p> : null}
          {!isLoading && !error && query.trim() && !posts.length ? <p className="p-4 text-sm font-bold text-slate-500">没有匹配的公开帖子</p> : null}
          <div className="grid gap-2">
            {posts.map((post) => (
              <button
                key={post.id}
                type="button"
                className="min-w-0 border border-[var(--border)] bg-[var(--surface-subtle)] p-3 text-left transition hover:border-brand-300 hover:bg-sky-50"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => onSelect(post)}
              >
                <span className="block truncate font-black text-brand-950">《{post.title}》</span>
                <span className="mt-1 block truncate text-xs font-bold text-slate-500">
                  {post.authorName} · UID {formatUid(post.authorUid)}
                  {post.boardName ? ` · ${post.boardName}` : ''}
                </span>
              </button>
            ))}
          </div>
        </div>
      </section>
    </div>
  )
}
