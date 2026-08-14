'use client'

import { useEffect, useState } from 'react'
import { FavoriteButton, LikeButton } from '@/components/PostActions'

export function ForumDiscoveryActionBar({ postId, currentUserId, initialLiked, initialLikeCount, initialFavorited, initialFavoriteCount, initialReplyCount }: Readonly<{
  postId: string
  currentUserId?: string
  initialLiked: boolean
  initialLikeCount: number
  initialFavorited: boolean
  initialFavoriteCount: number
  initialReplyCount: number
}>) {
  const [replyCount, setReplyCount] = useState(Math.max(initialReplyCount, 0))
  const [isMobile, setIsMobile] = useState(false)

  useEffect(() => {
    const media = window.matchMedia('(max-width: 767px)')
    const sync = () => setIsMobile(media.matches)
    sync()
    media.addEventListener('change', sync)
    return () => media.removeEventListener('change', sync)
  }, [])

  useEffect(() => {
    const onReplyCount = (event: Event) => {
      const detail = (event as CustomEvent<{ postId?: string; count?: number }>).detail
      if (detail?.postId !== postId || typeof detail.count !== 'number') return
      setReplyCount(Math.max(detail.count, 0))
    }
    window.addEventListener('ecfc:post-reply-count', onReplyCount)
    return () => window.removeEventListener('ecfc:post-reply-count', onReplyCount)
  }, [postId])

  function openComposer() {
    if (!currentUserId) {
      window.location.href = `/login?redirect=${encodeURIComponent(window.location.pathname + window.location.search)}`
      return
    }
    if (isMobile) {
      window.dispatchEvent(new CustomEvent('ecfc:open-post-reply-sheet', { detail: { postId } }))
      return
    }
    window.dispatchEvent(new CustomEvent('ecfc:focus-post-composer', { detail: { postId } }))
  }

  function focusComments() {
    document.getElementById(`post-comments-${postId}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  return (
    <div className="forum-discovery-action-bar" data-forum-discovery-action-bar>
      <button type="button" className="forum-discovery-comment-trigger" onClick={openComposer}>说点什么…</button>
      <LikeButton
        postId={postId}
        initialLiked={initialLiked}
        initialCount={initialLikeCount}
        refreshOnSuccess={false}
        className="forum-discovery-action-button forum-discovery-action-like"
      />
      <FavoriteButton
        postId={postId}
        initialFavorited={initialFavorited}
        initialCount={initialFavoriteCount}
        refreshOnSuccess={false}
        className="forum-discovery-action-button forum-discovery-action-favorite"
      />
      <button type="button" className="forum-discovery-action-count" onClick={focusComments} aria-label="查看评论">评论 {replyCount}</button>
    </div>
  )
}
