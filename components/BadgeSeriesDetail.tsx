'use client'

import { useEffect, useState } from 'react'
import { BadgeImage } from '@/components/UserDisplayName'
import type { BadgeView } from '@/lib/badge-types'

type SeriesData = { series: { id: string; name: string; description: string | null }; collected: number; total: number; percentage: number; completed: boolean; reward: BadgeView | null; items: BadgeView[] }

export function BadgeSeriesDetail({ seriesId, userUid, isSelf }: { seriesId: string; userUid?: string; isSelf: boolean }) {
  const [data, setData] = useState<SeriesData | null>(null)
  const [error, setError] = useState('')
  useEffect(() => {
    const query = userUid ? `?user=${encodeURIComponent(userUid)}` : ''
    fetch(`/api/badge-series/${encodeURIComponent(seriesId)}${query}`, { cache: 'no-store' }).then(async (response) => { const payload = await response.json().catch(() => null); if (!response.ok) throw new Error(payload?.message || '系列加载失败'); return payload as SeriesData }).then(setData).catch((reason) => setError(reason instanceof Error ? reason.message : '系列加载失败'))
  }, [seriesId, userUid])
  if (error) return <section className="rounded-2xl bg-red-50 p-5 text-sm font-black text-red-700">{error}</section>
  if (!data) return <section className="rounded-2xl bg-white/85 p-5 text-sm font-bold text-slate-500">正在加载系列…</section>
  return <section className="rounded-2xl border border-violet-100 bg-white/85 p-5 shadow-sm"><p className="text-xs font-black uppercase tracking-[0.18em] text-violet-700">Badge Series</p><h1 className="mt-2 text-2xl font-black text-brand-950">{data.series.name}</h1>{data.series.description ? <p className="mt-2 text-sm font-bold leading-6 text-slate-500">{data.series.description}</p> : null}<div className="mt-5 flex items-end justify-between gap-3"><strong className="text-lg font-black text-brand-950">{data.collected} / {data.total}</strong><span className="text-sm font-black text-violet-700">{data.completed ? '系列已完成' : `${data.percentage}%`}</span></div><div className="mt-2 h-2 overflow-hidden rounded-full bg-violet-100"><span className="block h-full rounded-full bg-violet-700" style={{ width: `${data.percentage}%` }} /></div><div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3">{data.items.map((badge) => <article key={badge.id} className="rounded-2xl border border-sky-100 bg-sky-50/50 p-3"><BadgeImage badge={badge} size="wall" /><h2 className="mt-2 truncate text-sm font-black text-brand-950">{badge.name}</h2><p className="mt-1 text-xs font-bold text-slate-500">{badge.status === 'OBTAINED' ? '✓ 已获得' : badge.progress ? `${badge.progress.current} / ${badge.progress.target}` : '未获得'}</p></article>)}</div>{data.reward ? <div className="mt-5 rounded-2xl border border-amber-100 bg-amber-50/60 p-4"><p className="text-xs font-black text-amber-800">完成奖励</p><div className="mt-2 flex items-center gap-3"><BadgeImage badge={data.reward} size="wall" /><span className="text-sm font-black text-brand-950">{data.reward.status === 'HIDDEN' ? '集齐全部后揭晓' : data.reward.name}</span></div></div> : null}<p className="mt-5 text-xs font-bold text-slate-400">{isSelf ? '你可以继续收集系列中的每一枚荣誉。' : '只展示当前可见的系列收藏。'}</p></section>
}
