'use client'

import { useState } from 'react'
import type { SocialCommentView } from '@/lib/social-posts'

function formatDate(value: string) {
  return new Intl.DateTimeFormat('zh-CN', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value))
}

export function AnywhereDoorCommentPanel({ postId, initialComments, initialNextCursor }: Readonly<{ postId: string; initialComments: SocialCommentView[]; initialNextCursor?: string | null }>) {
  const [comments, setComments] = useState(initialComments)
  const [nextCursor, setNextCursor] = useState<string | null>(initialNextCursor || null)
  const [content, setContent] = useState('')
  const [replyTo, setReplyTo] = useState<SocialCommentView | null>(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')

  async function loadComments(cursor?: string | null) {
    const query = new URLSearchParams({ limit: '20' })
    if (cursor) query.set('cursor', cursor)
    const response = await fetch(`/api/anywhere-door/${postId}/comments?${query.toString()}`, { cache: 'no-store' })
    const payload = await response.json().catch(() => null)
    if (!response.ok) throw new Error(payload?.message || '评论加载失败')
    setComments((current) => cursor ? [...current, ...(payload.comments || [])] : (payload.comments || []))
    setNextCursor(payload.nextCursor || null)
  }

  async function loadReplies(commentId: string, cursor?: string | null) {
    const query = new URLSearchParams({ parentId: commentId, limit: cursor ? '20' : '3' })
    if (cursor) query.set('cursor', cursor)
    const response = await fetch(`/api/anywhere-door/${postId}/comments?${query.toString()}`, { cache: 'no-store' })
    const payload = await response.json().catch(() => null)
    if (!response.ok) throw new Error(payload?.message || '回复加载失败')
    setComments((current) => current.map((comment) => comment.id === commentId ? {
      ...comment,
      replies: cursor ? [...comment.replies, ...(payload.comments || [])] : (payload.comments || []),
      replyCount: payload.replyCount ?? comment.replyCount,
      repliesNextCursor: payload.nextCursor || null,
    } : comment))
  }

  async function submit() {
    if (!content.trim() || busy) return
    setBusy(true)
    setMessage('')
    try {
      const response = await fetch(`/api/anywhere-door/${postId}/comments`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content, parentId: replyTo?.id || undefined }),
      })
      const payload = await response.json().catch(() => null)
      if (!response.ok) throw new Error(payload?.message || '评论失败')
      const created = payload.comment
      const next: SocialCommentView = {
        id: created.id, content: created.content, createdAt: created.createdAt,
        author: created.author, canDelete: true, replies: [], replyCount: 0, repliesNextCursor: null,
      }
      setComments((current) => {
        if (!replyTo) return [...current, next]
        return current.map((comment) => comment.id === replyTo.id ? { ...comment, replies: [...comment.replies, next], replyCount: comment.replyCount + 1 } : comment)
      })
      setContent('')
      setReplyTo(null)
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '评论失败，请稍后重试')
    } finally {
      setBusy(false)
    }
  }

  async function remove(commentId: string) {
    const response = await fetch(`/api/anywhere-door/comments/${commentId}`, { method: 'DELETE' })
    if (!response.ok) {
      const payload = await response.json().catch(() => null)
      setMessage(payload?.message || '删除失败')
      return
    }
    setComments((current) => current.filter((comment) => comment.id !== commentId).map((comment) => ({ ...comment, replies: comment.replies.filter((reply) => reply.id !== commentId), replyCount: comment.replies.some((reply) => reply.id === commentId) ? Math.max(0, comment.replyCount - 1) : comment.replyCount })))
  }

  return (
    <section className="mt-6 rounded-[28px] border border-sky-100 bg-white/90 p-4 shadow-sm sm:p-6">
      <div className="flex items-center justify-between gap-3"><h2 className="text-xl font-black text-brand-950">院友评论</h2><span className="text-xs font-bold text-slate-400">{comments.length} 条主评论</span></div>
      <div className="mt-4 space-y-3">
        {comments.length ? comments.map((comment) => (
          <div key={comment.id} id={`comment-${comment.id}`} className="rounded-2xl bg-sky-50/60 p-3">
            <div className="flex items-center justify-between gap-2 text-xs font-black text-brand-900"><span>{comment.author.nickname}</span><time dateTime={comment.createdAt}>{formatDate(comment.createdAt)}</time></div>
            <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-6 text-slate-700">{comment.content}</p>
            <div className="mt-2 flex gap-3 text-xs font-black text-brand-700"><button type="button" onClick={() => setReplyTo(comment)} className="hover:underline">回复</button>{comment.canDelete ? <button type="button" onClick={() => void remove(comment.id)} className="text-red-600 hover:underline">删除</button> : null}</div>
            {comment.replies.length ? <div className="mt-3 space-y-2 border-l-2 border-sky-200 pl-3">{comment.replies.map((reply) => <div key={reply.id} id={`comment-${reply.id}`} className="rounded-xl bg-white p-3"><div className="flex items-center justify-between gap-2 text-xs font-black text-brand-900"><span>{reply.author.nickname}</span><time dateTime={reply.createdAt}>{formatDate(reply.createdAt)}</time></div><p className="mt-1 whitespace-pre-wrap break-words text-sm leading-6 text-slate-700">{reply.content}</p>{reply.canDelete ? <button type="button" onClick={() => void remove(reply.id)} className="mt-1 text-xs font-black text-red-600 hover:underline">删除</button> : null}</div>)}</div> : null}
            {comment.replyCount > comment.replies.length || comment.repliesNextCursor ? <button type="button" onClick={() => void loadReplies(comment.id, comment.repliesNextCursor)} className="mt-2 text-xs font-black text-brand-700 hover:underline">{comment.replies.length ? `查看更多回复（${comment.replyCount}）` : `查看 ${comment.replyCount} 条回复`}</button> : null}
          </div>
        )) : <p className="py-5 text-center text-sm font-bold text-slate-400">还没有评论，来留下第一句吧。</p>}
      </div>
      {nextCursor ? <button type="button" onClick={() => void loadComments(nextCursor)} className="mt-4 min-h-10 rounded-full border border-sky-200 px-4 text-xs font-black text-brand-700 hover:bg-sky-50">加载更多评论</button> : null}
      <div className="mt-5 border-t border-sky-100 pt-4">
        {replyTo ? <div className="mb-2 flex items-center justify-between rounded-xl bg-amber-50 px-3 py-2 text-xs font-bold text-amber-800"><span>正在回复 {replyTo.author.nickname}</span><button type="button" onClick={() => setReplyTo(null)} className="font-black">取消</button></div> : null}
        <textarea value={content} onChange={(event) => setContent(event.target.value)} maxLength={500} rows={3} placeholder="写下你的评论…" className="w-full resize-y rounded-2xl border border-sky-100 bg-white px-3 py-3 text-sm font-medium outline-none ring-brand-200 focus:ring-2" />
        {message ? <p className="mt-2 text-xs font-bold text-red-600" role="alert">{message}</p> : null}
        <button type="button" disabled={busy || !content.trim()} onClick={() => void submit()} className="mt-3 min-h-10 rounded-full bg-brand-950 px-5 text-sm font-black text-white disabled:opacity-40">{busy ? '发送中…' : '发表评论'}</button>
      </div>
    </section>
  )
}
