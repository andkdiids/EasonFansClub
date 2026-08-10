'use client'

import { useState } from 'react'
import { postModerationStatuses, type PostModerationStatus } from '@/lib/post-moderation'

export type ReviewPost = {
  id: string
  title: string
  content: string
  createdAt: string
  moderationStatus: PostModerationStatus
  reviewedAt: string | null
  rejectionReason: string | null
  isPinned: boolean
  isFeatured: boolean
  User: { uid: number; nickname: string; Profile: { displayName: string | null } | null }
  Board: { name: string }
  PostMedia: { id: string; url: string | null; thumbnail: string | null }[]
}

type ReviewStatus = ReviewPost['moderationStatus']
type ReviewTarget = {
  postId: string
  title: string
  nextStatus: Exclude<ReviewStatus, 'PENDING'>
}

const statusLabels: Record<ReviewStatus, string> = { PENDING: '待审核', APPROVED: '已通过', REJECTED: '已拒绝' }

export function PostReviewManager({ initialPosts }: { initialPosts: ReviewPost[] }) {
  const [posts, setPosts] = useState(initialPosts)
  const [queueStatus, setQueueStatus] = useState<ReviewStatus>('PENDING')
  const [loading, setLoading] = useState(false)
  const [reviewingId, setReviewingId] = useState<string | null>(null)
  const [reviewTarget, setReviewTarget] = useState<ReviewTarget | null>(null)
  const [rejectReason, setRejectReason] = useState('')
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  async function loadStatus(nextStatus: ReviewStatus) {
    setLoading(true)
    setError('')
    try {
      const response = await fetch(`/api/admin/posts/review?status=${nextStatus}`, { cache: 'no-store' })
      const data = await response.json().catch(() => null)
      if (!response.ok) {
        setError(data?.message || '列表加载失败')
        return
      }
      setPosts(Array.isArray(data?.posts) ? data.posts as ReviewPost[] : [])
      setQueueStatus(nextStatus)
    } catch {
      setError('列表加载失败，请稍后重试')
    } finally {
      setLoading(false)
    }
  }

  async function review(postId: string, status: Exclude<ReviewStatus, 'PENDING'>, reason: string | null = null) {
    setReviewingId(postId)
    setError('')
    try {
      const response = await fetch('/api/admin/posts/review', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ postId, status, rejectionReason: reason }),
      })
      const data = await response.json().catch(() => null)
      if (!response.ok) {
        setError(data?.message || '审核失败')
        return
      }
      setPosts((current) => current.filter((post) => post.id !== postId))
      window.dispatchEvent(new Event('unread-summary:refresh'))
      setMessage(status === 'APPROVED' ? '帖子已通过审核，并已进入已通过列表' : '帖子已拒绝，并已进入已拒绝列表')
    } catch {
      setError('审核失败，请稍后重试')
    } finally {
      setReviewingId(null)
    }
  }

  function requestReview(post: ReviewPost, nextStatus: Exclude<ReviewStatus, 'PENDING'>) {
    setError('')
    setMessage('')
    setRejectReason(nextStatus === 'REJECTED' ? post.rejectionReason || '' : '')
    setReviewTarget({ postId: post.id, title: post.title, nextStatus })
  }

  async function confirmReview() {
    if (!reviewTarget) return
    const reason = rejectReason.trim()
    if (reviewTarget.nextStatus === 'REJECTED' && reason.length > 1000) {
      setError('拒绝原因不能超过 1000 个字符')
      return
    }
    const target = reviewTarget
    setReviewTarget(null)
    await review(target.postId, target.nextStatus, target.nextStatus === 'REJECTED' ? reason || null : null)
  }

  async function toggleFlag(postId: string, field: 'isPinned' | 'isFeatured', value: boolean) {
    setError('')
    const response = await fetch(`/api/posts/${postId}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ [field]: value }) })
    const data = await response.json().catch(() => null)
    if (!response.ok) { setError(data?.message || '设置失败'); return }
    setPosts((current) => current.map((post) => post.id === postId ? { ...post, [field]: value } : post))
    setMessage(value ? '帖子标记已设置' : '帖子标记已取消')
  }

  return <section className="rounded-[28px] border border-sky-100 bg-white/90 p-5 shadow-sm sm:p-7" aria-busy={loading || Boolean(reviewingId)}>
    {message ? <p className="mb-4 rounded-2xl bg-emerald-50 px-4 py-3 text-sm font-black text-emerald-700">{message}</p> : null}
    {error ? <p className="mb-4 rounded-2xl bg-red-50 px-4 py-3 text-sm font-black text-red-700">{error}</p> : null}
    <div className="flex flex-wrap items-end justify-between gap-3"><div><p className="text-xs font-black uppercase tracking-[0.18em] text-sky-700">Post Queue</p><h2 className="mt-1 text-2xl font-black text-brand-950">{statusLabels[queueStatus]}帖子</h2></div><span className="text-sm font-black text-slate-500">{posts.length} 条</span></div>
    <div className="mt-4 flex flex-wrap gap-2" role="tablist" aria-label="帖子审核状态">
      {postModerationStatuses.map((status) => <button key={status} type="button" role="tab" aria-selected={status === queueStatus} disabled={loading || Boolean(reviewingId) || status === queueStatus} onClick={() => void loadStatus(status)} className={`rounded-full px-4 py-2 text-sm font-black ${status === queueStatus ? 'bg-brand-950 text-white' : 'bg-sky-50 text-brand-700'} disabled:opacity-60`}>{statusLabels[status]}</button>)}
    </div>
    <div className="mt-5 divide-y divide-sky-100">
      {posts.map((post) => {
        const isReviewing = reviewingId === post.id
        return <article key={post.id} className="grid gap-5 py-6 md:grid-cols-[minmax(0,1fr)_auto]">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2 text-xs font-black text-slate-500"><span className="rounded-full bg-sky-50 px-3 py-1 text-brand-700">[{post.Board.name}]</span><span>{post.User.Profile?.displayName || post.User.nickname}</span><span>UID {post.User.uid}</span><time>{new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(post.createdAt))}</time>{post.reviewedAt ? <time>审核于 {new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(post.reviewedAt))}</time> : null}</div>
            <h3 className="mt-3 text-xl font-black text-brand-950">{post.title}</h3>
            <p className="mt-2 whitespace-pre-wrap text-sm leading-7 text-slate-600">{post.content}</p>
            {queueStatus === 'REJECTED' && post.rejectionReason ? <p className="mt-3 rounded-xl bg-red-50 px-3 py-2 text-sm font-bold text-red-700">拒绝原因：{post.rejectionReason}</p> : null}
            {post.PostMedia.length ? <div className="mt-4 flex flex-wrap gap-3">{post.PostMedia.map((media) => media.url ? <img key={media.id} src={media.thumbnail || media.url} alt="帖子图片" className="h-28 w-40 rounded-xl object-cover" /> : null)}</div> : null}
          </div>
          <div className="flex flex-wrap items-start gap-2 md:w-32 md:flex-col">
            {queueStatus === 'PENDING' ? <><button type="button" disabled={Boolean(reviewingId)} onClick={() => requestReview(post, 'APPROVED')} className="rounded-full bg-emerald-600 px-4 py-2 text-sm font-black text-white disabled:opacity-60">通过</button><button type="button" disabled={Boolean(reviewingId)} onClick={() => requestReview(post, 'REJECTED')} className="rounded-full bg-red-50 px-4 py-2 text-sm font-black text-red-700 disabled:opacity-60">拒绝</button></> : null}
            {queueStatus === 'APPROVED' ? <button type="button" disabled={Boolean(reviewingId)} onClick={() => requestReview(post, 'REJECTED')} className="rounded-full bg-red-50 px-4 py-2 text-sm font-black text-red-700 disabled:opacity-60">重新拒绝</button> : null}
            {queueStatus === 'REJECTED' ? <button type="button" disabled={Boolean(reviewingId)} onClick={() => requestReview(post, 'APPROVED')} className="rounded-full bg-emerald-600 px-4 py-2 text-sm font-black text-white disabled:opacity-60">重新通过</button> : null}
            <button type="button" disabled={Boolean(reviewingId)} onClick={() => void toggleFlag(post.id, 'isFeatured', !post.isFeatured)} className="rounded-full bg-sky-50 px-4 py-2 text-sm font-black text-brand-700 disabled:opacity-60">{post.isFeatured ? '取消精选' : '设置精选'}</button>
            <button type="button" disabled={Boolean(reviewingId)} onClick={() => void toggleFlag(post.id, 'isPinned', !post.isPinned)} className="rounded-full bg-sky-50 px-4 py-2 text-sm font-black text-brand-700 disabled:opacity-60">{post.isPinned ? '取消置顶' : '置顶'}</button>
            {isReviewing ? <span className="text-xs font-black text-slate-500">提交中…</span> : null}
          </div>
        </article>
      })}
      {!posts.length ? <p className="py-10 text-center text-sm font-bold text-slate-500">暂无{statusLabels[queueStatus]}帖子。</p> : null}
    </div>
    {reviewTarget ? <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/60 p-4" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setReviewTarget(null) }}>
      <div className="w-full max-w-lg rounded-3xl border border-sky-100 bg-white p-6 shadow-2xl" role="dialog" aria-modal="true" aria-labelledby="post-review-dialog-title">
        <h3 id="post-review-dialog-title" className="text-xl font-black text-brand-950">确认{reviewTarget.nextStatus === 'APPROVED' ? '通过' : '拒绝'}帖子</h3>
        <p className="mt-3 break-words text-sm font-bold leading-6 text-slate-600">{reviewTarget.title}</p>
        {reviewTarget.nextStatus === 'REJECTED' ? <label className="mt-5 block text-sm font-black text-brand-950">拒绝原因（可选）<textarea value={rejectReason} onChange={(event) => setRejectReason(event.target.value)} maxLength={1000} rows={4} className="mt-2 w-full rounded-2xl border border-sky-100 bg-white px-4 py-3 text-sm font-medium text-slate-700 outline-none focus:border-brand-500" placeholder="填写原因后，用户会在新的审核通知中看到。" /></label> : null}
        <div className="mt-6 flex flex-wrap justify-end gap-3"><button type="button" onClick={() => setReviewTarget(null)} className="rounded-full bg-sky-50 px-5 py-2.5 text-sm font-black text-brand-700">取消</button><button type="button" onClick={() => void confirmReview()} className={`rounded-full px-5 py-2.5 text-sm font-black text-white ${reviewTarget.nextStatus === 'APPROVED' ? 'bg-emerald-600' : 'bg-red-600'}`}>确认{reviewTarget.nextStatus === 'APPROVED' ? '通过' : '拒绝'}</button></div>
      </div>
    </div> : null}
  </section>
}
