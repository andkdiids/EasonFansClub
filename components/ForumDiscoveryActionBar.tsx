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

  useEffect(() => {
    const onReplyCount = (event: Event) => {
      const detail = (event as CustomEvent<{ postId?: string; count?: number }>).detail
      if (detail?.postId !== postId || typeof detail.count !== 'number') return
      setReplyCount(Math.max(detail.count, 0))
    }
    window.addEventListener('ecfc:post-reply-count', onReplyCount)
    return () => window.removeEventListener('ecfc:post-reply-count', onReplyCount)
  }, [postId])

  function focusComposer() {
    if (!currentUserId) {
      window.location.href = `/login?redirect=${encodeURIComponent(window.location.pathname + window.location.search)}`
      return
    }
    window.dispatchEvent(new CustomEvent('ecfc:focus-post-composer', { detail: { postId } }))
  }

  return (
    <div className="forum-discovery-action-bar" data-forum-discovery-action-bar>
      <button type="button" className="forum-discovery-comment-trigger" onClick={focusComposer}>说点什么…</button>
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
      <button type="button" className="forum-discovery-action-count" onClick={focusComposer} aria-label="查看评论">评论 {replyCount}</button>
    </div>
  )
}
