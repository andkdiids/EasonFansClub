'use client'

import { useRouter } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'

type PostInteractionDetail = {
  postId?: string
  isLiked?: boolean
  likeCount?: number
  isFavorited?: boolean
  favoriteCount?: number
}

function emitPostInteraction(detail: PostInteractionDetail) {
  window.dispatchEvent(new CustomEvent('ecfc:post-interaction', { detail }))
  try {
    for (let index = 0; index < window.sessionStorage.length; index += 1) {
      const key = window.sessionStorage.key(index)
      if (!key?.startsWith('forum-discovery-session:')) continue
      const raw = window.sessionStorage.getItem(key)
      if (!raw) continue
      const session = JSON.parse(raw) as { posts?: Array<Record<string, unknown>> }
      if (!Array.isArray(session.posts)) continue
      const posts = session.posts.map((post) => post.id === detail.postId
        ? { ...post, ...(typeof detail.isLiked === 'boolean' ? { likedByMe: detail.isLiked } : {}), ...(typeof detail.likeCount === 'number' ? { likeCount: detail.likeCount } : {}), ...(typeof detail.isFavorited === 'boolean' ? { favoritedByMe: detail.isFavorited } : {}), ...(typeof detail.favoriteCount === 'number' ? { favoriteCount: detail.favoriteCount } : {}) }
        : post)
      window.sessionStorage.setItem(key, JSON.stringify({ ...session, posts }))
    }
  } catch {
    // Interaction state still updates in mounted components if storage is unavailable.
  }
}

export function LikeButton({
  postId,
  initialLiked,
  initialCount,
  className,
  refreshOnSuccess = true,
}: Readonly<{ postId: string; initialLiked: boolean; initialCount: number; className?: string; refreshOnSuccess?: boolean }>) {
  const router = useRouter()
  const [liked, setLiked] = useState(initialLiked)
  const [count, setCount] = useState(Math.max(initialCount, 0))
  const [error, setError] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)

  useEffect(() => {
    const syncInteraction = (event: Event) => {
      const detail = (event as CustomEvent<PostInteractionDetail>).detail
      if (detail?.postId !== postId || typeof detail.isLiked !== 'boolean') return
      setLiked(detail.isLiked)
      if (typeof detail.likeCount === 'number') setCount(Math.max(detail.likeCount, 0))
    }
    window.addEventListener('ecfc:post-interaction', syncInteraction)
    return () => window.removeEventListener('ecfc:post-interaction', syncInteraction)
  }, [postId])

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
      emitPostInteraction({ postId, isLiked: Boolean(data.isLiked), likeCount: Number(data.likeCount || 0) })
      if (refreshOnSuccess) router.refresh()
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
        aria-pressed={liked}
        data-liked={liked}
        className={className || `interaction-button rounded-full px-4 py-2 font-black transition disabled:opacity-60 ${
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
  className,
  refreshOnSuccess = true,
}: Readonly<{ postId: string; initialFavorited: boolean; initialCount: number; className?: string; refreshOnSuccess?: boolean }>) {
  const router = useRouter()
  const [favorited, setFavorited] = useState(initialFavorited)
  const [count, setCount] = useState(Math.max(initialCount, 0))
  const [error, setError] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)

  useEffect(() => {
    const syncInteraction = (event: Event) => {
      const detail = (event as CustomEvent<PostInteractionDetail>).detail
      if (detail?.postId !== postId || typeof detail.isFavorited !== 'boolean') return
      setFavorited(detail.isFavorited)
      if (typeof detail.favoriteCount === 'number') setCount(Math.max(detail.favoriteCount, 0))
    }
    window.addEventListener('ecfc:post-interaction', syncInteraction)
    return () => window.removeEventListener('ecfc:post-interaction', syncInteraction)
  }, [postId])

  async function toggleFavorite() {
    if (isSubmitting) return
    setError('')
    setIsSubmitting(true)
    const nextFavorited = !favorited
    try {
      const response = await fetch(`/api/posts/${postId}/favorite`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isFavorited: nextFavorited }),
      })
      const data = await response.json().catch(() => ({}))

      if (!response.ok) {
      setError(data.message || '操作失败，请先登录')
        return
      }

      setFavorited(Boolean(data.isFavorited))
      setCount(Math.max(Number(data.favoriteCount || 0), 0))
      emitPostInteraction({ postId, isFavorited: Boolean(data.isFavorited), favoriteCount: Number(data.favoriteCount || 0) })
      if (refreshOnSuccess) router.refresh()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '操作失败，请稍后重试')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div>
      <button
        onClick={toggleFavorite}
        disabled={isSubmitting}
        aria-pressed={favorited}
        data-favorited={favorited}
        className={className || `interaction-button rounded-full px-4 py-2 font-black transition disabled:opacity-60 ${
          favorited ? 'bg-amber-50 text-amber-700' : 'bg-sky-50 text-brand-700'
        }`}
      >
        {favorited ? '★' : '☆'} {count}
      </button>
      {error ? <p className="mt-2 text-sm font-bold text-red-600">{error}</p> : null}
    </div>
  )
}

export function PostManagementMenu({
  postId,
  initialIsPinned,
  initialIsFeatured,
  canManage,
  canDelete,
  canEdit,
  redirectTo = '/forum',
}: Readonly<{
  postId: string
  initialIsPinned: boolean
  initialIsFeatured: boolean
  canManage: boolean
  canDelete: boolean
  canEdit: boolean
  redirectTo?: string
}>) {
  const router = useRouter()
  const menuRef = useRef<HTMLDivElement>(null)
  const [menuOpen, setMenuOpen] = useState(false)
  const [isPinned, setIsPinned] = useState(initialIsPinned)
  const [isFeatured, setIsFeatured] = useState(initialIsFeatured)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!menuOpen) return
    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setMenuOpen(false)
    }
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMenuOpen(false)
    }
    document.addEventListener('pointerdown', closeOnOutsidePointer)
    window.addEventListener('keydown', closeOnEscape)
    return () => {
      document.removeEventListener('pointerdown', closeOnOutsidePointer)
      window.removeEventListener('keydown', closeOnEscape)
    }
  }, [menuOpen])

  if (!canManage && !canDelete && !canEdit) return null

  async function updatePost(payload: { isPinned?: boolean; isFeatured?: boolean; isDeleted?: boolean }) {
    if (isSubmitting) return
    const previousPinned = isPinned
    const previousFeatured = isFeatured
    if (typeof payload.isPinned === 'boolean') setIsPinned(payload.isPinned)
    if (typeof payload.isFeatured === 'boolean') setIsFeatured(payload.isFeatured)
    setError('')
    setIsSubmitting(true)
    try {
      const response = await fetch(`/api/posts/${postId}`, payload.isDeleted
        ? { method: 'DELETE', cache: 'no-store' }
        : {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
          })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(typeof data.message === 'string' ? data.message : '\u64cd\u4f5c\u5931\u8d25\uff0c\u8bf7\u7a0d\u540e\u91cd\u8bd5')
      if (typeof data.post?.isPinned === 'boolean') setIsPinned(data.post.isPinned)
      if (typeof data.post?.isFeatured === 'boolean') setIsFeatured(data.post.isFeatured)
      if (payload.isDeleted) {
        setConfirmDelete(false)
        router.replace(redirectTo)
        return
      }
      setMenuOpen(false)
      router.refresh()
    } catch (reason) {
      if (typeof payload.isPinned === 'boolean') setIsPinned(previousPinned)
      if (typeof payload.isFeatured === 'boolean') setIsFeatured(previousFeatured)
      setError(reason instanceof Error ? reason.message : '\u64cd\u4f5c\u5931\u8d25\uff0c\u8bf7\u7a0d\u540e\u91cd\u8bd5')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div ref={menuRef} className="post-management-menu">
      <button
        type="button"
        className="post-management-menu-trigger"
        aria-label={'\u5e16\u5b50\u64cd\u4f5c'}
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        onClick={() => setMenuOpen((value) => !value)}
      >
        ⋯
      </button>
      {menuOpen ? (
        <div className="post-management-menu-panel" role="menu">
          {canEdit ? (
            <button
              type="button"
              role="menuitem"
              disabled={isSubmitting}
              onClick={() => { setMenuOpen(false); router.push(`/posts/${postId}/edit`) }}
            >
              编辑帖子
            </button>
          ) : null}
          {canManage ? (
            <>
              <button type="button" role="menuitem" disabled={isSubmitting} onClick={() => void updatePost({ isPinned: !isPinned })}>
                {isPinned ? '\u53d6\u6d88\u7f6e\u9876' : '\u7f6e\u9876\u5e16\u5b50'}
              </button>
              <button type="button" role="menuitem" disabled={isSubmitting} onClick={() => void updatePost({ isFeatured: !isFeatured })}>
                {isFeatured ? '\u53d6\u6d88\u7cbe\u534e' : '\u8bbe\u4e3a\u7cbe\u534e'}
              </button>
            </>
          ) : null}
          {canDelete ? (
            <button
              type="button"
              role="menuitem"
              className="is-danger"
              disabled={isSubmitting}
              onClick={() => { setMenuOpen(false); setConfirmDelete(true) }}
            >
              {'\u5220\u9664\u5e16\u5b50'}
            </button>
          ) : null}
          {error ? <p role="alert">{error}</p> : null}
        </div>
      ) : null}
      {confirmDelete ? (
        <div className="post-management-menu-confirm-backdrop" role="presentation">
          <div className="post-management-menu-confirm" role="dialog" aria-modal="true" aria-labelledby={`post-delete-title-${postId}`}>
            <h2 id={`post-delete-title-${postId}`}>{'\u786e\u8ba4\u5220\u9664\u5e16\u5b50'}</h2>
            <p>{'\u5220\u9664\u540e\u5c06\u65e0\u6cd5\u6062\u590d\uff0c\u786e\u5b9a\u7ee7\u7eed\uff1f'}</p>
            <div>
              <button type="button" disabled={isSubmitting} onClick={() => setConfirmDelete(false)}>{'\u53d6\u6d88'}</button>
              <button type="button" className="is-danger" disabled={isSubmitting} onClick={() => void updatePost({ isDeleted: true })}>
                {isSubmitting ? '\u5220\u9664\u4e2d...' : '\u786e\u8ba4\u5220\u9664'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
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
    try {
      const response = await fetch(`/api/posts/${postId}`, payload.isDeleted
        ? { method: 'DELETE', cache: 'no-store' }
        : {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
          })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(typeof data.message === 'string' ? data.message : '管理员操作失败，请稍后重试')

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
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '管理员操作失败，请稍后重试')
    } finally {
      setIsSubmitting(false)
    }
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
            <h3 className="text-xl font-black text-brand-950">确认删除帖子</h3>
            <p className="mt-3 text-sm font-bold leading-7 text-slate-600">删除后将无法恢复，确定继续？</p>
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
    try {
      const response = await fetch(`/api/posts/${postId}`, { method: 'DELETE', cache: 'no-store' })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(typeof data.message === 'string' ? data.message : '删除帖子失败，请稍后重试')

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
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '删除帖子失败，请稍后重试')
    } finally {
      setIsDeleting(false)
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
            <p className="mt-3 text-sm font-bold leading-7 text-slate-600">确定删除这篇帖子吗？删除后不可恢复。</p>
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
