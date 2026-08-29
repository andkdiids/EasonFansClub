import Link from 'next/link'
import { MediaCarousel } from '@/components/anywhere-door/MediaCarousel'
import type { SocialPostView } from '@/lib/social-posts'

function formatDate(value: string) {
  return new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value))
}

export function AnywhereDoorPostCard({ post, priority = false, onLike }: Readonly<{ post: SocialPostView; priority?: boolean; onLike?: (postId: string) => void }>) {
  return (
    <article className="overflow-hidden border-y border-sky-100 bg-white/90 shadow-sm dark:border-slate-700 dark:bg-slate-900/90 sm:rounded-2xl sm:border" data-anywhere-door-feed-card>
      <div className="p-0 sm:p-4">
        <MediaCarousel media={post.media} title={post.authorUsername} priority={priority} className="bg-black dark:bg-black" />
      </div>
      <div className="px-3 pb-4 pt-4 sm:px-6 sm:pb-6 sm:pt-0">
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs font-bold text-slate-500 dark:text-slate-400">
          <span>@{post.authorUsername}</span>
          <time dateTime={post.publishedAt}>{formatDate(post.publishedAt)}</time>
        </div>
        {post.caption ? <p className="mt-3 whitespace-pre-wrap break-words text-sm font-medium leading-7 text-slate-700 dark:text-slate-300 [display:-webkit-box] [-webkit-box-orient:vertical] [-webkit-line-clamp:5] [overflow:hidden]">{post.caption}</p> : <p className="mt-3 text-sm font-bold text-slate-400">暂无文字说明</p>}
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-sky-50 pt-3 dark:border-slate-700">
          <div className="flex items-center gap-2 text-xs font-black text-slate-500 dark:text-slate-400">
            <button type="button" onClick={() => onLike?.(post.id)} className={`rounded-full border px-3 py-2 transition-colors ${post.viewerLiked ? 'border-pink-200 bg-pink-50 text-pink-600 dark:border-pink-900 dark:bg-pink-950/40 dark:text-pink-300' : 'border-sky-100 bg-sky-50/60 text-slate-600 hover:bg-sky-100 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700'}`} aria-pressed={post.viewerLiked}>{post.viewerLiked ? '♥' : '♡'} {post.likeCount}</button>
            <Link href={`/anywhere-door/${post.id}`} className="rounded-full border border-sky-100 bg-sky-50/60 px-3 py-2 hover:bg-sky-100 dark:border-slate-600 dark:bg-slate-800 dark:hover:bg-slate-700">评论 {post.commentCount}</Link>
          </div>
          {post.permalink ? <a href={post.permalink} target="_blank" rel="noreferrer" className="text-xs font-black text-brand-700 hover:underline dark:text-sky-300">查看来源 ↗</a> : null}
        </div>
        <p className="mt-3 text-[11px] font-bold leading-5 text-slate-400 dark:text-slate-500">内容来自公开来源，仅在本站提供存档浏览；媒体已由本站存储层托管。</p>
      </div>
    </article>
  )
}
