'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useState } from 'react'
import { SafeAvatar } from '@/components/SafeAvatar'
import { formatRatingCount, type RatingReviewSort } from '@/lib/rating-types'
import type { RatingReviewView } from '@/lib/rating-service'
import { RatingStars } from './RatingStars'

function formatReviewDate(value: string) {
  return new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).format(new Date(value))
}

export function RatingReviews({ reviews, sort, loggedIn, nextPath }: Readonly<{ reviews: RatingReviewView[]; sort: RatingReviewSort; loggedIn: boolean; nextPath: string }>) {
  const pathname = usePathname()
  const router = useRouter()
  const [rows, setRows] = useState(reviews)
  const [pendingId, setPendingId] = useState<string | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<RatingReviewView | null>(null)
  const [error, setError] = useState('')

  function sortHref(nextSort: RatingReviewSort) {
    return `${pathname}?sort=${nextSort}#reviews`
  }

  async function toggleLike(reviewId: string) {
    if (pendingId) return
    if (!loggedIn) {
      window.location.assign(`/login?next=${encodeURIComponent(nextPath)}`)
      return
    }
    setPendingId(reviewId)
    setError('')
    try {
      const response = await fetch(`/api/ratings/reviews/${reviewId}/like`, { method: 'POST' })
      const data = await response.json().catch(() => null)
      if (!response.ok) throw new Error(data?.message || '点赞操作失败')
      setRows((current) => current.map((row) => row.id === reviewId ? { ...row, liked: Boolean(data.liked), likeCount: Number(data.likeCount) || 0 } : row))
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : '点赞操作失败，请稍后重试')
    } finally {
      setPendingId(null)
    }
  }

  async function confirmDelete() {
    if (!deleteTarget || pendingId) return
    setPendingId(deleteTarget.id)
    setError('')
    try {
      const response = await fetch(`/api/ratings/reviews/${deleteTarget.id}`, { method: 'DELETE' })
      const data = await response.json().catch(() => null)
      if (!response.ok) throw new Error(data?.message || '删除评价失败')
      setRows((current) => current.filter((row) => row.id !== deleteTarget.id))
      setDeleteTarget(null)
      router.refresh()
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : '删除评价失败，请稍后重试')
    } finally {
      setPendingId(null)
    }
  }

  return (
    <section id="reviews" className="scroll-mt-24" aria-labelledby="rating-reviews-title">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 id="rating-reviews-title" className="text-2xl font-black text-brand-950">大家怎么说</h2>
        </div>
        <div className="flex border border-sky-100 bg-white p-1 text-sm font-black" role="tablist" aria-label="评价排序">
          <Link href={sortHref('hot')} role="tab" aria-selected={sort === 'hot'} className={`px-3 py-2 ${sort === 'hot' ? 'bg-brand-950 text-white' : 'text-slate-500'}`}>热门</Link>
          <Link href={sortHref('latest')} role="tab" aria-selected={sort === 'latest'} className={`px-3 py-2 ${sort === 'latest' ? 'bg-brand-950 text-white' : 'text-slate-500'}`}>最新</Link>
        </div>
      </div>

      {error ? <p className="mt-4 text-sm font-black text-red-600" role="alert">{error}</p> : null}
      {rows.length ? (
        <div className="mt-4 space-y-3">
          {rows.map((review) => (
            <article key={review.id} className="border border-sky-100 bg-white/90 p-4 shadow-sm sm:p-5">
              <div className="flex items-start gap-3">
                <span className="h-10 w-10 shrink-0 overflow-hidden rounded-full border border-sky-100 bg-sky-50"><SafeAvatar src={review.user.avatarUrl} name={review.user.name} uid={review.user.uid} /></span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <strong className="truncate text-sm font-black text-brand-950">{review.user.name}</strong>
                    <span className="text-xs font-bold text-slate-500">· UID {String(review.user.uid).padStart(5, '0')}</span>
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-2">
                    <RatingStars score={review.score} size="text-sm" label={`${review.score}分`} />
                    <span className="text-xs font-black text-amber-600">{review.score}分</span>
                  </div>
                </div>
              </div>
              <p className="mt-3 whitespace-pre-wrap break-words text-sm font-medium leading-7 text-slate-700">{review.content}</p>
              <div className="mt-3 flex flex-wrap items-center justify-between gap-3 text-xs font-bold text-slate-500">
                <time dateTime={review.createdAt}>{formatReviewDate(review.createdAt)}</time>
                <div className="flex items-center gap-3">
                  {review.isOwn ? <button type="button" onClick={() => setDeleteTarget(review)} className="font-black text-red-600 hover:underline">删除评价</button> : null}
                  <button type="button" disabled={pendingId === review.id} onClick={() => void toggleLike(review.id)} aria-label={review.liked ? '取消点赞评价' : '点赞评价'} className={`inline-flex items-center gap-1 font-black ${review.liked ? 'text-rose-600' : 'text-slate-500'} disabled:opacity-50`}><span aria-hidden="true">{review.liked ? '♥' : '♡'}</span>{formatRatingCount(review.likeCount)}</button>
                </div>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <div className="mt-4 border border-dashed border-sky-200 bg-sky-50/55 p-8 text-center text-sm font-bold text-slate-500">还没有短评，成为第一个留下想法的人吧。</div>
      )}

      {deleteTarget ? (
        <div className="fixed inset-0 z-[90] grid place-items-center bg-slate-950/55 p-4" role="presentation" onClick={(event) => { if (event.target === event.currentTarget) setDeleteTarget(null) }}>
          <section role="dialog" aria-modal="true" aria-labelledby="delete-rating-review-title" className="w-full max-w-sm border border-sky-100 bg-white p-5 shadow-2xl">
            <h3 id="delete-rating-review-title" className="text-lg font-black text-brand-950">确定删除这条评价吗？</h3>
            <p className="mt-3 text-sm font-bold leading-6 text-slate-600">删除后可以重新发表评价，但本次评分仍会保留，且不能重新评分。</p>
            <div className="mt-5 flex justify-end gap-2">
              <button type="button" onClick={() => setDeleteTarget(null)} className="border border-sky-200 px-4 py-2 text-sm font-black text-slate-600">取消</button>
              <button type="button" onClick={() => void confirmDelete()} disabled={pendingId === deleteTarget.id} className="bg-red-600 px-4 py-2 text-sm font-black text-white disabled:opacity-50">{pendingId === deleteTarget.id ? '删除中…' : '确认删除'}</button>
            </div>
          </section>
        </div>
      ) : null}
    </section>
  )
}

undefined
