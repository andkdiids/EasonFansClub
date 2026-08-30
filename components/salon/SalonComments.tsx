'use client'

import Link from 'next/link'
import { useMemo, useState, type CSSProperties, type FormEvent } from 'react'
import { SafeAvatar } from '@/components/SafeAvatar'
import { formatUid } from '@/lib/uid'
import type { SalonCommentView } from '@/lib/salon'

type CommentNode = SalonCommentView & { children: CommentNode[] }

function buildCommentTree(comments: SalonCommentView[]) {
  const byId = new Map<string, CommentNode>()
  comments.forEach((comment) => byId.set(comment.id, { ...comment, children: [] }))
  const roots: CommentNode[] = []
  byId.forEach((comment) => {
    const parent = comment.parentId ? byId.get(comment.parentId) : null
    if (parent) parent.children.push(comment)
    else roots.push(comment)
  })
  return roots
}

export function SalonComments({ postId, initialComments, initialCommentCount, initialHasMore, initialNextCursor, currentUserId, canModerate }: Readonly<{
  postId: string
  initialComments: SalonCommentView[]
  initialCommentCount: number
  initialHasMore: boolean
  initialNextCursor: string | null
  currentUserId: string | null
  canModerate: boolean
}>) {
  const [comments, setComments] = useState(initialComments)
  const [commentCount, setCommentCount] = useState(initialCommentCount)
  const [replyTo, setReplyTo] = useState<SalonCommentView | null>(null)
  const [content, setContent] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [hasMore, setHasMore] = useState(initialHasMore)
  const [nextCursor, setNextCursor] = useState(initialNextCursor)
  const [error, setError] = useState('')
  const tree = useMemo(() => buildCommentTree(comments), [comments])

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!currentUserId) { window.location.href = `/login?redirect=${encodeURIComponent(`/salon/${postId}#salon-comments`)}`; return }
    if (submitting || content.trim().length < 2) { setError('评论至少需要 2 个字符'); return }
    setSubmitting(true)
    setError('')
    try {
      const response = await fetch(`/api/salon/posts/${encodeURIComponent(postId)}/comments`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ content, parentId: replyTo?.id || null }) })
      const data = await response.json().catch(() => null) as { comment?: SalonCommentView; message?: string } | null
      if (response.status === 401) { window.location.href = `/login?redirect=${encodeURIComponent(`/salon/${postId}#salon-comments`)}`; return }
      if (!response.ok || !data?.comment) throw new Error(data?.message || '评论失败')
      setComments((current) => [...current, data.comment!])
      setCommentCount((value) => value + 1)
      setContent('')
      setReplyTo(null)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '评论失败，请稍后重试')
    } finally {
      setSubmitting(false)
    }
  }

  async function loadMore() {
    if (!nextCursor || loadingMore) return
    setLoadingMore(true)
    try {
      const response = await fetch(`/api/salon/posts/${encodeURIComponent(postId)}/comments?cursor=${encodeURIComponent(nextCursor)}`, { cache: 'no-store' })
      const data = await response.json().catch(() => null) as { comments?: SalonCommentView[]; hasMore?: boolean; nextCursor?: string | null; message?: string } | null
      if (!response.ok) throw new Error(data?.message || '更多评论加载失败')
      setComments((current) => [...current, ...(data?.comments || [])])
      setHasMore(data?.hasMore === true)
      setNextCursor(data?.nextCursor || null)
    } catch (caught) { setError(caught instanceof Error ? caught.message : '更多评论加载失败') } finally { setLoadingMore(false) }
  }

  async function remove(comment: SalonCommentView) {
    if (!window.confirm('确定删除这条评论吗？')) return
    const response = await fetch(`/api/salon/comments/${encodeURIComponent(comment.id)}`, { method: 'DELETE' })
    const data = await response.json().catch(() => null) as { commentCount?: number; message?: string } | null
    if (!response.ok) { setError(data?.message || '删除评论失败'); return }
    setComments((current) => {
      const removed = new Set([comment.id])
      let changed = true
      while (changed) {
        changed = false
        current.forEach((item) => {
          if (item.parentId && removed.has(item.parentId) && !removed.has(item.id)) {
            removed.add(item.id)
            changed = true
          }
        })
      }
      return current.filter((item) => !removed.has(item.id))
    })
    setCommentCount(typeof data?.commentCount === 'number' ? data.commentCount : Math.max(0, commentCount - 1))
  }

  return <section id="salon-comments" className="salon-comments"><div className="salon-comments-heading"><div><p className="salon-kicker">DISCUSSION</p><h2>评论 {commentCount}</h2></div>{hasMore ? <button type="button" onClick={() => void loadMore()} disabled={loadingMore} className="salon-secondary-button">{loadingMore ? '加载中…' : '加载更多'}</button> : null}</div>
    {currentUserId ? <form className="salon-comment-form" onSubmit={submit}>{replyTo ? <div className="salon-reply-target">正在回复 {replyTo.author.nickname}<button type="button" onClick={() => setReplyTo(null)}>取消</button></div> : null}<textarea value={content} onChange={(event) => setContent(event.target.value)} rows={3} maxLength={2000} placeholder={replyTo ? `回复 ${replyTo.author.nickname}…` : '留下你的现场感受…'} /><div><span>{content.length}/2000</span><button type="submit" disabled={submitting}>{submitting ? '发布中…' : '发表评论'}</button></div></form> : <p className="salon-comment-login"><Link href={`/login?redirect=${encodeURIComponent(`/salon/${postId}#salon-comments`)}`}>登录</Link> 后参与评论。</p>}
    {error ? <p className="salon-form-error" role="alert">{error}</p> : null}
    {!tree.length ? <p className="salon-comments-empty">还没有评论，来留下第一句吧。</p> : <div className="salon-comment-list">{tree.map((comment) => <SalonCommentItem key={comment.id} comment={comment} depth={0} currentUserId={currentUserId} canModerate={canModerate} onReply={setReplyTo} onDelete={remove} />)}</div>}
  </section>
}

function SalonCommentItem({ comment, depth, currentUserId, canModerate, onReply, onDelete }: Readonly<{ comment: CommentNode; depth: number; currentUserId: string | null; canModerate: boolean; onReply: (comment: SalonCommentView) => void; onDelete: (comment: SalonCommentView) => void }>) {
  return <article className="salon-comment-item" style={{ '--salon-comment-depth': Math.min(depth, 4) } as CSSProperties}><div className="salon-comment-author"><Link href={`/user/${formatUid(comment.author.uid)}`}><SafeAvatar src={comment.author.avatarUrl} name={comment.author.nickname} uid={comment.author.uid} className="salon-comment-avatar" textClassName="salon-avatar-fallback" variant="avatar-sm" /></Link><Link href={`/user/${formatUid(comment.author.uid)}`} className="salon-comment-name">{comment.author.nickname}</Link><time>{new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium' }).format(new Date(comment.createdAt))}</time></div><p>{comment.content}</p><div className="salon-comment-actions"><button type="button" onClick={() => onReply(comment)}>回复</button>{currentUserId === comment.author.id || canModerate ? <button type="button" onClick={() => void onDelete(comment)} className="is-danger">删除</button> : null}</div>{comment.children.length ? <div className="salon-comment-replies">{comment.children.map((child) => <SalonCommentItem key={child.id} comment={child} depth={depth + 1} currentUserId={currentUserId} canModerate={canModerate} onReply={onReply} onDelete={onDelete} />)}</div> : null}</article>
}
