import Link from 'next/link'
import { redirect } from 'next/navigation'
import { PageContainer } from '@/components/PageContainer'
import { MusicCover } from '@/components/music/MusicCover'
import { RatingStars } from '@/components/ratings/RatingStars'
import { getCurrentUser } from '@/lib/auth'
import { getMyRatings } from '@/lib/rating-service'
import { formatRatingCount, type RatingTarget } from '@/lib/rating-types'

type SearchParams = Promise<Record<string, string | string[] | undefined>>

function firstParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] || '' : value || ''
}

export const dynamic = 'force-dynamic'

export default async function MyRatingsPage({ searchParams }: { searchParams: SearchParams }) {
  const user = await getCurrentUser().catch(() => null)
  if (!user) redirect(`/login?next=${encodeURIComponent('/ratings/me')}`)
  const params = await searchParams
  const rawTarget = firstParam(params.target)
  const target = rawTarget === 'song' || rawTarget === 'album' ? rawTarget as RatingTarget : undefined
  const page = Math.max(Number(firstParam(params.page) || 1) || 1, 1)
  const result = await getMyRatings({ userId: user.id, target, page })
  const tabHref = (value?: RatingTarget) => value ? `/ratings/me?target=${value}` : '/ratings/me'

  return (
    <PageContainer className="mx-auto max-w-4xl px-4 py-6 sm:px-6 sm:py-9">
      <Link href="/ratings" className="text-sm font-black text-brand-700 hover:underline">← 返回歌·颂</Link>
      <header className="mt-5 border-b border-sky-100 pb-5"><h1 className=" text-3xl font-black text-brand-950 sm:text-4xl">我的评分</h1><p className="mt-2 text-sm font-bold text-slate-600">评分永久保留；短评可以删除后重新发表。</p></header>
      <nav className="mt-5 flex gap-2" aria-label="我的评分分类">
        {[[undefined, '全部'], ['song', '单曲'], ['album', '专辑']].map(([value, label]) => <Link key={label} href={tabHref(value as RatingTarget | undefined)} aria-current={target === value || (!target && !value) ? 'page' : undefined} className={`border px-4 py-2 text-sm font-black ${target === value || (!target && !value) ? 'border-brand-950 bg-brand-950 text-white' : 'border-sky-100 bg-white text-slate-600'}`}>{label}</Link>)}
      </nav>
      {result.items.length ? (
        <div className="mt-5 space-y-3">
          {result.items.map((item) => (
            <Link key={item.id} href={`/ratings/${item.target === 'song' ? 'songs' : 'albums'}/${item.targetId}`} className="grid grid-cols-[4.5rem_minmax(0,1fr)_auto] items-center gap-3 border border-sky-100 bg-white/90 p-3 shadow-sm sm:grid-cols-[5rem_minmax(0,1fr)_auto] sm:gap-4 sm:p-4">
              <MusicCover src={item.coverUrl} fallbackSrc={item.fallbackCoverUrl} alt={`${item.title}封面`} className="aspect-square w-full border border-sky-100" sizes="80px" />
              <span className="min-w-0"><strong className="block truncate text-base font-black text-brand-950">{item.title}</strong><span className="mt-1 block truncate text-xs font-bold text-slate-500">{item.target === 'song' ? `《${item.albumName || '未归档'}》` : `${item.releaseYear} · 专辑`} · {item.languageLabel}</span><span className="mt-2 flex items-center gap-2"><RatingStars score={item.score} size="text-base" label={`${item.score}分`} /><span className="text-sm font-black text-amber-600">{item.score}分</span></span></span>
              <span className="text-right text-xs font-bold text-slate-500"><span className="block">{item.review ? '已发表评价' : '仅评分'}</span><time className="mt-1 block" dateTime={item.createdAt}>{item.createdAt.slice(0, 10)}</time></span>
            </Link>
          ))}
        </div>
      ) : <p className="mt-5 border border-dashed border-sky-200 bg-sky-50/55 p-8 text-center text-sm font-bold text-slate-500">你还没有评分记录。</p>}
      {result.page > 1 || result.hasMore ? <nav className="mt-5 flex items-center justify-between text-sm font-black"><span>{result.page > 1 ? <Link href={`${tabHref(target)}${target ? '&' : '?'}page=${result.page - 1}`} className="text-brand-700">上一页</Link> : null}</span><span className="text-xs text-slate-500">第 {result.page} 页 · {formatRatingCount(result.total)} 条</span><span>{result.hasMore ? <Link href={`${tabHref(target)}${target ? '&' : '?'}page=${result.page + 1}`} className="text-brand-700">下一页</Link> : null}</span></nav> : null}
    </PageContainer>
  )
}
