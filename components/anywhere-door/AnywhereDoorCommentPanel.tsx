'use client'

import { useState } from 'react'
import type { SocialCommentView } from '@/lib/social-posts'

function formatDate(value: string) {
  return new Intl.DateTimeFormat('zh-CN', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value))
}

export function AnywhereDoorCommentPanel({ postId, initialComments, initialNextCursor, embedded = false }: Readonly<{ postId: string; initialComments: SocialCommentView[]; initialNextCursor?: string | null; embedded?: boolean }>) {
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
    <section className={embedded ? 'anywhere-door-comments anywhere-door-comments-embedded flex min-h-0 flex-1 flex-col overflow-visible border-t p-4 lg:overflow-hidden lg:border-t-0 lg:p-5' : 'anywhere-door-comments anywhere-door-comments-standalone mt-6 border p-4 shadow-sm sm:p-6'} data-anywhere-door-comments={embedded ? 'embedded' : 'standalone'}>
      <div className="flex shrink-0 items-center justify-between gap-3"><h2 className="anywhere-door-comments-heading text-xl font-black">院友评论</h2><span className="anywhere-door-comment-count text-xs font-bold">{comments.length} 条主评论</span></div>
      <div className={`anywhere-door-comment-list mt-4 space-y-3 ${embedded ? 'min-h-0 flex-1 lg:overflow-y-auto lg:pr-1' : ''}`}>
        {comments.length ? comments.map((comment) => (
          <div key={comment.id} id={`comment-${comment.id}`} className="anywhere-door-comment-item border-b pb-3 last:border-0">
            <div className="anywhere-door-comment-author flex items-center justify-between gap-2 text-xs font-black"><span>{comment.author.nickname}</span><time className="anywhere-door-comment-time" dateTime={comment.createdAt}>{formatDate(comment.createdAt)}</time></div>
            <p className="anywhere-door-comment-content mt-2 whitespace-pre-wrap break-words text-sm leading-6">{comment.content}</p>
            <div className="anywhere-door-comment-actions mt-2 flex gap-3 text-xs font-black"><button type="button" onClick={() => setReplyTo(comment)} className="hover:underline">回复</button>{comment.canDelete ? <button type="button" onClick={() => void remove(comment.id)} className="text-red-600 hover:underline dark:text-red-300">删除</button> : null}</div>
            {comment.replies.length ? <div className="anywhere-door-comment-replies mt-3 space-y-2 border-l-2 pl-3">{comment.replies.map((reply) => <div key={reply.id} id={`comment-${reply.id}`} className="p-2"><div className="anywhere-door-comment-author flex items-center justify-between gap-2 text-xs font-black"><span>{reply.author.nickname}</span><time className="anywhere-door-comment-time" dateTime={reply.createdAt}>{formatDate(reply.createdAt)}</time></div><p className="anywhere-door-comment-content mt-1 whitespace-pre-wrap break-words text-sm leading-6">{reply.content}</p>{reply.canDelete ? <button type="button" onClick={() => void remove(reply.id)} className="mt-1 text-xs font-black text-red-600 hover:underline dark:text-red-300">删除</button> : null}</div>)}</div> : null}
            {comment.replyCount > comment.replies.length || comment.repliesNextCursor ? <button type="button" onClick={() => void loadReplies(comment.id, comment.repliesNextCursor)} className="anywhere-door-comment-actions mt-2 text-xs font-black hover:underline">{comment.replies.length ? `查看更多回复（${comment.replyCount}）` : `查看 ${comment.replyCount} 条回复`}</button> : null}
          </div>
        )) : <p className="py-5 text-center text-sm font-bold text-slate-400">还没有评论，来留下第一句吧。</p>}
      </div>
      {nextCursor ? <button type="button" onClick={() => void loadComments(nextCursor)} className="anywhere-door-load-more-comments mt-4 min-h-10 shrink-0 px-4 text-xs font-black">加载更多评论</button> : null}
      <div className="anywhere-door-comment-composer mt-5 shrink-0 border-t pt-4">
        {replyTo ? <div className="mb-2 flex items-center justify-between rounded-lg bg-amber-50 px-3 py-2 text-xs font-bold text-amber-800 dark:bg-amber-950/40 dark:text-amber-200"><span>正在回复 {replyTo.author.nickname}</span><button type="button" onClick={() => setReplyTo(null)} className="font-black">取消</button></div> : null}
        <textarea value={content} onChange={(event) => setContent(event.target.value)} maxLength={500} rows={3} placeholder="写下你的评论…" className="anywhere-door-comment-input w-full resize-y rounded-xl px-3 py-3 text-sm font-medium outline-none ring-brand-200 focus:ring-2" />
        {message ? <p className="mt-2 text-xs font-bold text-red-600 dark:text-red-300" role="alert">{message}</p> : null}
        <button type="button" disabled={busy || !content.trim()} onClick={() => void submit()} className="anywhere-door-comment-submit mt-3 min-h-10 rounded-full px-5 text-sm font-black disabled:opacity-40">{busy ? '发送中…' : '发表评论'}</button>
      </div>
    </section>
  )
}
