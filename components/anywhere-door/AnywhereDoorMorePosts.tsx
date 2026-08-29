import Link from 'next/link'
import type { SocialPostView } from '@/lib/social-posts'

/** The public feed projection is READY-only, so this rail never exposes a failed or hidden post. */
export function AnywhereDoorMorePosts({ posts, currentPostId }: Readonly<{ posts: SocialPostView[]; currentPostId?: string }>) {
  const visiblePosts = posts.filter((post) => post.id !== currentPostId).slice(0, 8)

  return (
    <aside className="anywhere-door-more-posts hidden min-w-0 lg:block" data-anywhere-door-more-posts>
      <div className="anywhere-door-more-posts-panel sticky top-6 border border-sky-100 bg-white/75 p-4 shadow-sm dark:border-slate-700 dark:bg-slate-900/75">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-sm font-black text-brand-950 dark:text-slate-100">更多帖子</h2>
        </div>
        {visiblePosts.length ? <div className="anywhere-door-more-posts-grid mt-4 grid grid-cols-2 gap-2">
          {visiblePosts.map((post) => {
            const media = post.media[0]
            return <Link key={post.id} href={`/anywhere-door/${post.id}`} className="group block min-w-0" aria-label={`打开 @${post.authorUsername} 的动态`}>
              <div className="anywhere-door-more-posts-thumbnail relative aspect-square overflow-hidden bg-black dark:bg-black">
                {media ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={media.thumbnailUrl || media.url} alt="" loading="lazy" decoding="async" className="h-full w-full object-cover transition-transform duration-200 group-hover:scale-105" />
                ) : <div className="grid h-full place-items-center text-[10px] font-bold text-slate-400">暂无媒体</div>}
                {post.mediaType === 'CAROUSEL' || post.mediaType === 'VIDEO' || post.mediaType === 'REEL' ? <span className="absolute bottom-1 left-1 grid size-5 place-items-center bg-slate-950/65 text-[10px] font-black text-white" aria-label={post.mediaType === 'CAROUSEL' ? '轮播' : '视频'}>{post.mediaType === 'CAROUSEL' ? '▧' : '▶'}</span> : null}
              </div>
              <p className="anywhere-door-more-posts-title mt-1.5 truncate text-xs font-bold text-slate-600 group-hover:text-brand-700 dark:text-slate-300 dark:group-hover:text-sky-300">{post.caption || `@${post.authorUsername}`}</p>
            </Link>
          })}
        </div> : <p className="mt-4 text-xs font-bold leading-5 text-slate-400">暂时没有更多已归档动态。</p>}
      </div>
    </aside>
  )
}
