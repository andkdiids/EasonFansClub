'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'

type Material = {
  id: string
  title: string
  description: string
  coverImageUrl: string | null
  cost: number
  stockRemaining: number
  stockTotal: number
  exchangeStartAt: string
  exchangeEndAt: string
  redeemEndAt: string
  state: string
  stateLabel: string
}

function formatDate(value: string) {
  return new Date(value).toLocaleString('zh-CN', { hour12: false, timeZone: 'Asia/Shanghai' })
}

export function MaterialRedemptionsClient() {
  const [materials, setMaterials] = useState<Material[]>([])
  const [filter, setFilter] = useState<'ALL' | 'ACTIVE' | 'UPCOMING' | 'ENDED'>('ALL')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    fetch('/api/material-redemptions', { cache: 'no-store' })
      .then(async (response) => {
        const data = await response.json() as { materials?: Material[]; message?: string }
        if (!response.ok) throw new Error(data.message || '物料列表加载失败')
        setMaterials(data.materials || [])
      })
      .catch((reason) => setError(reason instanceof Error ? reason.message : '物料列表加载失败'))
      .finally(() => setLoading(false))
  }, [])

  const visibleMaterials = materials.filter((material) => filter === 'ALL' || (filter === 'ACTIVE' && material.state === 'ACTIVE') || (filter === 'UPCOMING' && material.state === 'UPCOMING') || (filter === 'ENDED' && material.state === 'ENDED'))

  return (
    <main className="site-page-main mx-auto min-w-0 max-w-7xl space-y-6 px-4 py-6 sm:px-5 sm:py-8">
      <section className="border border-sky-100 bg-white/90 p-6 shadow-sm sm:p-9">
        <p className="text-sm font-black tracking-[0.22em] text-brand-700">EASON FANS CLUB</p>
        <h1 className="mt-3 text-3xl font-black text-brand-950 sm:text-5xl">还有什么可以送给你</h1>
        <p className="mt-4 max-w-3xl text-sm font-bold leading-7 text-slate-600 sm:text-base">限时物料兑换。每份物料的兑换时间、资格条件和核销截止时间都会单独说明。</p>
        <div className="mt-5 flex flex-wrap gap-3">
          <Link href="/material-redemptions/me" className="inline-flex min-h-11 items-center border border-brand-700 px-4 text-sm font-black text-brand-700">我的兑换</Link>
          <Link href="/" className="inline-flex min-h-11 items-center border border-slate-200 px-4 text-sm font-black text-slate-600">返回首页</Link>
        </div>
      </section>

      {loading ? <section className="border border-sky-100 bg-white/80 p-10 text-center font-bold text-slate-500">正在加载物料…</section> : null}
      {error ? <section className="border border-rose-200 bg-rose-50 p-5 font-bold text-rose-700">{error}</section> : null}
      {!loading && !error && !materials.length ? <section className="border border-sky-100 bg-white/80 p-10 text-center font-bold text-slate-500"><p>暂时没有正在兑换的物料。</p><p className="mt-2">等下一份礼物。</p></section> : null}
      {!loading && !error && materials.length ? <div className="flex flex-wrap gap-2 border-b border-sky-100 pb-3">{([['ALL', '全部'], ['ACTIVE', '兑换中'], ['UPCOMING', '即将开始'], ['ENDED', '已结束']] as const).map(([value, label]) => <button key={value} type="button" onClick={() => setFilter(value)} className={`min-h-10 border px-4 text-sm font-black ${filter === value ? 'border-brand-950 bg-brand-950 text-white' : 'border-sky-100 text-slate-600'}`}>{label}</button>)}</div> : null}
      {!loading && !error && materials.length && !visibleMaterials.length ? <section className="border border-sky-100 bg-white/80 p-10 text-center font-bold text-slate-500">这个分类暂时没有物料。</section> : null}
      <section className="grid min-w-0 gap-4 md:grid-cols-2 xl:grid-cols-3">
        {visibleMaterials.map((material) => (
          <Link key={material.id} href={`/material-redemptions/${material.id}`} className="group min-w-0 overflow-hidden border border-sky-100 bg-white/90 shadow-sm transition hover:-translate-y-0.5 hover:border-sky-300">
            <div className="aspect-[16/9] bg-sky-50">
              {material.coverImageUrl ? <img src={material.coverImageUrl} alt="" className="size-full object-cover" /> : <div className="grid size-full place-items-center text-5xl">🎁</div>}
            </div>
            <div className="min-w-0 p-5">
              <div className="flex items-start justify-between gap-3"><h2 className="min-w-0 break-words text-xl font-black text-brand-950">{material.title}</h2><span className="shrink-0 border border-sky-200 bg-sky-50 px-2 py-1 text-xs font-black text-brand-700">{material.stateLabel}</span></div>
              <p className="mt-3 line-clamp-3 text-sm font-bold leading-6 text-slate-600">{material.description}</p>
              <div className="mt-5 grid gap-2 text-xs font-black text-slate-500">
                <p>{material.cost === 0 ? '免费兑换' : <>消耗挂号费：<span className="text-brand-700">{material.cost}</span></>}</p>
                <p>剩余：<span className="text-brand-700">{material.stockRemaining}</span> / {material.stockTotal}</p>
                <p>开放时间：{formatDate(material.exchangeStartAt)}</p>
                <p>兑换截止：{formatDate(material.exchangeEndAt)}</p>
              </div>
            </div>
          </Link>
        ))}
      </section>
    </main>
  )
}
