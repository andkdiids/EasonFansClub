'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useRef } from 'react'
import { Pagination } from '@/components/ui/Pagination'
import { MusicCover } from '@/components/music/MusicCover'
import { scrollToSectionTop } from '@/lib/pagination'
import { formatAverageScore, formatRatingCount, ratingTargetPath, type RatingLanguage, type RatingTarget } from '@/lib/rating-types'
import { RatingStars } from './RatingStars'
import type { RatingListItem } from '@/lib/rating-service'

function hrefFor({ target, language, query, page }: { target: RatingTarget; language: RatingLanguage; query: string; page: number }) {
  const params = new URLSearchParams()
  params.set('type', target === 'album' ? 'albums' : 'songs')
  if (language !== 'ALL') params.set('language', language)
  if (query) params.set('q', query)
  if (page > 1) params.set('page', String(page))
  return `/ratings?${params.toString()}`
}

export function RatingRankingList({ items, target, language, query, page, pageSize, total, totalPages }: Readonly<{
  items: RatingListItem[]
  target: RatingTarget
  language: RatingLanguage
  query: string
  page: number
  pageSize: number
  total: number
  totalPages: number
}>) {
  const router = useRouter()
  const rankingRef = useRef<HTMLElement>(null)
  const previousPageRef = useRef(page)

  useEffect(() => {
    if (previousPageRef.current === page) return
    previousPageRef.current = page
    scrollToSectionTop(rankingRef.current)
  }, [page])

  function goToPage(nextPage: number) {
    scrollToSectionTop(rankingRef.current)
    router.push(hrefFor({ target, language, query, page: nextPage }), { scroll: false })
  }

  return (
    <section ref={rankingRef} aria-labelledby="rating-ranking-title" className="scroll-mt-24">
      <div className="mb-3 flex items-end justify-between gap-3">
        <div>
          <h2 id="rating-ranking-title" className="text-2xl font-black text-brand-950">{target === 'song' ? '单曲榜' : '专辑榜'}</h2>
        </div>
        <span className="text-xs font-bold text-slate-500">共 {total.toLocaleString('zh-CN')} 项 · 每页 {pageSize}</span>
      </div>

      {items.length ? (
        <div className="space-y-3">
          {items.map((item, index) => (
            <Link
              key={item.id}
              href={ratingTargetPath(item.target, item.id)}
              className="group grid min-w-0 grid-cols-[2.4rem_4.5rem_minmax(0,1fr)_auto] items-center gap-3 border border-sky-100 bg-white/90 p-3 shadow-sm transition hover:-translate-y-0.5 hover:border-brand-300 hover:shadow-md sm:grid-cols-[3.2rem_5.25rem_minmax(0,1fr)_auto] sm:gap-4 sm:p-4"
            >
              <span className="text-center text-lg font-black tabular-nums text-brand-500 sm:text-xl">{String((page - 1) * pageSize + index + 1).padStart(2, '0')}</span>
              <MusicCover src={item.coverUrl} fallbackSrc={item.fallbackCoverUrl} alt={`${item.title}封面`} variant="thumb-sm" className="aspect-square w-full border border-sky-100" sizes="84px" />
              <span className="min-w-0">
                <strong className="block truncate text-base font-black text-brand-950 sm:text-lg">{item.title}</strong>
                {item.target === 'song' ? <span className="mt-1 block truncate text-sm font-bold text-slate-600">《{item.albumName || '未归档'}》</span> : <span className="mt-1 block truncate text-sm font-bold text-slate-600">{item.artist || '陈奕迅'} · 专辑</span>}
                <span className="mt-1 block truncate text-xs font-bold text-slate-500">{item.releaseYear} · {item.languageLabel}</span>
                <span className="mt-2 flex min-w-0 items-center gap-2">
                  <RatingStars score={item.averageScore} size="text-base" label={`${formatAverageScore(item.averageScore)}分`} />
                  <span className="font-black tabular-nums text-amber-600">{formatAverageScore(item.averageScore)}</span>
                </span>
              </span>
              <span className="min-w-[5.5rem] text-right text-[11px] font-bold leading-5 text-slate-500 sm:min-w-[7rem] sm:text-xs">
                <span className="block font-black text-slate-700">{formatRatingCount(item.ratingCount)} 人评分</span>
                <span className="block">{formatRatingCount(item.reviewCount)} 条评价</span>
              </span>
            </Link>
          ))}
        </div>
      ) : (
        <div className="border border-dashed border-sky-200 bg-sky-50/55 p-8 text-center text-sm font-bold text-slate-500">没有匹配的{target === 'song' ? '歌曲' : '专辑'}。</div>
      )}

      {totalPages > 1 ? (
        <Pagination
          currentPage={page}
          totalPages={totalPages}
          onPageChange={goToPage}
          ariaLabel="歌·颂排行榜分页"
          className="rating-pagination"
        />
      ) : null}
    </section>
  )
}

undefined
