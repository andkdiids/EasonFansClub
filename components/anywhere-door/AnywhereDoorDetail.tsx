'use client'

import Link from 'next/link'
import { useState } from 'react'
import { MediaCarousel } from '@/components/anywhere-door/MediaCarousel'
import { AnywhereDoorCommentPanel } from '@/components/anywhere-door/AnywhereDoorCommentPanel'
import { AnywhereDoorMorePosts } from '@/components/anywhere-door/AnywhereDoorMorePosts'
import { AnywhereDoorSourceIdentity } from '@/components/anywhere-door/AnywhereDoorSourceIdentity'
import type { SocialPostDetailView, SocialPostView } from '@/lib/social-posts'

function formatDate(value: string) {
  return new Intl.DateTimeFormat('zh-CN', { dateStyle: 'full', timeStyle: 'short' }).format(new Date(value))
}

export function AnywhereDoorDetail({ post, morePosts = [], showBackLink = true }: Readonly<{
  post: SocialPostDetailView
  morePosts?: SocialPostView[]
  showBackLink?: boolean
}>) {
  const [likeCount, setLikeCount] = useState(post.likeCount)
  const [viewerLiked, setViewerLiked] = useState(post.viewerLiked)
  const [message, setMessage] = useState('')

  async function toggleLike() {
    setMessage('')
    const response = await fetch(`/api/anywhere-door/${post.id}/like`, { method: 'POST' })
    const payload = await response.json().catch(() => null)
    if (!response.ok) {
      setMessage(payload?.message || '点赞失败，请稍后重试')
      return
    }
    setViewerLiked(payload.liked === true)
    setLikeCount(Number.isFinite(payload.likeCount) ? payload.likeCount : likeCount)
  }

  return (
    <div className="anywhere-door-detail space-y-3" data-anywhere-door-detail>
      {showBackLink ? <Link href="/anywhere-door" className="inline-flex text-sm font-black text-brand-700 hover:underline dark:text-sky-300">← 返回随意门</Link> : null}
      <div className="anywhere-door-detail-shell grid min-w-0 gap-3" data-anywhere-door-detail-shell>
        <article className="anywhere-door-main min-w-0 overflow-hidden shadow-none" data-anywhere-door-main>
          <section className="anywhere-door-media min-w-0 border-b border-slate-800 bg-black dark:border-slate-800 dark:bg-black" data-anywhere-door-media>
            <MediaCarousel media={post.media} title={post.authorUsername} priority className="anywhere-door-media-viewer h-full rounded-none bg-black dark:bg-black" />
          </section>
          <section className="anywhere-door-info flex min-h-0 min-w-0 flex-col" data-anywhere-door-info>
            <header className="anywhere-door-info-header shrink-0 p-4 sm:p-5">
              <div className="anywhere-door-source-row flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0">
                  <AnywhereDoorSourceIdentity username={post.authorUsername} avatarUrl={post.authorAvatarUrl} />
                  <time className="anywhere-door-post-time mt-1 block" dateTime={post.publishedAt}>{formatDate(post.publishedAt)}</time>
                </div>
                <span className="anywhere-door-media-type shrink-0">{post.mediaType}</span>
              </div>
            </header>
            <div className="anywhere-door-info-body shrink-0 p-4 pb-3 sm:p-5 sm:pb-4">
              {post.caption ? <p className="anywhere-door-caption whitespace-pre-wrap break-words text-sm leading-7">{post.caption}</p> : <p className="anywhere-door-empty-copy text-sm font-bold">暂无文字说明</p>}
              <div className="anywhere-door-meta mt-5 flex flex-wrap items-center gap-2 border-t pt-4">
                <button type="button" onClick={() => void toggleLike()} className={`anywhere-door-like-button min-h-10 px-3 text-xs font-black transition-colors ${viewerLiked ? 'anywhere-door-like-button-active' : ''}`} aria-pressed={viewerLiked}>{viewerLiked ? '♥' : '♡'} {likeCount}</button>
                <span className="anywhere-door-comment-count text-xs font-black">评论 {post.commentCount}</span>
                {post.permalink ? <a href={post.permalink} target="_blank" rel="noreferrer" className="anywhere-door-source-link text-xs font-black hover:underline">查看 Instagram 来源 ↗</a> : null}
              </div>
              {message ? <p className="mt-2 text-xs font-bold text-red-600 dark:text-red-300" role="alert">{message}</p> : null}
            </div>
            <div className="anywhere-door-comment-slot min-h-0 flex-1">
              <AnywhereDoorCommentPanel embedded postId={post.id} initialComments={post.comments} initialNextCursor={post.commentsNextCursor} />
            </div>
          </section>
        </article>
        <AnywhereDoorMorePosts posts={morePosts} currentPostId={post.id} />
      </div>
    </div>
  )
}
