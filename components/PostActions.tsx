'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'

export function LikeButton({
  postId,
  initialLiked,
  initialCount,
}: Readonly<{ postId: string; initialLiked: boolean; initialCount: number }>) {
  const router = useRouter()
  const [liked, setLiked] = useState(initialLiked)
  const [count, setCount] = useState(Math.max(initialCount, 0))
  const [error, setError] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)

  async function toggleLike() {
    if (isSubmitting) return
    const previousLiked = liked
    const previousCount = count
    const optimisticLiked = !liked
    setError('')
    setIsSubmitting(true)
    setLiked(optimisticLiked)
    setCount(Math.max(0, previousCount + (optimisticLiked ? 1 : -1)))
    try {
      const response = await fetch(`/api/posts/${postId}/like`, {
        method: previousLiked ? 'DELETE' : 'POST',
        cache: 'no-store',
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(data.message || '操作失败，请先登录')
      setLiked(Boolean(data.isLiked))
      setCount(Math.max(Number(data.likeCount || 0), 0))
      router.refresh()
    } catch (reason) {
      setLiked(previousLiked)
      setCount(previousCount)
      setError(reason instanceof Error ? reason.message : '点赞失败，请稍后重试')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div>
      <button
        type="button"
        onClick={(event) => { event.preventDefault(); event.stopPropagation(); void toggleLike() }}
        disabled={isSubmitting}
        className={`rounded-full px-4 py-2 font-black transition disabled:opacity-60 ${
          liked ? 'bg-red-50 text-red-600' : 'bg-sky-50 text-brand-700'
        }`}
      >
        {liked ? '♥' : '♡'} {count}
      </button>
      {error ? <p className="mt-2 text-sm font-bold text-red-600">{error}</p> : null}
    </div>
  )
}

export function FavoriteButton({
  postId,
  initialFavorited,
  initialCount,
}: Readonly<{ postId: string; initialFavorited: boolean; initialCount: number }>) {
  const router = useRouter()
  const [favorited, setFavorited] = useState(initialFavorited)
  const [count, setCount] = useState(Math.max(initialCount, 0))
  const [error, setError] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)

  async function toggleFavorite() {
    if (isSubmitting) return
    setError('')
    setIsSubmitting(true)
    const response = await fetch(`/api/posts/${postId}/favorite`, { method: 'POST' })
    const data = await response.json().catch(() => ({}))
    setIsSubmitting(false)

    if (!response.ok) {
      setError(data.message || '操作失败，请先登录')
      return
    }

    setFavorited(Boolean(data.isFavorited))
    setCount(Math.max(Number(data.favoriteCount || 0), 0))
    router.refresh()
  }

  return (
    <div>
      <button
        onClick={toggleFavorite}
        disabled={isSubmitting}
        className={`rounded-full px-4 py-2 font-black transition disabled:opacity-60 ${
          favorited ? 'bg-amber-50 text-amber-700' : 'bg-sky-50 text-brand-700'
        }`}
      >
        {favorited ? '★' : '☆'} {count}
      </button>
      {error ? <p className="mt-2 text-sm font-bold text-red-600">{error}</p> : null}
    </div>
  )
}

export function AdminPostActions({
  postId,
  isPinned,
  isFeatured,
  redirectTo,
  onDeleted,
}: Readonly<{
  postId: string
  isPinned: boolean
  isFeatured: boolean
  redirectTo?: string
  onDeleted?: () => void
}>) {
  const router = useRouter()
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)

  async function updatePost(payload: { isPinned?: boolean; isFeatured?: boolean; isDeleted?: boolean }) {
    if (isSubmitting) return
    setError('')
    setMessage('')
    setIsSubmitting(true)
    const response = await fetch(`/api/posts/${postId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    const data = await response.json().catch(() => ({}))
    setIsSubmitting(false)
    if (!response.ok) {
      setError(data.message || '管理员操作失败')
      return
    }

    if (payload.isDeleted) {
      setConfirmDelete(false)
      setMessage('帖子已成功删除。')
      onDeleted?.()
      if (redirectTo) {
        setTimeout(() => {
          router.replace(redirectTo)
        }, 700)
      }
      return
    }

    router.refresh()
  }

  return (
    <div className="relative flex flex-wrap items-center gap-2">
      <button
        onClick={() => updatePost({ isPinned: !isPinned })}
        disabled={isSubmitting}
        className="rounded-lg border border-sky-200 px-3 py-2 text-sm font-black disabled:opacity-60"
      >
        {isPinned ? '取消置顶' : '置顶'}
      </button>
      <button
        onClick={() => updatePost({ isFeatured: !isFeatured })}
        disabled={isSubmitting}
        className="rounded-lg border border-sky-200 px-3 py-2 text-sm font-black disabled:opacity-60"
      >
        {isFeatured ? '取消精华' : '设为精华'}
      </button>
      <button
        onClick={() => setConfirmDelete(true)}
        disabled={isSubmitting}
        className="rounded-lg border border-red-200 px-3 py-2 text-sm font-black text-red-600 disabled:opacity-60"
      >
        {isSubmitting ? '处理中...' : '删除'}
      </button>

      {confirmDelete ? (
        <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/25 px-4 backdrop-blur-sm">
          <div className="w-full max-w-sm rounded-[24px] border border-sky-100 bg-white p-6 shadow-2xl shadow-sky-900/15">
            <h3 className="text-xl font-black text-brand-950">确认删除</h3>
            <p className="mt-3 text-sm font-bold leading-7 text-slate-600">删除后将无法恢复，是否继续？</p>
            <div className="mt-6 flex justify-end gap-3">
              <button
                onClick={() => setConfirmDelete(false)}
                disabled={isSubmitting}
                className="rounded-full bg-sky-50 px-5 py-3 text-sm font-black text-brand-700 disabled:opacity-60"
              >
                取消
              </button>
              <button
                onClick={() => updatePost({ isDeleted: true })}
                disabled={isSubmitting}
                className="rounded-full bg-red-600 px-5 py-3 text-sm font-black text-white disabled:opacity-60"
              >
                {isSubmitting ? '删除中...' : '确认删除'}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {message ? <p className="w-full text-sm font-bold text-emerald-600">{message}</p> : null}
      {error ? <p className="w-full text-sm font-bold text-red-600">{error}</p> : null}
    </div>
  )
}

export function DeletePostButton({
  postId,
  redirectTo,
  onDeleted,
  label = '删除',
}: Readonly<{
  postId: string
  redirectTo?: string
  onDeleted?: () => void
  label?: string
}>) {
  const router = useRouter()
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)

  async function deletePost() {
    if (isDeleting) return
    setError('')
    setMessage('')
    setIsDeleting(true)
    const response = await fetch(`/api/posts/${postId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ isDeleted: true }),
    })
    const data = await response.json().catch(() => ({}))
    setIsDeleting(false)

    if (!response.ok) {
      setError(data.message || '删除失败，请稍后再试')
      return
    }

    setConfirmDelete(false)
    setMessage('帖子已删除')
    onDeleted?.()
    if (redirectTo) {
      setTimeout(() => {
        router.replace(redirectTo)
      }, 700)
    } else {
      router.refresh()
    }
  }

  return (
    <div className="relative flex flex-wrap items-center gap-2">
      <button
        type="button"
        onClick={() => setConfirmDelete(true)}
        disabled={isDeleting}
        className="rounded-lg border border-red-200 px-3 py-2 text-sm font-black text-red-600 disabled:opacity-60"
      >
        {isDeleting ? '删除中...' : label}
      </button>

      {confirmDelete ? (
        <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/25 px-4 backdrop-blur-sm">
          <div className="w-full max-w-sm rounded-[24px] border border-sky-100 bg-white p-6 shadow-2xl shadow-sky-900/15">
            <h3 className="text-xl font-black text-brand-950">确认删除帖子</h3>
            <p className="mt-3 text-sm font-bold leading-7 text-slate-600">删除后普通用户无法再看到这篇帖子，是否继续？</p>
            <div className="mt-6 flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setConfirmDelete(false)}
                disabled={isDeleting}
                className="rounded-full bg-sky-50 px-5 py-3 text-sm font-black text-brand-700 disabled:opacity-60"
              >
                取消
              </button>
              <button
                type="button"
                onClick={deletePost}
                disabled={isDeleting}
                className="rounded-full bg-red-600 px-5 py-3 text-sm font-black text-white disabled:opacity-60"
              >
                {isDeleting ? '删除中...' : '确认删除'}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {message ? <p className="w-full text-sm font-bold text-emerald-600">{message}</p> : null}
      {error ? <p className="w-full text-sm font-bold text-red-600">{error}</p> : null}
    </div>
  )
}
