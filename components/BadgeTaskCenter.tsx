'use client'

import Link from 'next/link'
import { useState } from 'react'

type TaskItem = {
  id: string; name: string; description: string | null; imageUrl: string | null; rarity: string
  progress: { current: number; target: number; percentage: number }; remainingLabel: string
  ruleLabel: string; series: { id: string; name: string } | null
}

export function BadgeTaskCenter({ initialTracking, initialRecommendations, maxTracking }: { initialTracking: TaskItem[]; initialRecommendations: TaskItem[]; maxTracking: number }) {
  const [tracking, setTracking] = useState(initialTracking)
  const [recommendations, setRecommendations] = useState(initialRecommendations)
  const [busy, setBusy] = useState<string | null>(null)
  const [message, setMessage] = useState('')

  const change = async (badge: TaskItem, add: boolean) => {
    setBusy(badge.id); setMessage('')
    try {
      const response = await fetch(`/api/users/me/badge-tasks/${encodeURIComponent(badge.id)}`, { method: add ? 'POST' : 'DELETE' })
      const data = await response.json().catch(() => null) as { message?: string } | null
      if (!response.ok) throw new Error(data?.message || '操作失败')
      if (add) {
        setTracking((current) => [...current, badge])
        setRecommendations((current) => current.filter((item) => item.id !== badge.id))
      } else {
        setTracking((current) => current.filter((item) => item.id !== badge.id))
      }
    } catch (error) { setMessage(error instanceof Error ? error.message : '操作失败') } finally { setBusy(null) }
  }

  const card = (badge: TaskItem, tracked: boolean) => <article key={badge.id} className="rounded-[24px] border border-sky-100 bg-white p-4 shadow-sm">
    <div className="flex items-center gap-3"><div className="flex h-16 w-16 shrink-0 items-center justify-center">{badge.imageUrl ? <img src={badge.imageUrl} alt="" loading="lazy" className="h-full w-full object-contain" /> : <span className="text-3xl" aria-hidden>🏅</span>}</div><div className="min-w-0 flex-1"><p className="text-xs font-black text-sky-700">{badge.series?.name || badge.ruleLabel}</p><h2 className="truncate text-base font-black text-brand-950">{badge.name}</h2><p className="mt-1 text-xs font-bold text-slate-500">{badge.progress.current} / {badge.progress.target} · {badge.remainingLabel}</p></div></div>
    <div className="mt-3 h-2 overflow-hidden rounded-full bg-sky-100"><span className="block h-full rounded-full bg-brand-700" style={{ width: `${badge.progress.percentage}%` }} /></div>
    <div className="mt-3 flex items-center justify-between"><strong className="text-xs text-brand-700">完成度 {badge.progress.percentage}%</strong><button type="button" disabled={busy === badge.id || (!tracked && tracking.length >= maxTracking)} onClick={() => void change(badge, !tracked)} className="rounded-full border border-sky-200 px-3 py-2 text-xs font-black text-brand-700 disabled:opacity-50">{busy === badge.id ? '处理中…' : tracked ? '取消追踪' : '加入任务'}</button></div>
  </article>

  return <section className="space-y-6">
    <header className="rounded-[28px] border border-sky-100 bg-white/90 p-5 sm:p-7"><p className="text-xs font-black tracking-[0.18em] text-sky-700">BADGE TASKS</p><div className="mt-2 flex flex-wrap items-end justify-between gap-3"><div><h1 className="text-2xl font-black text-brand-950">勋章任务</h1><p className="mt-2 text-sm font-bold text-slate-500">正在追踪 {tracking.length} / {maxTracking} 枚，专注最值得完成的目标。</p></div><div className="flex gap-2"><Link href="/badges" className="rounded-full bg-sky-50 px-4 py-2 text-xs font-black text-brand-700">返回展览馆</Link><Link href="/badges/year-in-review" className="rounded-full bg-brand-950 px-4 py-2 text-xs font-black text-white">年度荣誉</Link></div></div>{message ? <p className="mt-3 text-sm font-bold text-rose-600">{message}</p> : null}</header>
    <div className="grid gap-6 lg:grid-cols-[1.25fr_0.75fr]"><section><h2 className="mb-3 text-lg font-black text-brand-950">正在追踪</h2><div className="space-y-3">{tracking.length ? tracking.map((item) => card(item, true)) : <div className="rounded-[24px] border border-dashed border-sky-200 p-8 text-center text-sm font-bold text-slate-500">还没有追踪目标，从右侧推荐中选一枚开始吧。</div>}</div></section><section><h2 className="mb-3 text-lg font-black text-brand-950">推荐给你</h2><div className="space-y-3">{recommendations.length ? recommendations.map((item) => card(item, false)) : <div className="rounded-[24px] border border-dashed border-sky-200 p-6 text-center text-sm font-bold text-slate-500">暂时没有合适的推荐目标。</div>}</div></section></div>
  </section>
}
