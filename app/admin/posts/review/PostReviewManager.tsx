'use client'

import { useState } from 'react'

export type ReviewPost = {
  id: string
  title: string
  content: string
  createdAt: string
  moderationStatus: 'PENDING' | 'APPROVED' | 'REJECTED'
  isPinned: boolean
  isFeatured: boolean
  User: { uid: number; nickname: string; Profile: { displayName: string | null } | null }
  Board: { name: string }
  PostMedia: { id: string; url: string | null; thumbnail: string | null }[]
}

type ReviewStatus = ReviewPost['moderationStatus']

const statusLabels: Record<ReviewStatus, string> = { PENDING: '待审核', APPROVED: '已通过', REJECTED: '已拒绝' }

export function PostReviewManager({ initialPosts }: { initialPosts: ReviewPost[] }) {
  const [posts, setPosts] = useState(initialPosts)
  const [queueStatus, setQueueStatus] = useState<ReviewStatus>('PENDING')
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  async function loadStatus(nextStatus: ReviewStatus) {
    setQueueStatus(nextStatus)
    setLoading(true)
    setError('')
    const response = await fetch(`/api/admin/posts/review?status=${nextStatus}`)
    const data = await response.json().catch(() => null)
    setLoading(false)
    if (!response.ok) {
      setError(data?.message || '列表加载失败')
      return
    }
    setPosts(Array.isArray(data?.posts) ? data.posts as ReviewPost[] : [])
  }

  async function review(postId: string, status: 'APPROVED' | 'REJECTED') {
    setError('')
    const response = await fetch('/api/admin/posts/review', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ postId, status }) })
    const data = await response.json().catch(() => null)
    if (!response.ok) { setError(data?.message || '审核失败'); return }
    setPosts((current) => current.filter((post) => post.id !== postId))
    window.dispatchEvent(new Event('unread-summary:refresh'))
    setMessage(status === 'APPROVED' ? '帖子已通过并公开' : '帖子已拒绝')
  }

  async function toggleFlag(postId: string, field: 'isPinned' | 'isFeatured', value: boolean) {
    setError('')
    const response = await fetch(`/api/posts/${postId}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ [field]: value }) })
    const data = await response.json().catch(() => null)
    if (!response.ok) { setError(data?.message || '设置失败'); return }
    setPosts((current) => current.map((post) => post.id === postId ? { ...post, [field]: value } : post))
    setMessage(value ? '帖子标记已设置' : '帖子标记已取消')
  }

  return <section className="rounded-[28px] border border-sky-100 bg-white/90 p-5 shadow-sm sm:p-7">
    {message ? <p className="mb-4 rounded-2xl bg-emerald-50 px-4 py-3 text-sm font-black text-emerald-700">{message}</p> : null}
    {error ? <p className="mb-4 rounded-2xl bg-red-50 px-4 py-3 text-sm font-black text-red-700">{error}</p> : null}
    <div className="flex flex-wrap items-end justify-between gap-3"><div><p className="text-xs font-black uppercase tracking-[0.18em] text-sky-700">Post Queue</p><h2 className="mt-1 text-2xl font-black text-brand-950">{statusLabels[queueStatus]}帖子</h2></div><span className="text-sm font-black text-slate-500">{posts.length} 条</span></div>
    <div className="mt-4 flex flex-wrap gap-2">{(Object.keys(statusLabels) as ReviewStatus[]).map((status) => <button key={status} type="button" disabled={loading || status === queueStatus} onClick={() => void loadStatus(status)} className={`rounded-full px-4 py-2 text-sm font-black ${status === queueStatus ? 'bg-brand-950 text-white' : 'bg-sky-50 text-brand-700'} disabled:opacity-60`}>{statusLabels[status]}</button>)}</div>
    <div className="mt-5 divide-y divide-sky-100">
      {posts.map((post) => <article key={post.id} className="grid gap-5 py-6 lg:grid-cols-[minmax(0,1fr)_auto]">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2 text-xs font-black text-slate-500"><span className="rounded-full bg-sky-50 px-3 py-1 text-brand-700">[{post.Board.name}]</span><span>{post.User.Profile?.displayName || post.User.nickname}</span><span>UID {post.User.uid}</span><time>{new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(post.createdAt))}</time></div>
          <h3 className="mt-3 text-xl font-black text-brand-950">{post.title}</h3>
          <p className="mt-2 whitespace-pre-wrap text-sm leading-7 text-slate-600">{post.content}</p>
          {post.PostMedia.length ? <div className="mt-4 flex flex-wrap gap-3">{post.PostMedia.map((media) => media.url ? <img key={media.id} src={media.thumbnail || media.url} alt="帖子图片" className="h-28 w-40 rounded-xl object-cover" /> : null)}</div> : null}
        </div>
        <div className="flex flex-wrap items-start gap-2 lg:w-32 lg:flex-col">
          {queueStatus === 'PENDING' ? <><button type="button" onClick={() => void review(post.id, 'APPROVED')} className="rounded-full bg-emerald-600 px-4 py-2 text-sm font-black text-white">通过</button>
          <button type="button" onClick={() => void review(post.id, 'REJECTED')} className="rounded-full bg-red-50 px-4 py-2 text-sm font-black text-red-700">拒绝</button></> : null}
          <button type="button" onClick={() => void toggleFlag(post.id, 'isFeatured', !post.isFeatured)} className="rounded-full bg-sky-50 px-4 py-2 text-sm font-black text-brand-700">{post.isFeatured ? '取消精选' : '设置精选'}</button>
          <button type="button" onClick={() => void toggleFlag(post.id, 'isPinned', !post.isPinned)} className="rounded-full bg-sky-50 px-4 py-2 text-sm font-black text-brand-700">{post.isPinned ? '取消置顶' : '置顶'}</button>
        </div>
      </article>)}
      {!posts.length ? <p className="py-10 text-center text-sm font-bold text-slate-500">暂无待审核帖子。</p> : null}
    </div>
  </section>
}
