'use client'

import Link from 'next/link'
import { useState } from 'react'
import type { AdminRatingOverview } from '@/lib/rating-service'
import { formatAverageScore, formatRatingCount } from '@/lib/rating-types'

export function RatingAdminManager({ initial }: Readonly<{ initial: AdminRatingOverview }>) {
  const [overview, setOverview] = useState(initial)
  const [filter, setFilter] = useState<'all' | 'active' | 'deleted'>('active')
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [pendingId, setPendingId] = useState<string | null>(null)
  const rows = overview.reviews.filter((row) => filter === 'all' || (filter === 'active' ? !row.deletedAt : Boolean(row.deletedAt)))

  async function remove(reviewId: string) {
    if (pendingId || !window.confirm('确定删除这条评价吗？删除后评分仍会保留。')) return
    setPendingId(reviewId)
    setMessage('')
    setError('')
    try {
      const response = await fetch(`/api/admin/ratings/reviews/${reviewId}`, { method: 'DELETE' })
      const data = await response.json().catch(() => null)
      if (!response.ok) throw new Error(data?.message || '删除失败')
      setOverview((current) => ({ ...current, reviews: current.reviews.map((row) => row.id === reviewId ? { ...row, deletedAt: new Date().toISOString() } : row), stats: current.stats }))
      setMessage('评价已删除，评分聚合保持不变。')
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : '删除失败，请稍后重试')
    } finally {
      setPendingId(null)
    }
  }

  return (
    <>
      <header className="border-b border-sky-100 pb-5"><Link href="/admin" className="text-sm font-black text-brand-700">← 返回后台</Link><p className="mt-5 text-xs font-black tracking-[0.2em] text-brand-700">RATING ADMIN</p><h1 className="mt-2 text-3xl font-black text-brand-950">歌·颂管理</h1><p className="mt-2 text-sm font-bold text-slate-600">评价管理与评分统计。歌曲、专辑基础资料继续由 EasMusic 曲库维护。</p></header>
      <section className="grid gap-3 sm:grid-cols-3" aria-label="歌·颂评分统计">
        <div className="border border-sky-100 bg-white/90 p-5 shadow-sm"><span className="text-xs font-black text-slate-500">评分总数</span><strong className="mt-2 block text-3xl font-black text-brand-950">{formatRatingCount(overview.stats.ratingCount)}</strong></div>
        <div className="border border-sky-100 bg-white/90 p-5 shadow-sm"><span className="text-xs font-black text-slate-500">平均分</span><strong className="mt-2 block text-3xl font-black text-amber-600">{formatAverageScore(overview.stats.averageScore)}</strong></div>
        <div className="border border-sky-100 bg-white/90 p-5 shadow-sm"><span className="text-xs font-black text-slate-500">有效短评</span><strong className="mt-2 block text-3xl font-black text-brand-950">{formatRatingCount(overview.stats.reviewCount)}</strong></div>
      </section>
      <section className="border border-sky-100 bg-white/90 p-4 shadow-sm sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="text-xl font-black text-brand-950">评价管理</h2><div className="flex gap-2">{[['active', '有效'], ['deleted', '已删除'], ['all', '全部']].map(([value, label]) => <button key={value} type="button" onClick={() => setFilter(value as typeof filter)} className={`border px-3 py-2 text-xs font-black ${filter === value ? 'border-brand-950 bg-brand-950 text-white' : 'border-sky-100 text-slate-600'}`}>{label}</button>)}</div></div>
        {message ? <p className="mt-3 text-sm font-black text-emerald-700" role="status">{message}</p> : null}
        {error ? <p className="mt-3 text-sm font-black text-red-600" role="alert">{error}</p> : null}
        <div className="mt-4 overflow-x-auto"><table className="w-full min-w-[820px] text-left text-sm"><thead className="border-b border-sky-100 text-xs font-black text-slate-500"><tr><th className="p-3">作品</th><th className="p-3">用户 / UID</th><th className="p-3">评分</th><th className="p-3">短评</th><th className="p-3">时间</th><th className="p-3">状态</th><th className="p-3">操作</th></tr></thead><tbody>{rows.map((row) => <tr key={row.id} className="border-b border-sky-50 align-top last:border-0"><td className="p-3"><Link href={`/ratings/${row.target === 'song' ? 'songs' : 'albums'}/${row.targetId}`} className="font-black text-brand-700 hover:underline">{row.targetTitle}</Link><span className="mt-1 block text-xs text-slate-500">{row.target === 'song' ? '单曲' : '专辑'}</span></td><td className="p-3 font-bold text-slate-700">{row.user.name}<span className="mt-1 block text-xs text-slate-500">UID {String(row.user.uid).padStart(5, '0')}</span></td><td className="p-3 whitespace-nowrap"><span className="font-black text-amber-600">{row.score}分</span></td><td className="max-w-[320px] whitespace-pre-wrap break-words p-3 text-slate-700">{row.content}</td><td className="whitespace-nowrap p-3 text-xs text-slate-500">{row.createdAt.slice(0, 16).replace('T', ' ')}</td><td className="p-3 text-xs font-black">{row.deletedAt ? <span className="text-slate-400">已删除</span> : <span className="text-emerald-700">有效 · {row.likeCount} 赞</span>}</td><td className="p-3">{row.deletedAt ? <span className="text-xs font-bold text-slate-400">—</span> : <button type="button" onClick={() => void remove(row.id)} disabled={pendingId === row.id} className="whitespace-nowrap bg-red-50 px-3 py-2 text-xs font-black text-red-600 disabled:opacity-50">{pendingId === row.id ? '处理中…' : '删除评价'}</button>}</td></tr>)}</tbody></table>{!rows.length ? <p className="p-6 text-center text-sm font-bold text-slate-500">当前筛选没有评价。</p> : null}</div>
      </section>
    </>
  )
}
