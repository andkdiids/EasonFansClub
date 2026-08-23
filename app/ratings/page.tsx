import Link from 'next/link'
import { redirect } from 'next/navigation'
import { PageContainer } from '@/components/PageContainer'
import { PersonalRankingManager } from '@/components/ratings/PersonalRankingManager'
import { RatingRankingList } from '@/components/ratings/RatingRankingList'
import { getCurrentUser } from '@/lib/auth'
import { getRatingRanking } from '@/lib/rating-service'
import { RATING_LANGUAGE_OPTIONS, parseRatingLanguage, parseRatingTarget, type RatingLanguage, type RatingTarget } from '@/lib/rating-types'
import { sanitizeText } from '@/lib/security'

export const dynamic = 'force-dynamic'

type SearchParams = Promise<Record<string, string | string[] | undefined>>

function firstParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] || '' : value || ''
}

function ratingsHref({ target, language, query, page }: { target: RatingTarget; language: RatingLanguage; query: string; page?: number }) {
  const params = new URLSearchParams()
  params.set('type', target === 'album' ? 'albums' : 'songs')
  if (language !== 'ALL') params.set('language', language)
  if (query) params.set('q', query)
  if (page && page > 1) params.set('page', String(page))
  return `/ratings?${params.toString()}`
}

export default async function RatingsPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams
  const view = firstParam(params.view) === 'personal' ? 'personal' : 'public'
  const target = parseRatingTarget(firstParam(params.type))
  const language = parseRatingLanguage(firstParam(params.language))
  const query = sanitizeText(firstParam(params.q), 100)
  const requestedPage = Number(firstParam(params.page) || 1)
  const page = Number.isSafeInteger(requestedPage) && requestedPage >= 1 ? requestedPage : 1
  const [ranking, user] = await Promise.all([
    view === 'public' ? getRatingRanking({ target, language, query, page }) : Promise.resolve(null),
    getCurrentUser(),
  ])
  if (ranking && ranking.page !== page) redirect(ratingsHref({ target, language, query, page: ranking.page }))

  return (
    <PageContainer className="mx-auto max-w-5xl px-4 py-6 sm:px-6 sm:py-9">
      <header className="border-b border-sky-100 pb-6">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-4xl font-black tracking-tight text-brand-950 sm:text-5xl">歌·颂</h1>
            <p className="mt-3 text-sm font-bold leading-6 text-slate-600 sm:text-base">{view === 'public' ? '看看大家如何评价每一首歌、每一张专辑。' : '把真正喜欢的作品，排成只属于你的顺序。'}</p>
          </div>
          {view === 'public' && user ? <Link href="/ratings/me" className="border border-sky-200 bg-white px-4 py-2.5 text-sm font-black text-brand-700 hover:border-brand-300">我的评分</Link> : null}
        </div>
      </header>

      <nav className="mt-6 grid grid-cols-2 border border-sky-100 bg-white p-1" aria-label="歌·颂榜单类型切换">
        <Link href={ratingsHref({ target, language, query })} aria-current={view === 'public' ? 'page' : undefined} className={`px-4 py-3 text-center text-sm font-black transition ${view === 'public' ? 'bg-brand-950 text-white' : 'text-slate-500 hover:bg-sky-50'}`}>公开榜单</Link>
        <Link href={`/ratings?view=personal&type=${target === 'album' ? 'albums' : 'songs'}`} aria-current={view === 'personal' ? 'page' : undefined} className={`px-4 py-3 text-center text-sm font-black transition ${view === 'personal' ? 'bg-brand-950 text-white' : 'text-slate-500 hover:bg-sky-50'}`}>个人榜单</Link>
      </nav>

      <div className="mt-7"><h2 className="text-xl font-black text-brand-950">{view === 'public' ? '公开榜单' : '个人榜单'}</h2></div>
      <nav className="mt-3 grid grid-cols-2 border border-sky-100 bg-white p-1" aria-label={view === 'public' ? '公开榜单对象切换' : '个人榜单对象切换'}>
        {([['song', view === 'public' ? '单曲' : 'Top 27 单曲'], ['album', view === 'public' ? '专辑' : 'Top 10 专辑']] as const).map(([value, label]) => {
          const active = target === value
          const href = view === 'public' ? ratingsHref({ target: value, language, query }) : `/ratings?view=personal&type=${value === 'album' ? 'albums' : 'songs'}`
          return <Link key={value} href={href} aria-current={active ? 'page' : undefined} className={`min-w-0 px-2 py-3 text-center text-sm font-black transition sm:px-4 ${active ? 'bg-brand-950 text-white' : 'text-slate-500 hover:bg-sky-50'}`}>{label}</Link>
        })}
      </nav>

      {view === 'public' ? <>
        <div className="mt-4 flex flex-wrap gap-2" aria-label="语言分类">
          {RATING_LANGUAGE_OPTIONS.map((option) => {
            const active = option.value === language
            return <Link key={option.value} href={ratingsHref({ target, language: option.value, query })} aria-current={active ? 'page' : undefined} className={`border px-3 py-2 text-xs font-black ${active ? 'border-brand-950 bg-brand-950 text-white' : 'border-sky-100 bg-white text-slate-600 hover:border-brand-300'}`}>{option.label}</Link>
          })}
        </div>
        <form action="/ratings" method="get" className="mt-5 flex gap-2">
          <input type="hidden" name="type" value={target === 'album' ? 'albums' : 'songs'} />
          {language !== 'ALL' ? <input type="hidden" name="language" value={language} /> : null}
          <label className="sr-only" htmlFor="rating-search">搜索歌曲 / 专辑</label>
          <input id="rating-search" name="q" defaultValue={query} placeholder={target === 'song' ? '搜索歌曲或所属专辑' : '搜索专辑'} className="min-w-0 flex-1 border border-sky-200 bg-white px-4 py-3 text-sm font-bold text-slate-800 outline-none placeholder:text-slate-400 focus:border-brand-400" />
          <button type="submit" className="shrink-0 bg-brand-950 px-5 py-3 text-sm font-black text-white">搜索</button>
        </form>
        <div className="mt-8">{ranking ? <RatingRankingList items={ranking.items} target={target} language={language} query={query} page={ranking.page} pageSize={ranking.pageSize} total={ranking.total} totalPages={ranking.totalPages} /> : null}</div>
      </> : <PersonalRankingManager type={target === 'album' ? 'ALBUM' : 'SONG'} authenticated={Boolean(user)} />}
    </PageContainer>
  )
}
