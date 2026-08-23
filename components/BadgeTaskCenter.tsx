'use client'

import Link from 'next/link'
import { useState } from 'react'
import { BadgeCenterTabs } from '@/components/BadgeCenterTabs'

type TaskItem = {
  id: string
  name: string
  description: string | null
  imageUrl: string | null
  rarity: string
  progress: { current: number; target: number; percentage: number }
  remainingLabel: string
  ruleLabel: string
  series: { id: string; name: string } | null
}

export function BadgeTaskCenter({ initialTracking, initialRecommendations, maxTracking }: { initialTracking: TaskItem[]; initialRecommendations: TaskItem[]; maxTracking: number }) {
  const [tracking, setTracking] = useState(initialTracking)
  const [recommendations, setRecommendations] = useState(initialRecommendations)
  const [busy, setBusy] = useState<string | null>(null)
  const [message, setMessage] = useState('')

  const change = async (badge: TaskItem, add: boolean) => {
    setBusy(badge.id)
    setMessage('')
    try {
      const response = await fetch(`/api/users/me/badge-tasks/${encodeURIComponent(badge.id)}`, { method: add ? 'POST' : 'DELETE' })
      const data = await response.json().catch(() => null) as { message?: string } | null
      if (!response.ok) throw new Error(data?.message || '操作失败')
      if (add) {
        setTracking((current) => current.some((item) => item.id === badge.id) ? current : [...current, badge])
        setRecommendations((current) => current.filter((item) => item.id !== badge.id))
      } else {
        setTracking((current) => current.filter((item) => item.id !== badge.id))
      }
      window.dispatchEvent(new CustomEvent('eason-badge-task-updated', { detail: { badgeId: badge.id, tracked: add } }))
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '操作失败')
    } finally {
      setBusy(null)
    }
  }

  const card = (badge: TaskItem, tracked: boolean) => <article key={badge.id} className="badge-center-panel rounded-2xl p-4">
    <Link href={`/badges?badge=${encodeURIComponent(badge.id)}`} className="flex min-w-0 items-center gap-3 rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-sky-400">
      <span className="flex h-16 w-16 shrink-0 items-center justify-center">
        {badge.imageUrl ? <img src={badge.imageUrl} alt="" loading="lazy" className="h-full w-full object-contain" /> : <span className="text-3xl" aria-hidden>🏅</span>}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-xs font-black text-sky-700">{badge.series?.name || badge.ruleLabel}</span>
        <strong className="block truncate text-base font-black text-brand-950">{badge.name}</strong>
        <span className="mt-1 block text-xs font-bold text-slate-500">{badge.progress.current} / {badge.progress.target} · {badge.remainingLabel}</span>
      </span>
    </Link>
    <div className="mt-3 h-2 overflow-hidden rounded-full bg-sky-100"><span className="block h-full rounded-full bg-brand-700" style={{ width: `${badge.progress.percentage}%` }} /></div>
    <div className="mt-3 flex flex-wrap items-center justify-between gap-2"><strong className="text-xs text-brand-700">完成度 {badge.progress.percentage}%</strong><button type="button" disabled={busy === badge.id} onClick={() => void change(badge, !tracked)} className="rounded-full border border-sky-200 px-3 py-2 text-xs font-black text-brand-700 disabled:opacity-50">{busy === badge.id ? '处理中…' : tracked ? '取消追踪' : '追踪'}</button></div>
  </article>

  return <section className="badge-center-page space-y-5">
    <header className="badge-center-heading">
      <div><h1>勋章任务</h1><p>把正在成长的目标放在眼前，一步一步完成它。</p></div>
      <p className="badge-center-heading-stat">正在追踪 <strong>{tracking.length}</strong> / {maxTracking} 枚</p>
    </header>
    <BadgeCenterTabs active="tasks" />
    {message ? <p className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-bold text-rose-700">{message}</p> : null}
    <div className="grid gap-6 lg:grid-cols-[1.25fr_0.75fr]">
      <section><div className="mb-3 flex items-end justify-between gap-3"><h2 className="text-lg font-black text-brand-950">正在追踪</h2><span className="text-xs font-bold text-slate-500">{tracking.length} / {maxTracking} 枚</span></div><div className="space-y-3">{tracking.length ? tracking.map((item) => card(item, true)) : <div className="rounded-2xl border border-dashed border-sky-200 p-8 text-center text-sm font-bold text-slate-500">还没有追踪目标<br /><span className="mt-1 block font-medium">可以从下方推荐，或在展览馆选择一枚勋章开始追踪。</span></div>}</div></section>
      <section><h2 className="mb-3 text-lg font-black text-brand-950">推荐给你</h2><div className="space-y-3">{recommendations.length ? recommendations.map((item) => card(item, false)) : <div className="rounded-2xl border border-dashed border-sky-200 p-6 text-center text-sm font-bold text-slate-500">暂时没有合适的推荐目标。</div>}</div></section>
    </div>
  </section>
}
