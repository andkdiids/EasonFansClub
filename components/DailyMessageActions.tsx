'use client'

import { useRef, useState } from 'react'
import { EmojiPicker } from '@/components/EmojiPicker'

export function DailyMessageActions({
  messageId,
  likeCount,
  favoriteCount,
  commentCount,
  initialLiked = false,
  initialFavorited = false,
  replyTo,
  onReplyCancel,
  onCommentCreated,
}: Readonly<{
  messageId: string
  likeCount: number
  favoriteCount: number
  commentCount: number
  initialLiked?: boolean
  initialFavorited?: boolean
  replyTo?: { id: string; name: string } | null
  onReplyCancel?: () => void
  onCommentCreated?: (comment: unknown) => void
}>) {
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const [comment, setComment] = useState('')
  const [error, setError] = useState('')
  const [isOpen, setIsOpen] = useState(false)
  const [isLiked, setIsLiked] = useState(initialLiked)
  const [likes, setLikes] = useState(Math.max(likeCount, 0))
  const [isFavorited, setIsFavorited] = useState(initialFavorited)
  const [favorites, setFavorites] = useState(Math.max(favoriteCount, 0))
  const [comments, setComments] = useState(Math.max(commentCount, 0))
  const [isSubmitting, setIsSubmitting] = useState(false)

  async function toggle(path: string, kind: 'like' | 'favorite') {
    if (isSubmitting) return
    setError('')
    setIsSubmitting(true)
    const response = await fetch(path, { method: 'POST' })
    const data = await response.json().catch(() => ({}))
    setIsSubmitting(false)

    if (!response.ok) {
      setError(data.message || '操作失败，请先登录')
      return
    }

    if (kind === 'like') {
      setIsLiked(Boolean(data.isLiked))
      setLikes(Math.max(Number(data.likeCount || 0), 0))
    } else {
      setIsFavorited(Boolean(data.isFavorited))
      setFavorites(Math.max(Number(data.favoriteCount || 0), 0))
    }
  }

  async function submitComment() {
    if (isSubmitting || !comment.trim()) return
    setError('')
    setIsSubmitting(true)
    const response = await fetch(`/api/daily-messages/${messageId}/comments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: comment, parentId: replyTo?.id }),
    })
    const data = await response.json().catch(() => ({}))
    setIsSubmitting(false)
    if (!response.ok) {
      setError(data.message || '评论失败，请稍后再试')
      return
    }
    setComment('')
    setComments((value) => value + 1)
    setIsOpen(false)
    onReplyCancel?.()
    onCommentCreated?.(data.comment)
  }

  return (
    <div className="mt-4 space-y-3">
      <div className="flex flex-wrap gap-2 text-sm font-black">
        <button
          onClick={() => toggle(`/api/daily-messages/${messageId}/like`, 'like')}
          disabled={isSubmitting}
          className={`rounded-full px-3 py-2 transition disabled:opacity-60 ${isLiked ? 'bg-red-50 text-red-600' : 'bg-sky-50 text-brand-700'}`}
        >
          {isLiked ? '♥' : '♡'} {likes}
        </button>
        <button
          onClick={() => {
            setIsOpen((value) => !value)
            if (!isOpen) onReplyCancel?.()
          }}
          className="rounded-full bg-sky-50 px-3 py-2 text-brand-700"
        >
          {replyTo ? `回复 ${replyTo.name}` : '评论'} {comments}
        </button>
        <button
          onClick={() => toggle(`/api/daily-messages/${messageId}/favorite`, 'favorite')}
          disabled={isSubmitting}
          className={`rounded-full px-3 py-2 transition disabled:opacity-60 ${isFavorited ? 'bg-amber-50 text-amber-700' : 'bg-sky-50 text-brand-700'}`}
        >
          {isFavorited ? '★' : '☆'} {favorites}
        </button>
      </div>

      {isOpen || replyTo ? (
        <div className="rounded-2xl border border-sky-100 bg-white p-3">
          {replyTo ? (
            <div className="mb-2 flex items-center justify-between rounded-xl bg-sky-50 px-3 py-2 text-xs font-black text-brand-700">
              <span>正在回复 {replyTo.name}</span>
              <button type="button" onClick={onReplyCancel} className="text-slate-500">取消</button>
            </div>
          ) : null}
          <textarea
            ref={textareaRef}
            value={comment}
            onChange={(event) => setComment(event.target.value.slice(0, 300))}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault()
                submitComment()
              }
            }}
            rows={3}
            placeholder="写一条温柔的回应，也支持 @ 好友。"
            className="w-full resize-none rounded-xl bg-sky-50 px-3 py-2 text-sm font-bold outline-none"
          />
          <div className="mt-2 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <EmojiPicker textareaRef={textareaRef} value={comment} onChange={setComment} maxLength={300} disabled={isSubmitting} />
              <span className="text-xs font-bold text-slate-400">{comment.length}/300</span>
            </div>
            <button onClick={submitComment} disabled={isSubmitting} className="rounded-lg bg-brand-700 px-4 py-2 text-sm font-black text-white disabled:opacity-60">
              {isSubmitting ? '发送中...' : '发送评论'}
            </button>
          </div>
        </div>
      ) : null}

      {error ? <p className="text-sm font-bold text-red-600">{error}</p> : null}
    </div>
  )
}
