'use client'

import { useCallback, useEffect, useRef, useState, type ChangeEvent, type FormEvent } from 'react'
import Link from 'next/link'
import Image from 'next/image'
import { useRouter } from 'next/navigation'

type DiscussionImage = { id: string; url: string }
type DiscussionComment = {
  id: string
  content: string
  createdAt: string
  images: DiscussionImage[]
  author: { displayName: string; avatarUrl: string | null }
  canDelete: boolean
}

const MAX_IMAGES = 4
const MAX_FILE_SIZE = 10 * 1024 * 1024

function discussionHref(slug: string, showId?: string) {
  return showId ? `/concerts/${slug}/shows/${showId}#discussion` : `/concerts/${slug}#discussion`
}

export function ConcertDiscussion({ slug, showId = null, isAuthenticated, canComment }: Readonly<{
  slug: string
  showId?: string | null
  isAuthenticated: boolean
  canComment: boolean
}>) {
  const router = useRouter()
  const href = discussionHref(slug, showId || undefined)
  const api = `/api/concert-events/${encodeURIComponent(slug)}/discussion${showId ? `?showId=${encodeURIComponent(showId)}` : ''}`
  const [comments, setComments] = useState<DiscussionComment[]>([])
  const [cursor, setCursor] = useState<string | null>(null)
  const [hasMore, setHasMore] = useState(false)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [posting, setPosting] = useState(false)
  const [deletingId, setDeletingId] = useState('')
  const [uploading, setUploading] = useState(false)
  const [content, setContent] = useState('')
  const [imageUrls, setImageUrls] = useState<string[]>([])
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const requestIdRef = useRef('')
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  const loadPage = useCallback(async (nextCursor: string | null, append: boolean, signal?: AbortSignal) => {
    const url = new URL(api, window.location.origin)
    if (nextCursor) url.searchParams.set('cursor', nextCursor)
    const response = await fetch(url, { cache: 'no-store', credentials: 'same-origin', signal })
    const data = await response.json().catch(() => ({}))
    if (!response.ok) throw new Error(typeof data.message === 'string' ? data.message : '讨论加载失败，请稍后重试')
    const page = Array.isArray(data.comments) ? data.comments as DiscussionComment[] : []
    setComments((current) => append ? [...current, ...page.filter((item) => !current.some((existing) => existing.id === item.id))] : page)
    setCursor(typeof data.nextCursor === 'string' ? data.nextCursor : null)
    setHasMore(Boolean(data.nextCursor))
  }, [api])

  useEffect(() => {
    const controller = new AbortController()
    setLoading(true)
    setError('')
    setComments([])
    setCursor(null)
    setHasMore(false)
    void loadPage(null, false, controller.signal)
      .catch((reason) => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : '讨论加载失败，请稍后重试') })
      .finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [loadPage])

  function requireLogin() {
    router.push(`/login?redirect=${encodeURIComponent(href)}`)
  }

  function invalidateRequestId() {
    requestIdRef.current = ''
  }

  async function uploadSelected(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files || [])
    event.target.value = ''
    if (!files.length || uploading || posting) return
    if (!isAuthenticated) { requireLogin(); return }
    if (imageUrls.length + files.length > MAX_IMAGES) { setError(`最多上传 ${MAX_IMAGES} 张图片`); return }
    if (files.some((file) => !['image/jpeg', 'image/png', 'image/webp', 'image/gif'].includes(file.type.toLowerCase()) || file.size < 1 || file.size > MAX_FILE_SIZE)) {
      setError('请选择有效的 JPG、PNG、WebP 或 GIF 图片，每张不超过 10MB')
      return
    }

    setUploading(true)
    setError('')
    setNotice('')
    try {
      for (const file of files) {
        const form = new FormData()
        form.append('file', file, file.name)
        const response = await fetch('/api/uploads/content-image', { method: 'POST', body: form, credentials: 'same-origin', cache: 'no-store' })
        const data = await response.json().catch(() => ({}))
        if (response.status === 401) { requireLogin(); throw new Error('登录状态已失效，请重新登录后上传') }
        if (!response.ok || typeof data.url !== 'string') throw new Error(typeof data.message === 'string' ? data.message : '图片上传失败，请重试')
        setImageUrls((current) => [...current, data.url as string])
        invalidateRequestId()
      }
      setNotice('图片已上传，可预览后提交')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '图片上传失败，请重试')
    } finally { setUploading(false) }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!isAuthenticated) { requireLogin(); return }
    if (!canComment || posting || uploading) return
    setPosting(true)
    setError('')
    setNotice('')
    if (!requestIdRef.current) requestIdRef.current = crypto.randomUUID()
    try {
      const response = await fetch(api, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ content, imageUrls, requestId: requestIdRef.current }),
      })
      const data = await response.json().catch(() => ({}))
      if (response.status === 401) { requireLogin(); throw new Error('登录状态已失效，请重新登录后提交') }
      if (!response.ok) {
        if (response.status === 409) invalidateRequestId()
        throw new Error(typeof data.message === 'string' ? data.message : '评论发布失败，请重试')
      }
      const created = data.comment as DiscussionComment
      setComments((current) => [created, ...current.filter((item) => item.id !== created.id)])
      setContent('')
      setImageUrls([])
      invalidateRequestId()
      setNotice(data.duplicate ? '评论已发布' : '评论发布成功')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '评论发布失败，请重试')
    } finally { setPosting(false) }
  }

  async function loadMore() {
    if (!cursor || loadingMore) return
    setLoadingMore(true)
    setError('')
    try { await loadPage(cursor, true) }
    catch (reason) { setError(reason instanceof Error ? reason.message : '加载更多失败，请重试') }
    finally { setLoadingMore(false) }
  }

  async function deleteComment(comment: DiscussionComment) {
    if (!comment.canDelete || deletingId || !window.confirm('确定删除这条讨论吗？删除后将从讨论区移除。')) return
    setDeletingId(comment.id)
    setError('')
    setNotice('')
    try {
      const response = await fetch(`/api/concert-events/${encodeURIComponent(slug)}/discussion/${encodeURIComponent(comment.id)}`, {
        method: 'DELETE',
        credentials: 'same-origin',
        cache: 'no-store',
      })
      const data = await response.json().catch(() => ({}))
      if (response.status === 401) { requireLogin(); throw new Error('登录状态已失效，请重新登录') }
      if (!response.ok) throw new Error(typeof data.message === 'string' ? data.message : '删除失败，请刷新后重试')
      setComments((current) => current.filter((item) => item.id !== comment.id))
      setNotice('讨论已删除')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '删除失败，请重试')
    } finally {
      setDeletingId('')
    }
  }

  return <section id="discussion" className="scroll-mt-24 border border-[var(--border)] bg-[var(--surface)] p-4 sm:p-6" aria-labelledby="concert-discussion-title">
    <header className="flex flex-wrap items-end justify-between gap-2">
      <div><h2 id="concert-discussion-title" className="text-xl font-black text-[var(--foreground)]">{showId ? '本场演出讨论' : 'Recording Sessions 系列讨论'}</h2><p className="mt-1 text-sm text-[var(--foreground-muted)]">讨论内容独立于 E院广场，图片仅保存到项目图片库。</p></div>
      <span className="text-xs text-[var(--foreground-muted)]">{comments.length}{hasMore ? '+' : ''} 条</span>
    </header>

    {canComment ? isAuthenticated ? <form onSubmit={submit} className="mt-4 space-y-3 border border-[var(--border)] bg-[var(--background)] p-3 sm:p-4">
      <label className="block text-sm font-bold text-[var(--foreground)]" htmlFor={`concert-comment-${showId || 'event'}`}>发表讨论
        <textarea id={`concert-comment-${showId || 'event'}`} value={content} maxLength={3000} onChange={(event) => { setContent(event.target.value); invalidateRequestId() }} rows={4} placeholder="分享你的场次选择、购票经验或系列讨论…" className="mt-2 block w-full resize-y border border-[var(--border)] bg-[var(--surface)] p-3 text-sm font-normal text-[var(--foreground)] placeholder:text-[var(--foreground-muted)]" />
      </label>
      <div className="flex flex-wrap items-center gap-2">
        <input ref={fileInputRef} type="file" accept="image/jpeg,image/png,image/webp,image/gif" multiple onChange={(event) => void uploadSelected(event)} className="sr-only" aria-label="选择讨论图片" />
        <button type="button" onClick={() => fileInputRef.current?.click()} disabled={uploading || posting || imageUrls.length >= MAX_IMAGES} className="min-h-10 border border-[var(--border)] px-3 text-sm font-bold text-[var(--foreground)] disabled:opacity-50">{uploading ? '图片上传中…' : `添加图片 (${imageUrls.length}/${MAX_IMAGES})`}</button>
        <button type="submit" disabled={posting || uploading || (!content.trim() && !imageUrls.length)} className="min-h-10 bg-[var(--primary)] px-4 text-sm font-black text-white disabled:opacity-50">{posting ? '发布中…' : '发布讨论'}</button>
        {uploading ? <span role="status" className="text-xs text-[var(--foreground-muted)]">正在安全处理并上传图片，请稍候。</span> : null}
      </div>
      {imageUrls.length ? <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">{imageUrls.map((url, index) => <div key={url} className="relative min-w-0 border border-[var(--border)] p-1">
        <Image src={url} alt={`待发布图片 ${index + 1}`} width={480} height={320} unoptimized className="h-28 w-full object-cover" />
        <button type="button" onClick={() => { setImageUrls((current) => current.filter((item) => item !== url)); invalidateRequestId() }} disabled={posting || uploading} className="mt-1 min-h-9 w-full text-xs font-bold text-red-700 disabled:opacity-50">移除图片</button>
      </div>)}</div> : null}
    </form> : <div className="mt-4 border border-[var(--border)] bg-[var(--background)] p-3 text-sm text-[var(--foreground-muted)]">登录后即可发表评论或上传图片。 <button type="button" onClick={requireLogin} className="font-bold text-[var(--primary)] underline">登录并返回本讨论区</button></div> : <p className="mt-4 border border-[var(--border)] bg-[var(--background)] p-3 text-sm text-[var(--foreground-muted)]">当前暂不开放新评论。</p>}

    {error ? <p role="alert" className="mt-3 text-sm font-bold text-red-700 dark:text-red-300">{error}</p> : null}
    {notice ? <p role="status" aria-live="polite" className="mt-3 text-sm text-[var(--primary)]">{notice}</p> : null}
    {loading ? <p role="status" className="mt-4 text-sm text-[var(--foreground-muted)]">正在加载讨论…</p> : comments.length ? <ol className="mt-4 divide-y divide-[var(--border)]">{comments.map((comment) => <li key={comment.id} className="py-4 first:pt-0">
      <div className="flex min-w-0 items-center gap-2">
        <span className="grid h-9 w-9 shrink-0 place-items-center overflow-hidden rounded-full bg-[var(--background)] text-xs font-bold text-[var(--foreground-muted)]">{comment.author.avatarUrl ? <Image src={comment.author.avatarUrl} alt="" width={36} height={36} unoptimized className="h-full w-full object-cover" /> : comment.author.displayName.slice(0, 1)}</span>
        <div className="min-w-0"><p className="truncate text-sm font-bold text-[var(--foreground)]">{comment.author.displayName}</p><time dateTime={comment.createdAt} className="text-xs text-[var(--foreground-muted)]">{new Intl.DateTimeFormat('zh-HK', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(comment.createdAt))}</time></div>
      </div>
      {comment.content ? <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-6 text-[var(--foreground)]">{comment.content}</p> : null}
      {comment.images.length ? <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">{comment.images.map((image, index) => image.url ? <a key={image.id} href={image.url} target="_blank" rel="noopener noreferrer" aria-label={`打开讨论图片 ${index + 1}`} className="block min-w-0 overflow-hidden border border-[var(--border)] bg-[var(--background)]">
        <Image src={image.url} alt={`讨论图片 ${index + 1}`} width={768} height={576} loading="lazy" unoptimized className="max-h-72 w-full object-contain" />
      </a> : null)}</div> : null}
      {comment.canDelete ? <button type="button" onClick={() => void deleteComment(comment)} disabled={Boolean(deletingId)} className="mt-2 min-h-9 rounded border border-[var(--border)] px-3 text-xs font-bold text-red-700 disabled:opacity-50">{deletingId === comment.id ? '删除中…' : '删除我的讨论'}</button> : null}
    </li>)}</ol> : <p className="mt-4 border border-dashed border-[var(--border)] p-4 text-center text-sm text-[var(--foreground-muted)]">这里还没有讨论，欢迎分享你的想法。</p>}
    {!loading && hasMore ? <button type="button" onClick={() => void loadMore()} disabled={loadingMore} className="mt-3 min-h-10 w-full border border-[var(--border)] text-sm font-bold text-[var(--foreground)] disabled:opacity-50">{loadingMore ? '加载中…' : '加载更多讨论'}</button> : null}
    {!loading && !isAuthenticated ? <p className="mt-3 text-center text-xs text-[var(--foreground-muted)]"><Link href={`/login?redirect=${encodeURIComponent(href)}`} className="font-bold text-[var(--primary)]">登录后参与讨论</Link></p> : null}
  </section>
}
