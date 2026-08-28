'use client'

import Link from 'next/link'
import { MediaCarousel } from '@/components/anywhere-door/MediaCarousel'
import { AnywhereDoorCommentPanel } from '@/components/anywhere-door/AnywhereDoorCommentPanel'
import type { SocialPostDetailView } from '@/lib/social-posts'

export function AnywhereDoorDetail({ post }: Readonly<{ post: SocialPostDetailView }>) {
  return (
    <div>
      <Link href="/anywhere-door" className="text-sm font-black text-brand-700 hover:underline">← 返回随意门</Link>
      <article className="mt-4 rounded-[28px] border border-sky-100 bg-white/90 p-3 shadow-sm sm:p-5">
        <MediaCarousel media={post.media} title={post.authorUsername} priority />
        <div className="px-1 pb-2 pt-5 sm:px-2">
          <div className="flex flex-wrap items-center justify-between gap-2 text-sm font-black text-brand-950"><span>@{post.authorUsername}</span><time dateTime={post.publishedAt}>{new Intl.DateTimeFormat('zh-CN', { dateStyle: 'full', timeStyle: 'short' }).format(new Date(post.publishedAt))}</time></div>
          {post.caption ? <p className="mt-4 whitespace-pre-wrap break-words text-sm leading-7 text-slate-700">{post.caption}</p> : null}
          <div className="mt-4 flex flex-wrap gap-3 text-xs font-black text-slate-500"><span>♥ {post.likeCount}</span><span>评论 {post.commentCount}</span>{post.permalink ? <a href={post.permalink} target="_blank" rel="noreferrer" className="text-brand-700 hover:underline">查看 Instagram 来源 ↗</a> : null}</div>
        </div>
      </article>
      <AnywhereDoorCommentPanel postId={post.id} initialComments={post.comments} initialNextCursor={post.commentsNextCursor} />
    </div>
  )
}
