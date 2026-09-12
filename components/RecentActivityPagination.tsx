import Link from 'next/link'

export function RecentActivityPagination({
  tab,
  range,
  page,
  hasMore,
}: Readonly<{
  tab: string
  range: string
  page: number
  hasMore: boolean
}>) {
  if (page <= 1 && !hasMore) return null
  const href = (nextPage: number) => `/me/history?${new URLSearchParams({ tab, range, page: String(nextPage) }).toString()}`

  return (
    <nav aria-label="最近足迹分页" className="flex flex-wrap items-center justify-between gap-3 border-t border-sky-100 pt-4">
      {page > 1 ? (
        <Link href={href(page - 1)} className="inline-flex min-h-10 items-center rounded-sm border border-sky-200 px-4 text-sm font-black text-brand-700 transition hover:bg-sky-50">
          上一页
        </Link>
      ) : <span />}
      <span className="text-xs font-bold text-slate-500">第 {page} 页</span>
      {hasMore ? (
        <Link href={href(page + 1)} className="inline-flex min-h-10 items-center rounded-sm border border-sky-200 px-4 text-sm font-black text-brand-700 transition hover:bg-sky-50">
          下一页
        </Link>
      ) : <span />}
    </nav>
  )
}
