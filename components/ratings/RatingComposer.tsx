'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { formatAverageScore } from '@/lib/rating-types'
import type { OwnRatingView, OwnReviewView, RatingStatsView } from '@/lib/rating-service'
import { RatingSelector, RatingStars } from './RatingStars'

export function RatingComposer({ target, targetId, myRating, myReview, stats }: Readonly<{
  target: 'song' | 'album'
  targetId: string
  myRating: OwnRatingView | null
  myReview: OwnReviewView | null
  stats: RatingStatsView
}>) {
  const router = useRouter()
  const [score, setScore] = useState<number | null>(null)
  const [content, setContent] = useState('')
  const [reviewMode, setReviewMode] = useState(false)
  const [pending, setPending] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  async function submitRating() {
    if (!score || pending) return
    setPending(true)
    setError('')
    setMessage('')
    try {
      const response = await fetch(`/api/ratings/${target === 'song' ? 'songs' : 'albums'}/${targetId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ score, content }),
      })
      const data = await response.json().catch(() => null)
      if (!response.ok) throw new Error(data?.message || '提交评分失败，请稍后重试')
      setMessage('评分已提交，之后不能修改或重新评分。')
      setScore(null)
      setContent('')
      router.refresh()
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : '提交评分失败，请稍后重试')
    } finally {
      setPending(false)
    }
  }

  async function submitReview() {
    if (!content.trim() || pending) return
    setPending(true)
    setError('')
    setMessage('')
    try {
      const response = await fetch('/api/ratings/reviews', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ target, targetId, content }),
      })
      const data = await response.json().catch(() => null)
      if (!response.ok) throw new Error(data?.message || '发表评价失败，请稍后重试')
      setMessage('评价已发表。')
      setContent('')
      setReviewMode(false)
      router.refresh()
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : '发表评价失败，请稍后重试')
    } finally {
      setPending(false)
    }
  }

  const title = target === 'song' ? '给这首歌打分' : '给这张专辑打分'

  return (
    <section className="border border-sky-100 bg-white/90 p-5 shadow-sm sm:p-7" aria-labelledby="rating-composer-title">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="rating-composer-title" className="text-2xl font-black text-brand-950">{myRating ? '你的评分' : title}</h2>
        </div>
        <span className="text-xs font-bold text-slate-500">当前平均 {formatAverageScore(stats.averageScore)} 分</span>
      </div>

      {myRating ? (
        <div className="mt-5">
          <div className="flex flex-wrap items-center gap-3">
            <RatingStars score={myRating.score} size="text-2xl" label={`${myRating.score}分`} />
            <strong className="text-2xl font-black tabular-nums text-amber-600">{myRating.score}分</strong>
            <span className="text-sm font-bold text-emerald-700">评分已永久锁定</span>
          </div>
          {myReview ? (
            <div className="mt-5 border-l-2 border-brand-300 pl-4">
              <p className="text-xs font-black text-slate-500">你已发表评价</p>
              <p className="mt-2 whitespace-pre-wrap text-sm font-medium leading-7 text-slate-700">{myReview.content}</p>
            </div>
          ) : reviewMode ? (
            <div className="mt-5">
              <textarea value={content} onChange={(event) => setContent(event.target.value)} maxLength={1000} autoFocus rows={4} placeholder="写下你的想法（选填）" className="w-full resize-y border border-sky-200 bg-white px-4 py-3 text-sm font-medium text-slate-800 outline-none placeholder:text-slate-400 focus:border-brand-400" />
              <div className="mt-3 flex flex-wrap gap-2">
                <button type="button" onClick={() => { setReviewMode(false); setContent('') }} className="border border-sky-200 px-4 py-2 text-sm font-black text-slate-600">取消</button>
                <button type="button" onClick={() => void submitReview()} disabled={pending || !content.trim()} className="bg-brand-950 px-4 py-2 text-sm font-black text-white disabled:cursor-not-allowed disabled:opacity-50">{pending ? '发表中…' : '发表评价'}</button>
              </div>
            </div>
          ) : (
            <div className="mt-5 flex flex-wrap items-center gap-3">
              <span className="text-sm font-bold text-slate-500">你暂时没有发表评价</span>
              <button type="button" onClick={() => setReviewMode(true)} className="border border-brand-300 bg-brand-50 px-4 py-2 text-sm font-black text-brand-700">写评价</button>
            </div>
          )}
        </div>
      ) : (
        <div className="mt-5">
          <p className="text-sm font-black text-slate-700">你的评分</p>
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <RatingSelector value={score} onChange={setScore} disabled={pending} />
            <strong className="min-w-[3.5rem] text-2xl font-black tabular-nums text-amber-600">{score ? `${score}分` : '—'}</strong>
          </div>
          <p className="mt-2 text-xs font-bold text-slate-500">每半颗星为 1 分；点击第 4 颗星左半是 7 分，右半是 8 分。</p>
          <textarea value={content} onChange={(event) => setContent(event.target.value)} maxLength={1000} rows={4} placeholder="写下你的想法（选填）" className="mt-5 w-full resize-y border border-sky-200 bg-white px-4 py-3 text-sm font-medium text-slate-800 outline-none placeholder:text-slate-400 focus:border-brand-400" />
          <button type="button" onClick={() => void submitRating()} disabled={pending || !score} className="mt-3 bg-brand-950 px-5 py-3 text-sm font-black text-white disabled:cursor-not-allowed disabled:opacity-50">{pending ? '提交中…' : '提交评分'}</button>
        </div>
      )}

      {message ? <p className="mt-4 text-sm font-black text-emerald-700" role="status">{message}</p> : null}
      {error ? <p className="mt-4 text-sm font-black text-red-600" role="alert">{error}</p> : null}
    </section>
  )
}

undefined
