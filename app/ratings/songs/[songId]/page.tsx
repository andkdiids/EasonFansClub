import Link from 'next/link'
import { notFound } from 'next/navigation'
import { PageContainer } from '@/components/PageContainer'
import { MusicCover } from '@/components/music/MusicCover'
import { RatingComposer } from '@/components/ratings/RatingComposer'
import { RatingReviews } from '@/components/ratings/RatingReviews'
import { RatingStars } from '@/components/ratings/RatingStars'
import { getCurrentUser } from '@/lib/auth'
import { getSongRatingDetail } from '@/lib/rating-service'
import { formatAverageScore, formatRatingCount, parseRatingReviewSort, type RatingReviewSort } from '@/lib/rating-types'

type SearchParams = Promise<Record<string, string | string[] | undefined>>

function firstParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] || '' : value || ''
}

export const dynamic = 'force-dynamic'

export default async function RatingSongPage({ params, searchParams }: { params: Promise<{ songId: string }>; searchParams: SearchParams }) {
  const { songId } = await params
  const query = await searchParams
  const sort = parseRatingReviewSort(firstParam(query.sort)) as RatingReviewSort
  const user = await getCurrentUser().catch(() => null)
  const detail = await getSongRatingDetail(songId, user?.id || null, sort)
  if (!detail) notFound()

  const nextPath = `/ratings/songs/${songId}${sort === 'latest' ? '?sort=latest' : ''}`
  return (
    <PageContainer className="mx-auto max-w-5xl px-4 py-6 sm:px-6 sm:py-9">
      <Link href="/ratings?type=songs" className="text-sm font-black text-brand-700 hover:underline">← 返回单曲榜</Link>

      <section className="mt-5 grid gap-5 border border-sky-100 bg-white/90 p-5 shadow-sm sm:p-7 md:grid-cols-[180px_minmax(0,1fr)] md:items-center">
        <MusicCover src={detail.song.coverUrl} fallbackSrc={detail.song.fallbackCoverUrl} alt={`${detail.song.title}封面`} variant="large" className="mx-auto aspect-square w-full max-w-[180px] border border-sky-100" sizes="180px" priority />
        <div className="min-w-0">
          <h1 className="break-words text-3xl font-black tracking-tight text-brand-950 sm:text-5xl">{detail.song.title}</h1>
          <p className="mt-3 text-sm font-black text-slate-700">《{detail.song.album.name}》</p>
          <p className="mt-2 text-sm font-bold text-slate-500">{detail.song.releaseYear} · {detail.song.languageLabel}</p>
          <Link href={`/ratings/albums/${detail.song.album.id}`} className="mt-3 inline-flex text-sm font-black text-brand-700 hover:underline">查看专辑《{detail.song.album.name}》的歌·颂详情 →</Link>
          <div className="mt-5 flex flex-wrap items-center gap-3">
            <RatingStars score={detail.stats.averageScore} size="text-2xl" label={`${formatAverageScore(detail.stats.averageScore)}分`} />
            <strong className="text-3xl font-black tabular-nums text-amber-600">{formatAverageScore(detail.stats.averageScore)}</strong>
          </div>
          <p className="mt-2 text-sm font-bold text-slate-500">{formatRatingCount(detail.stats.ratingCount)} 人评分 · {formatRatingCount(detail.stats.reviewCount)} 条评价</p>
        </div>
      </section>

      <div className="mt-5 grid gap-5">
        {user ? <RatingComposer target="song" targetId={songId} myRating={detail.myRating} myReview={detail.myReview} stats={detail.stats} /> : (
          <section className="border border-sky-100 bg-white/90 p-5 shadow-sm sm:p-7">
            <h2 className="text-xl font-black text-brand-950">想留下你的分数？</h2>
            <p className="mt-2 text-sm font-bold leading-6 text-slate-600">游客可以浏览榜单和短评，登录后才能评分、评论或点赞。</p>
            <Link href={`/login?next=${encodeURIComponent(nextPath)}`} className="mt-4 inline-flex bg-brand-950 px-5 py-3 text-sm font-black text-white">我要评分</Link>
          </section>
        )}
        <RatingReviews reviews={detail.reviews} sort={sort} loggedIn={Boolean(user)} nextPath={nextPath} />
      </div>
    </PageContainer>
  )
}

undefined
