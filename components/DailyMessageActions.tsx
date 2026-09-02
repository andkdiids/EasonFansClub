'use client'

import { useEffect, useRef, useState } from 'react'
import { EmojiPicker } from '@/components/EmojiPicker'
import { ReplyLengthCounter } from '@/components/ReplyLengthCounter'
import { redirectToLoginAfterConfirmedSessionInvalid } from '@/lib/client-auth'
import { getReplyLengthMetrics, replyTooLongMessage } from '@/lib/reply-length'

export function DailyMessageActions({
  messageId,
  liked,
  likeCount,
  favoriteCount,
  commentCount,
  initialFavorited = false,
  replyTo,
  onReplyCancel,
  onCommentCreated,
  onLikeChange,
}: Readonly<{
  messageId: string
  liked: boolean
  likeCount: number
  favoriteCount: number
  commentCount: number
  initialFavorited?: boolean
  replyTo?: { id: string; name: string } | null
  onReplyCancel?: () => void
  onCommentCreated?: (comment: unknown) => void
  onLikeChange?: (value: { liked: boolean; likeCount: number }) => void
}>) {
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const [comment, setComment] = useState('')
  const [error, setError] = useState('')
  const [isOpen, setIsOpen] = useState(false)
  // 点赞状态以「服务端返回 + 共享上下文」为唯一可信源：props 变化（翻页重挂 / 另一面板同步）即同步展示，
  // 不再依赖组件内部一次性初始化的临时 state，避免翻页后回退到旧状态或双面板不同步。
  const [isLiked, setIsLiked] = useState(liked)
  const [likes, setLikes] = useState(Math.max(likeCount, 0))
  const [isFavorited, setIsFavorited] = useState(initialFavorited)
  const [favorites, setFavorites] = useState(Math.max(favoriteCount, 0))
  const [comments, setComments] = useState(Math.max(commentCount, 0))
  const [isSubmitting, setIsSubmitting] = useState(false)
  const commentLength = getReplyLengthMetrics(comment)
  const isOverLimit = commentLength.exceededBy > 0
  // 点赞请求独立的 pending 标记（每条留言各自一个组件实例，天然按记录隔离），
  // 不与评论提交 / 收藏共享，避免一个操作禁用全部按钮。
  const [isLikePending, setIsLikePending] = useState(false)

  useEffect(() => {
    setIsLiked(liked)
    setLikes(Math.max(likeCount, 0))
  }, [liked, likeCount])

  // 乐观更新：先本地切换，请求成功用接口权威值覆盖，失败完整回滚并提示。
  async function toggleLike() {
    if (isSubmitting || isLikePending) return
    setError('')
    const previousLiked = isLiked
    const previousLikes = likes
    const optimisticLiked = !previousLiked
    const optimisticLikes = Math.max(previousLikes + (optimisticLiked ? 1 : -1), 0)
    setIsLiked(optimisticLiked)
    setLikes(optimisticLikes)
    onLikeChange?.({ liked: optimisticLiked, likeCount: optimisticLikes })
    setIsLikePending(true)
    try {
      const response = await fetch(`/api/daily-messages/${messageId}/like`, { method: 'POST' })
      const data = await response.json().catch(() => ({}))
      if (response.status === 401 && await redirectToLoginAfterConfirmedSessionInvalid(response, `/api/daily-messages/${messageId}/like`)) {
        setIsLiked(previousLiked)
        setLikes(previousLikes)
        onLikeChange?.({ liked: previousLiked, likeCount: previousLikes })
        return
      }
      if (!response.ok) {
        throw new Error(response.status === 401 ? '登录状态暂时无法确认，请稍后重试' : typeof data.message === 'string' ? data.message : '操作失败，请稍后再试')
      }
      const serverLiked = Boolean(data.isLiked)
      const serverCount = Math.max(Number(data.likeCount || 0), 0)
      setIsLiked(serverLiked)
      setLikes(serverCount)
      // 通知父组件 / 共享上下文：翻页与「E友留言 / 好友留言」双面板实时同步。
      onLikeChange?.({ liked: serverLiked, likeCount: serverCount })
    } catch (likeError) {
      setIsLiked(previousLiked)
      setLikes(previousLikes)
      onLikeChange?.({ liked: previousLiked, likeCount: previousLikes })
      setError(likeError instanceof Error ? likeError.message : '操作失败，请稍后再试')
    } finally {
      setIsLikePending(false)
    }
  }

  async function toggleFavorite() {
    if (isSubmitting) return
    setError('')
    setIsSubmitting(true)
    const response = await fetch(`/api/daily-messages/${messageId}/favorite`, { method: 'POST' })
    const data = await response.json().catch(() => ({}))
    setIsSubmitting(false)

    if (!response.ok) {
      if (response.status === 401 && await redirectToLoginAfterConfirmedSessionInvalid(response, `/api/daily-messages/${messageId}/favorite`)) return
      setError(response.status === 401 ? '登录状态暂时无法确认，请稍后重试' : data.message || '操作失败，请稍后再试')
      return
    }

    setIsFavorited(Boolean(data.isFavorited))
    setFavorites(Math.max(Number(data.favoriteCount || 0), 0))
  }

  async function submitComment() {
    if (isSubmitting) return
    if (isOverLimit) {
      setError(replyTooLongMessage(commentLength, '评论'))
      return
    }
    if (!comment.trim()) return
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
      if (response.status === 401 && await redirectToLoginAfterConfirmedSessionInvalid(response, `/api/daily-messages/${messageId}/comments`)) return
      setError(response.status === 401 ? '登录状态暂时无法确认，请稍后重试' : data.message || '评论失败，请稍后再试')
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
          onClick={() => void toggleLike()}
          disabled={isSubmitting || isLikePending}
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
          onClick={() => void toggleFavorite()}
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
            onChange={(event) => setComment(event.target.value)}
            onKeyDown={(event) => {
              if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return
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
              <EmojiPicker textareaRef={textareaRef} value={comment} onChange={setComment} disabled={isSubmitting} />
              <ReplyLengthCounter value={comment} />
            </div>
            <button onClick={submitComment} disabled={isSubmitting || isOverLimit} className="rounded-lg bg-brand-700 px-4 py-2 text-sm font-black text-white disabled:opacity-60">
              {isSubmitting ? '发送中...' : '发送评论'}
            </button>
          </div>
        </div>
      ) : null}

      {error ? <p className="text-sm font-bold text-red-600">{error}</p> : null}
    </div>
  )
}
