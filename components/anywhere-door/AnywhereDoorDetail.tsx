'use client'

import Link from 'next/link'
import { useState } from 'react'
import { MediaCarousel } from '@/components/anywhere-door/MediaCarousel'
import { AnywhereDoorCommentPanel } from '@/components/anywhere-door/AnywhereDoorCommentPanel'
import { AnywhereDoorMorePosts } from '@/components/anywhere-door/AnywhereDoorMorePosts'
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
        <article className="anywhere-door-main min-w-0 overflow-hidden bg-transparent shadow-none dark:bg-transparent" data-anywhere-door-main>
          <section className="anywhere-door-media min-w-0 border-b border-slate-800 bg-black dark:border-slate-800 dark:bg-black" data-anywhere-door-media>
            <MediaCarousel media={post.media} title={post.authorUsername} priority className="anywhere-door-media-viewer h-full rounded-none bg-black dark:bg-black" />
          </section>
          <section className="anywhere-door-info flex min-h-0 min-w-0 flex-col bg-white/90 dark:bg-slate-900/90" data-anywhere-door-info>
            <header className="shrink-0 border-b border-sky-100 p-4 dark:border-slate-700 sm:p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-base font-black text-brand-950 dark:text-slate-100">@{post.authorUsername}</p>
                  <time className="mt-1 block text-xs font-bold text-slate-500 dark:text-slate-400" dateTime={post.publishedAt}>{formatDate(post.publishedAt)}</time>
                </div>
                <span className="shrink-0 border border-sky-200 px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.12em] text-brand-700 dark:border-slate-600 dark:text-sky-300">{post.mediaType}</span>
              </div>
            </header>
            <div className="shrink-0 p-4 pb-3 sm:p-5 sm:pb-4">
              {post.caption ? <p className="whitespace-pre-wrap break-words text-sm leading-7 text-slate-700 dark:text-slate-300">{post.caption}</p> : <p className="text-sm font-bold text-slate-400">暂无文字说明</p>}
              <div className="mt-5 flex flex-wrap items-center gap-2 border-t border-sky-100 pt-4 dark:border-slate-700">
                <button type="button" onClick={() => void toggleLike()} className={`min-h-10 border px-3 text-xs font-black transition-colors ${viewerLiked ? 'border-pink-200 bg-pink-50 text-pink-600 dark:border-pink-900 dark:bg-pink-950/40 dark:text-pink-300' : 'border-sky-200 bg-sky-50/60 text-slate-600 hover:bg-sky-100 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700'}`} aria-pressed={viewerLiked}>{viewerLiked ? '♥' : '♡'} {likeCount}</button>
                <span className="text-xs font-black text-slate-500 dark:text-slate-400">评论 {post.commentCount}</span>
                {post.permalink ? <a href={post.permalink} target="_blank" rel="noreferrer" className="text-xs font-black text-brand-700 hover:underline dark:text-sky-300">查看 Instagram 来源 ↗</a> : null}
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
