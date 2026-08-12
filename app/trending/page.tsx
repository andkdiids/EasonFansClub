import Link from 'next/link'
import { formatDate } from '@/lib/format'
import { profileImageUrl } from '@/lib/images'
import { publicImageVariantUrl } from '@/lib/image-variants'
import { formatUid } from '@/lib/uid'
import { getTrendingPosts, type TrendingRange } from '@/lib/trending-posts'
import { getCurrentUser } from '@/lib/auth'
import { loadFriendRemarkMap, resolveFriendDisplayName } from '@/lib/friend-remarks'

export const dynamic = 'force-dynamic'

function rangeHref(range: TrendingRange, page = 1) {
  const query = new URLSearchParams({ range: String(range) })
  if (page > 1) query.set('page', String(page))
  return `/trending?${query.toString()}`
}

export default async function TrendingPostsPage({
  searchParams,
}: Readonly<{ searchParams: Promise<{ range?: string; page?: string }> }>) {
  const query = await searchParams
  const range: TrendingRange = query.range === '30' ? 30 : 7
  const page = Math.min(100, Math.max(1, Number(query.page) || 1))
  const [data, viewer] = await Promise.all([getTrendingPosts(range, page), getCurrentUser()])
  const remarkMap = await loadFriendRemarkMap(viewer?.id, data.posts.map((post) => post.authorId))
  const posts = data.posts.map((post) => ({
    ...post,
    authorName: resolveFriendDisplayName({
      viewerId: viewer?.id,
      targetUserId: post.authorId,
      fallbackName: post.authorName,
      remarkMap,
    }),
  }))

  return (
    <main className="site-page-main flat-page mx-auto max-w-5xl space-y-5 px-4 py-6 sm:px-5 sm:py-8">
      <header className="border border-sky-100 bg-white/85 p-6 shadow-sm sm:p-8">
        <p className="text-xs font-black uppercase tracking-[0.22em] text-brand-700">Trending Posts</p>
        <h1 className="mt-2 text-3xl font-black text-brand-950 sm:text-4xl">热门帖子</h1>
        <p className="mt-3 text-sm font-bold text-slate-500">按浏览、点赞、回复和收藏综合热度发现近期内容。</p>
      </header>

      <nav aria-label="热门帖子时间范围" className="grid grid-cols-2 border border-sky-100 bg-white/85 p-1">
        {([7, 30] as const).map((days) => (
          <Link
            key={days}
            href={rangeHref(days)}
            aria-current={range === days ? 'page' : undefined}
            className={`min-h-11 px-4 py-3 text-center text-sm font-black ${range === days ? 'bg-brand-700 text-white' : 'text-brand-700'}`}
          >
            近 {days} 天
          </Link>
        ))}
      </nav>

      {posts.length ? (
        <section className="space-y-3" aria-label={`近 ${range} 天热门帖子`}>
          {posts.map((post) => {
            const avatar = profileImageUrl(post.authorAvatarUrl)
            const image = publicImageVariantUrl(post.imageUrl, 'card')
            return (
              <article key={post.id} className="relative grid min-w-0 gap-4 border border-sky-100 bg-white/85 p-4 shadow-sm sm:grid-cols-[minmax(0,1fr)_180px] sm:p-5">
                <Link href={`/posts/${post.id}`} className="absolute inset-0 z-[1]" aria-label={`查看帖子：${post.title}`} />
                <div className="pointer-events-none min-w-0">
                  <div className="flex flex-wrap items-center gap-2 text-xs font-black">
                    <span className="bg-sky-50 px-2 py-1 text-brand-700">{post.boardName}</span>
                    <span className="text-amber-600">热门 · {post.hotScore.toFixed(1)}</span>
                  </div>
                  <h2 className="mt-3 line-clamp-2 text-xl font-black text-brand-950">{post.title}</h2>
                  <p className="mt-2 line-clamp-3 break-words text-sm leading-6 text-slate-600">{post.summary}</p>
                  <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-2 text-xs font-bold text-slate-500">
                    <span className="flex items-center gap-2 text-brand-950">
                      <span className="grid h-7 w-7 place-items-center overflow-hidden rounded-full bg-brand-950 text-white">
                        {avatar ? <img src={publicImageVariantUrl(avatar, 'avatar-md') || avatar} alt="" className="h-full w-full object-cover" loading="lazy" /> : formatUid(post.authorUid).slice(0, 1)}
                      </span>
                      {post.authorName}
                    </span>
                    <time dateTime={new Date(post.createdAt).toISOString()}>{formatDate(new Date(post.createdAt))}</time>
                    <span>赞 {post.likeCount}</span>
                    <span>回复 {post.replyCount}</span>
                    <span>浏览 {post.viewCount}</span>
                  </div>
                </div>
                {image ? <div className="pointer-events-none order-first h-40 overflow-hidden bg-sky-50 sm:order-none sm:h-full sm:min-h-36"><img src={image} alt="" className="h-full w-full object-cover" loading="lazy" /></div> : null}
              </article>
            )
          })}
        </section>
      ) : (
        <section className="border border-dashed border-sky-200 bg-white/70 p-10 text-center">
          <h2 className="text-xl font-black text-brand-950">暂无热门帖子</h2>
          <p className="mt-2 text-sm font-bold text-slate-500">这个时间范围内还没有可展示的帖子。</p>
          <Link href="/forum" className="mt-5 inline-flex min-h-11 items-center bg-brand-700 px-5 text-sm font-black text-white">返回 E院广场</Link>
        </section>
      )}

      {(page > 1 || data.hasMore) ? (
        <div className="pagination-wrap trending-pagination">
          <nav aria-label="热门帖子分页" className="pagination-nav">
            {page > 1 ? <Link href={rangeHref(range, page - 1)} className="pagination-edge">上一页</Link> : null}
            <span aria-current="page" className="pagination-page is-current">{page}</span>
            {data.hasMore ? <Link href={rangeHref(range, page + 1)} className="pagination-edge">下一页</Link> : null}
          </nav>
        </div>
      ) : null}
    </main>
  )
}
