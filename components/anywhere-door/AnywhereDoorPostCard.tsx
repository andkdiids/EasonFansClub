import Link from 'next/link'
import { MediaCarousel } from '@/components/anywhere-door/MediaCarousel'
import { AnywhereDoorSourceIdentity } from '@/components/anywhere-door/AnywhereDoorSourceIdentity'
import type { SocialPostView } from '@/lib/social-posts'

function formatDate(value: string) {
  return new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value))
}

export function AnywhereDoorPostCard({ post, priority = false, onLike }: Readonly<{ post: SocialPostView; priority?: boolean; onLike?: (postId: string) => void }>) {
  return (
    <article className="anywhere-door-post-card overflow-hidden shadow-sm sm:rounded-2xl" data-anywhere-door-feed-card>
      <div className="p-0 sm:p-4">
        <MediaCarousel media={post.media} title={post.authorUsername} priority={priority} className="bg-black dark:bg-black" />
      </div>
      <div className="anywhere-door-post-content px-3 pb-4 pt-4 sm:px-6 sm:pb-6 sm:pt-0">
        <div className="anywhere-door-source-row flex flex-wrap items-center justify-between gap-2">
          <AnywhereDoorSourceIdentity username={post.authorUsername} avatarUrl={post.authorAvatarUrl} />
          <time className="anywhere-door-post-time" dateTime={post.publishedAt}>{formatDate(post.publishedAt)}</time>
        </div>
        {post.caption ? <p className="anywhere-door-caption mt-3 whitespace-pre-wrap break-words text-sm font-medium leading-7 [display:-webkit-box] [-webkit-box-orient:vertical] [-webkit-line-clamp:5] [overflow:hidden]">{post.caption}</p> : <p className="anywhere-door-empty-copy mt-3 text-sm font-bold">暂无文字说明</p>}
        <div className="anywhere-door-meta mt-4 flex flex-wrap items-center justify-between gap-3 border-t pt-3">
          <div className="flex items-center gap-2 text-xs font-black">
            <button type="button" onClick={() => onLike?.(post.id)} className={`anywhere-door-like-button rounded-full px-3 py-2 transition-colors ${post.viewerLiked ? 'anywhere-door-like-button-active' : ''}`} aria-pressed={post.viewerLiked}>{post.viewerLiked ? '♥' : '♡'} {post.likeCount}</button>
            <Link href={`/anywhere-door/${post.id}`} className="anywhere-door-comment-link rounded-full px-3 py-2">评论 {post.commentCount}</Link>
          </div>
          {post.permalink ? <a href={post.permalink} target="_blank" rel="noreferrer" className="anywhere-door-source-link text-xs font-black hover:underline">查看来源 ↗</a> : null}
        </div>
        <p className="anywhere-door-post-note mt-3 text-[11px] font-bold leading-5">内容来自公开来源，仅在本站提供存档浏览；媒体已由本站存储层托管。</p>
      </div>
    </article>
  )
}
