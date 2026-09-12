import Link from 'next/link'
import { redirect } from 'next/navigation'
import { BackButton } from '@/components/BackButton'
import { RecentActivityPagination } from '@/components/RecentActivityPagination'
import { getCurrentUser } from '@/lib/auth'
import {
  getRecentActivityPage,
  parseRecentActivityPage,
  parseRecentActivityRange,
  parseRecentActivityTab,
  recentActivityRanges,
  recentActivityTabs,
  type RecentActivityRange,
  type RecentActivityTab,
} from '@/lib/recent-activity'
import { postDetailHref } from '@/lib/post-navigation'

export const dynamic = 'force-dynamic'

const tabLabels: Record<RecentActivityTab, string> = {
  likes: '最近点赞',
  comments: '最近评论',
  views: '浏览历史',
}

const rangeLabels: Record<RecentActivityRange, string> = {
  today: '今日',
  week: '最近一周',
  month: '最近一月',
  all: '全部',
}

function historyHref(tab: RecentActivityTab, range: RecentActivityRange, page = 1) {
  return `/me/history?${new URLSearchParams({ tab, range, ...(page > 1 ? { page: String(page) } : {}) }).toString()}`
}

function formatActivityTime(value: string) {
  return new Date(value).toLocaleString('zh-CN', { dateStyle: 'short', timeStyle: 'short' })
}

function ActivityCard({
  item,
  tab,
  range,
}: Readonly<{
  item: Awaited<ReturnType<typeof getRecentActivityPage>>['items'][number]
  tab: RecentActivityTab
  range: RecentActivityRange
}>) {
  const returnTo = historyHref(tab, range)
  return (
    <article className="overflow-hidden border border-sky-100 bg-white/85 shadow-sm">
      <Link href={postDetailHref(item.post.id, returnTo)} className="flex min-w-0 gap-3 p-4 transition hover:bg-sky-50/60 sm:gap-4 sm:p-5">
        {item.post.imageUrl ? (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img src={item.post.imageUrl} alt="帖子图片缩略图" className="h-20 w-20 shrink-0 object-cover sm:h-24 sm:w-28" loading="lazy" />
        ) : (
          <div className="grid h-20 w-20 shrink-0 place-items-center border border-dashed border-sky-100 bg-sky-50 text-2xl text-brand-300 sm:h-24 sm:w-28" aria-hidden="true">✎</div>
        )}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs font-bold text-slate-500">
            <span className="font-black text-brand-700">{item.kind === 'LIKE' ? '点赞过' : '评论过'}</span>
            <time dateTime={item.occurredAt}>{formatActivityTime(item.occurredAt)}</time>
          </div>
          <h2 className="mt-2 line-clamp-2 break-words text-base font-black text-brand-950 sm:text-lg">{item.post.title}</h2>
          <p className="mt-1 line-clamp-2 break-words text-sm font-bold leading-6 text-slate-600">{item.kind === 'COMMENT' ? `“${item.commentSummary}”` : item.post.summary}</p>
          <div className="mt-3 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-xs font-bold text-slate-500">
            <span className="max-w-[12rem] truncate">作者：{item.post.author.name}</span>
            <span className="max-w-[12rem] truncate">分区：{item.post.board.name}</span>
            {item.post.imageCount > 0 ? <span>图片 {item.post.imageCount}</span> : null}
          </div>
        </div>
        <span className="self-center text-lg font-black text-brand-300" aria-hidden="true">›</span>
      </Link>
    </article>
  )
}

export default async function RecentHistoryPage({ searchParams }: { searchParams: Promise<{ tab?: string; range?: string; page?: string }> }) {
  const user = await getCurrentUser()
  if (!user) redirect('/login?redirect=%2Fme%2Fhistory')

  const params = await searchParams
  const tab = parseRecentActivityTab(params.tab)
  const range = parseRecentActivityRange(params.range)
  const page = parseRecentActivityPage(params.page)
  const activity = await getRecentActivityPage({ userId: user.id, tab, range, page })

  return (
    <main className="site-page-main flat-page mx-auto w-full max-w-5xl space-y-5 px-4 py-5 sm:px-5 sm:py-8">
      <section className="border border-sky-100 bg-white/85 p-5 shadow-sm sm:p-6">
        <BackButton fallbackHref="/profile" label="返回个人主页" />
        <div className="mt-6">
          <p className="text-xs font-black uppercase tracking-[0.2em] text-brand-700">Recent Activity</p>
          <h1 className="mt-2 text-3xl font-black text-brand-950 sm:text-4xl">最近足迹</h1>
          <p className="mt-2 text-sm font-bold leading-7 text-slate-500">仅你可见。已删除或不再公开的帖子不会出现在这里。</p>
        </div>
        <nav aria-label="足迹类型" className="mt-5 flex min-w-0 gap-2 overflow-x-auto pb-1">
          {recentActivityTabs.map((itemTab) => (
            <Link key={itemTab} href={historyHref(itemTab, range)} aria-current={itemTab === tab ? 'page' : undefined} className={`inline-flex min-h-10 shrink-0 items-center rounded-sm border px-3 text-sm font-black transition ${itemTab === tab ? 'border-brand-700 bg-brand-700 text-white' : 'border-sky-200 bg-white text-brand-700 hover:bg-sky-50'}`}>
              {tabLabels[itemTab]}
            </Link>
          ))}
        </nav>
        <nav aria-label="足迹时间范围" className="mt-3 flex min-w-0 flex-wrap gap-2">
          {recentActivityRanges.map((itemRange) => (
            <Link key={itemRange} href={historyHref(tab, itemRange)} aria-current={itemRange === range ? 'page' : undefined} className={`inline-flex min-h-9 items-center rounded-sm border px-3 text-xs font-black transition ${itemRange === range ? 'border-sky-300 bg-sky-50 text-brand-700' : 'border-sky-100 bg-white text-slate-500 hover:bg-sky-50'}`}>
              {rangeLabels[itemRange]}
            </Link>
          ))}
        </nav>
      </section>

      {!activity.available ? (
        <section className="border border-amber-200 bg-amber-50 p-6 text-sm font-bold leading-7 text-amber-950 shadow-sm" role="status">
          {activity.unavailableMessage}
          <p className="mt-2 text-xs font-bold text-amber-800">浏览记录需要单独的账号级数据表；当前不会把匿名浏览量或列表曝光误当作你的浏览历史。</p>
        </section>
      ) : activity.items.length ? (
        <>
          <section className="space-y-3" aria-label={tabLabels[tab]}>
            {activity.items.map((item) => <ActivityCard key={`${item.kind}-${item.id}`} item={item} tab={tab} range={range} />)}
          </section>
          <RecentActivityPagination tab={tab} range={range} page={activity.page} hasMore={activity.hasMore} />
        </>
      ) : (
        <section className="border border-sky-100 bg-white/85 p-8 text-center text-sm font-bold leading-7 text-slate-500 shadow-sm sm:p-12">
          暂时没有符合条件的{tabLabels[tab]}记录。
        </section>
      )}
    </main>
  )
}
