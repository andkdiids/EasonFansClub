import Link from 'next/link'
import { notFound } from 'next/navigation'
import { PageContainer } from '@/components/PageContainer'
import { MusicCover } from '@/components/music/MusicCover'
import { RatingComposer } from '@/components/ratings/RatingComposer'
import { RatingReviews } from '@/components/ratings/RatingReviews'
import { RatingStars } from '@/components/ratings/RatingStars'
import { getCurrentUser } from '@/lib/auth'
import { getAlbumRatingDetail } from '@/lib/rating-service'
import { formatAverageScore, formatRatingCount, parseRatingReviewSort, type RatingReviewSort } from '@/lib/rating-types'

type SearchParams = Promise<Record<string, string | string[] | undefined>>

function firstParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] || '' : value || ''
}

export const dynamic = 'force-dynamic'

export default async function RatingAlbumPage({ params, searchParams }: { params: Promise<{ albumId: string }>; searchParams: SearchParams }) {
  const { albumId } = await params
  const query = await searchParams
  const sort = parseRatingReviewSort(firstParam(query.sort)) as RatingReviewSort
  const user = await getCurrentUser()
  const detail = await getAlbumRatingDetail(albumId, user?.id || null, sort)
  if (!detail) notFound()

  const nextPath = `/ratings/albums/${albumId}${sort === 'latest' ? '?sort=latest' : ''}`
  return (
    <PageContainer className="mx-auto max-w-5xl px-4 py-6 sm:px-6 sm:py-9">
      <Link href="/ratings?type=albums" className="text-sm font-black text-brand-700 hover:underline">← 返回专辑榜</Link>

      <section className="mt-5 grid gap-5 border border-sky-100 bg-white/90 p-5 shadow-sm sm:p-7 md:grid-cols-[180px_minmax(0,1fr)] md:items-center">
        <MusicCover src={detail.album.coverUrl} alt={`${detail.album.name}封面`} variant="large" className="mx-auto aspect-square w-full max-w-[180px] border border-sky-100" sizes="180px" priority />
        <div className="min-w-0">
          <h1 className="break-words text-3xl font-black tracking-tight text-brand-950 sm:text-5xl">{detail.album.name}</h1>
          <p className="mt-3 text-sm font-black text-slate-700">{detail.album.artist}</p>
          <p className="mt-2 text-sm font-bold text-slate-500">{detail.album.releaseYear} · {detail.album.languageLabel}</p>
          <div className="mt-5 flex flex-wrap items-center gap-3">
            <RatingStars score={detail.stats.averageScore} size="text-2xl" label={`${formatAverageScore(detail.stats.averageScore)}分`} />
            <strong className="text-3xl font-black tabular-nums text-amber-600">{formatAverageScore(detail.stats.averageScore)}</strong>
          </div>
          <p className="mt-2 text-sm font-bold text-slate-500">{formatRatingCount(detail.stats.ratingCount)} 人评分 · {formatRatingCount(detail.stats.reviewCount)} 条评价</p>
        </div>
      </section>

      <section className="mt-5 border border-sky-100 bg-white/90 p-5 shadow-sm sm:p-7" aria-labelledby="rating-album-songs">
        <div className="flex items-end justify-between gap-3">
          <div><h2 id="rating-album-songs" className=" text-2xl font-black text-brand-950">本专辑歌曲</h2></div>
          <span className="text-xs font-bold text-slate-500">{detail.album.songs.length} 首</span>
        </div>
        {detail.album.songs.length ? (
          <div className="mt-4 divide-y divide-sky-100 border-y border-sky-100">
            {detail.album.songs.map((song) => (
              <Link key={song.id} href={`/ratings/songs/${song.id}`} className="grid grid-cols-[2rem_3.5rem_minmax(0,1fr)_auto] items-center gap-3 py-3 hover:bg-sky-50/60 sm:grid-cols-[2.5rem_4rem_minmax(0,1fr)_auto] sm:gap-4">
                <span className="text-center text-sm font-black tabular-nums text-brand-500">{String(song.trackNumber).padStart(2, '0')}</span>
                <MusicCover src={song.coverUrl} fallbackSrc={song.fallbackCoverUrl} alt={`${song.title}封面`} className="aspect-square w-full border border-sky-100" sizes="64px" />
                <span className="min-w-0"><strong className="block truncate text-sm font-black text-brand-950 sm:text-base">{song.title}</strong><span className="mt-1 block text-xs font-bold text-slate-500">{song.releaseYear} · {song.languageLabel}</span></span>
                <span className="text-right"><span className="block text-sm font-black tabular-nums text-amber-600">{formatAverageScore(song.averageScore)}</span><span className="block text-[11px] font-bold text-slate-500">{formatRatingCount(song.ratingCount)} 人</span></span>
              </Link>
            ))}
          </div>
        ) : <p className="mt-4 text-sm font-bold text-slate-500">本专辑暂未收录曲目。</p>}
      </section>

      <div className="mt-5 grid gap-5">
        {user ? <RatingComposer target="album" targetId={albumId} myRating={detail.myRating} myReview={detail.myReview} stats={detail.stats} /> : (
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
