'use client'

import { useCallback, useEffect, useState } from 'react'
import Image from 'next/image'

type CommentRow = {
  id: string
  content: string
  createdAt: string
  moderationStatus: 'NORMAL' | 'VIOLATION'
  event: { title: string; slug: string }
  show: { id: string; date: string; title: string | null; albumTitle: string } | null
  author: { displayName: string; avatarUrl: string | null }
  images: Array<{ id: string; url: string }>
}

export function ConcertDiscussionAdminManager() {
  const [comments, setComments] = useState<CommentRow[]>([])
  const [cursor, setCursor] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [busyId, setBusyId] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  const load = useCallback(async (nextCursor: string | null, append: boolean) => {
    const query = nextCursor ? `?cursor=${encodeURIComponent(nextCursor)}` : ''
    const response = await fetch(`/api/admin/concert-discussions${query}`, { cache: 'no-store', credentials: 'same-origin' })
    const data = await response.json().catch(() => ({}))
    if (!response.ok) throw new Error(typeof data.message === 'string' ? data.message : '讨论加载失败')
    const page = Array.isArray(data.comments) ? data.comments as CommentRow[] : []
    setComments((current) => append ? [...current, ...page.filter((row) => !current.some((item) => item.id === row.id))] : page)
    setCursor(typeof data.nextCursor === 'string' ? data.nextCursor : null)
  }, [])

  useEffect(() => {
    void load(null, false).catch((reason) => setError(reason instanceof Error ? reason.message : '讨论加载失败'))
      .finally(() => setLoading(false))
  }, [load])

  async function remove(row: CommentRow) {
    if (busyId || !window.confirm('确定从公开讨论区移除这条内容吗？此操作会保留审计记录。')) return
    setBusyId(row.id)
    setError('')
    setNotice('')
    try {
      const response = await fetch(`/api/admin/concert-discussions/${encodeURIComponent(row.id)}`, { method: 'DELETE', cache: 'no-store', credentials: 'same-origin' })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(typeof data.message === 'string' ? data.message : '移除失败，请刷新后重试')
      setComments((current) => current.filter((item) => item.id !== row.id))
      setNotice('内容已从公开讨论区移除')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '移除失败，请重试')
    } finally {
      setBusyId('')
    }
  }

  async function loadMore() {
    if (!cursor || loadingMore) return
    setLoadingMore(true)
    setError('')
    try { await load(cursor, true) }
    catch (reason) { setError(reason instanceof Error ? reason.message : '加载更多失败') }
    finally { setLoadingMore(false) }
  }

  if (loading) return <p role="status" className="border border-[var(--border)] bg-[var(--surface)] p-5 text-sm">正在加载讨论…</p>
  return <section className="space-y-4">
    {error ? <p role="alert" className="text-sm font-bold text-red-700">{error}</p> : null}
    {notice ? <p role="status" aria-live="polite" className="text-sm font-bold text-[var(--primary)]">{notice}</p> : null}
    {comments.length ? <ol className="space-y-3">{comments.map((row) => <li key={row.id} className="border border-[var(--border)] bg-[var(--surface)] p-4 sm:p-5">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="break-words text-sm font-black text-[var(--foreground)]">{row.event.title}{row.show ? ` · ${row.show.date} · ${row.show.title || row.show.albumTitle}` : ' · 系列讨论'}</p>
          <p className="mt-1 text-xs text-[var(--foreground-muted)]">{row.author.displayName} · <time dateTime={row.createdAt}>{new Intl.DateTimeFormat('zh-HK', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(row.createdAt))}</time> · {row.moderationStatus === 'NORMAL' ? '公开' : '违规隐藏'}</p>
        </div>
        <button type="button" onClick={() => void remove(row)} disabled={Boolean(busyId)} className="min-h-10 shrink-0 border border-red-300 px-3 text-sm font-bold text-red-700 disabled:opacity-50">{busyId === row.id ? '处理中…' : '从公开区移除'}</button>
      </header>
      {row.content ? <p className="mt-3 whitespace-pre-wrap break-words text-sm leading-6 text-[var(--foreground)]">{row.content}</p> : null}
      {row.images.length ? <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">{row.images.map((image, index) => <a key={image.id} href={image.url} target="_blank" rel="noopener noreferrer" className="block overflow-hidden border border-[var(--border)] p-1" aria-label={`打开评论图片 ${index + 1}`}>
        <Image src={image.url} alt={`评论图片 ${index + 1}`} width={640} height={480} loading="lazy" unoptimized className="max-h-56 w-full object-contain" />
      </a>)}</div> : null}
    </li>)}</ol> : <p className="border border-dashed border-[var(--border)] bg-[var(--surface)] p-5 text-center text-sm text-[var(--foreground-muted)]">当前没有讨论内容。</p>}
    {cursor ? <button type="button" onClick={() => void loadMore()} disabled={loadingMore} className="min-h-11 w-full border border-[var(--border)] bg-[var(--surface)] text-sm font-bold disabled:opacity-50">{loadingMore ? '加载中…' : '加载更多'}</button> : null}
  </section>
}
