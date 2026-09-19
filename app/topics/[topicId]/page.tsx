import Link from 'next/link'
import { notFound } from 'next/navigation'
import { BackButton } from '@/components/BackButton'
import { RichPostContent } from '@/components/posts/RichPostContent'
import { formatDate } from '@/lib/format'
import { getPublicUserDisplayName } from '@/lib/friend-remarks'
import { formatPostExpiry, isPostExpired } from '@/lib/post-lifecycle'
import { getTopicById, getTopicPosts, TOPIC_PAGE_SIZE } from '@/lib/topic-service'
import { publicModerationText } from '@/lib/content-moderation'

export const dynamic = 'force-dynamic'

function parsePage(value: string | string[] | undefined) {
  const parsed = Number.parseInt(Array.isArray(value) ? value[0] || '1' : value || '1', 10)
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : 1
}

export default async function TopicPage({
  params,
  searchParams,
}: Readonly<{
  params: Promise<{ topicId: string }>
  searchParams: Promise<{ sort?: string; page?: string }>
}>) {
  const [{ topicId }, query] = await Promise.all([params, searchParams])
  const topic = await getTopicById(topicId)
  if (!topic) notFound()
  const sort = query.sort === 'hot' ? 'hot' : 'latest'
  const result = await getTopicPosts(topicId, sort, parsePage(query.page))

  return (
    <main className="site-page-main flat-page mx-auto max-w-6xl space-y-6 px-5 py-8">
      <BackButton fallbackHref="/forum" />
      <header className="border-b border-sky-100 pb-6">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-3xl font-black text-brand-950">#{topic.name}</h1>
          {topic.isOfficial ? <span className="text-sm font-black text-amber-700">官方</span> : null}
        </div>
        <p className="mt-3 text-sm font-bold text-slate-500">{topic.postCount} 篇帖子 · {topic.participantCount} 人参与</p>
        {topic.description ? <p className="mt-4 whitespace-pre-wrap text-base leading-7 text-slate-700">{topic.description}</p> : null}
        {topic.Activity ? (
          <Link href={`/activities/${topic.Activity.id}`} className="mt-4 inline-flex text-sm font-black text-brand-700 underline underline-offset-4">
            关联活动：{topic.Activity.title}
          </Link>
        ) : null}
      </header>

      <nav aria-label="话题帖子排序" className="flex items-center gap-4 text-sm font-black">
        <Link href={`/topics/${encodeURIComponent(topic.id)}?sort=latest`} className={sort === 'latest' ? 'text-brand-900 underline underline-offset-4' : 'text-slate-500'}>最新</Link>
        <Link href={`/topics/${encodeURIComponent(topic.id)}?sort=hot`} className={sort === 'hot' ? 'text-brand-900 underline underline-offset-4' : 'text-slate-500'}>热门</Link>
      </nav>

      <section className="space-y-4" aria-label="话题帖子">
        {result.posts.map((post) => {
          const authorName = getPublicUserDisplayName(post.User)
          const topics = post.PostTopic.map(({ Topic }) => Topic)
          const expired = isPostExpired(post.expiresAt)
          return (
            <article key={post.id} className="border-b border-sky-100 pb-5">
              <div className="flex flex-wrap items-center gap-3 text-sm font-bold text-slate-500">
                <Link href={`/user/${post.User.uid}`} className="font-black text-brand-900">{authorName}</Link>
                <span>{formatDate(post.createdAt)}</span>
                {post.expiresAt && !expired ? <span className="text-amber-700">限时 · {formatPostExpiry(post.expiresAt)}</span> : null}
              </div>
              <Link href={`/posts/${post.id}`} className="mt-2 block text-xl font-black text-brand-950 hover:text-brand-700">
                {publicModerationText(post.title, post.moderationStatus)}
              </Link>
              <RichPostContent
                richContent={post.richContent}
                fallbackContent={publicModerationText(post.content, post.moderationStatus)}
                className="mt-2 line-clamp-4 text-sm leading-7 text-slate-600"
                topics={topics}
              />
              <div className="mt-3 flex gap-4 text-xs font-bold text-slate-400">
                <span>回复 {post.replyCount}</span>
                <span>点赞 {post.likeCount}</span>
              </div>
            </article>
          )
        })}
        {!result.posts.length ? <p className="py-12 text-center text-sm font-bold text-slate-500">这个话题暂时还没有公开帖子。</p> : null}
      </section>

      {result.totalPages > 1 ? (
        <nav aria-label="话题分页" className="flex flex-wrap items-center gap-3 text-sm font-black">
          {result.page > 1 ? <Link href={`/topics/${encodeURIComponent(topic.id)}?sort=${sort}&page=${result.page - 1}`} className="text-brand-700">上一页</Link> : null}
          <span className="text-slate-500">第 {result.page} / {result.totalPages} 页（每页 {TOPIC_PAGE_SIZE} 条）</span>
          {result.page < result.totalPages ? <Link href={`/topics/${encodeURIComponent(topic.id)}?sort=${sort}&page=${result.page + 1}`} className="text-brand-700">下一页</Link> : null}
        </nav>
      ) : null}
    </main>
  )
}
