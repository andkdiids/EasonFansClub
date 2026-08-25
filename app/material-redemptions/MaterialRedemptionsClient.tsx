'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'

type Material = {
  id: string
  title: string
  description: string | null
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

function formatCompactDate(value: string) {
  return new Date(value).toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: 'Asia/Shanghai',
  })
}

function displayStateLabel(material: Material) {
  if (material.stockRemaining < 1) return '已兑完'
  if (material.state === 'ACTIVE') return '兑换中'
  if (material.state === 'UPCOMING') return '即将开始'
  if (material.state === 'ENDED') return '已结束'
  return material.stateLabel
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
    <main className="site-page-main material-redemptions-page mx-auto min-w-0 max-w-7xl space-y-4 px-3 py-4 sm:space-y-6 sm:px-5 sm:py-8">
      <section className="material-redemptions-hero border border-sky-100 bg-white/90 p-4 shadow-sm sm:p-9">
        <p className="text-xs font-black tracking-[0.18em] text-brand-700 sm:text-sm sm:tracking-[0.22em]">EASON FANS CLUB</p>
        <h1 className="mt-2 text-2xl font-black text-brand-950 sm:mt-3 sm:text-5xl">还有什么可以送给你</h1>
        <p className="mt-2 max-w-3xl text-sm font-bold leading-6 text-slate-600 sm:mt-4 sm:text-base sm:leading-7">限时物料兑换，具体资格与核销截止时间见详情。</p>
        <div className="mt-3 flex flex-wrap gap-2 sm:mt-5 sm:gap-3">
          <Link href="/material-redemptions/me" className="inline-flex min-h-10 items-center border border-brand-700 px-3 text-sm font-black text-brand-700 sm:min-h-11 sm:px-4">我的兑换</Link>
          <Link href="/" className="inline-flex min-h-10 items-center border border-slate-200 px-3 text-xs font-bold text-slate-500 sm:min-h-11 sm:px-4 sm:text-sm">返回首页</Link>
        </div>
      </section>

      {loading ? <section className="border border-sky-100 bg-white/80 p-10 text-center font-bold text-slate-500">正在加载物料…</section> : null}
      {error ? <section className="border border-rose-200 bg-rose-50 p-5 font-bold text-rose-700">{error}</section> : null}
      {!loading && !error && !materials.length ? <section className="border border-sky-100 bg-white/80 p-10 text-center font-bold text-slate-500"><p>暂时没有正在兑换的物料。</p><p className="mt-2">等下一份礼物。</p></section> : null}
      {!loading && !error && materials.length ? <div className="material-redemption-filters">{([['ALL', '全部'], ['ACTIVE', '兑换中'], ['UPCOMING', '即将开始'], ['ENDED', '已结束']] as const).map(([value, label]) => <button key={value} type="button" onClick={() => setFilter(value)} className={`min-w-0 border px-2 text-xs font-black sm:px-4 sm:text-sm ${filter === value ? 'border-brand-950 bg-brand-950 text-white' : 'border-sky-100 text-slate-600'}`}>{label}</button>)}</div> : null}
      {!loading && !error && materials.length && !visibleMaterials.length ? <section className="border border-sky-100 bg-white/80 p-10 text-center font-bold text-slate-500">这个分类暂时没有物料。</section> : null}
      <section className="material-redemption-grid">
        {visibleMaterials.map((material) => (
          <Link key={material.id} href={`/material-redemptions/${material.id}`} className="material-redemption-card group">
            <div className="material-redemption-card-image">
              {material.coverImageUrl ? <img src={material.coverImageUrl} alt="" loading="lazy" /> : <div className="material-redemption-card-placeholder">🎁</div>}
            </div>
            <div className="material-redemption-card-body">
              <div className="material-redemption-card-heading"><h2>{material.title}</h2><span>{displayStateLabel(material)}</span></div>
              {material.description?.trim() ? <p className="material-redemption-card-description">{material.description}</p> : null}
              <div className="material-redemption-card-meta">
                <p>{material.cost === 0 ? '免费兑换' : <><strong>{material.cost}</strong> 挂号费</>}</p>
                <p className={material.stockRemaining < 1 ? 'is-sold-out' : ''}>{material.stockRemaining < 1 ? '已兑完' : <>剩余 <strong>{material.stockRemaining}</strong> / {material.stockTotal}</>}</p>
                <p>核销至 {formatCompactDate(material.redeemEndAt)}</p>
              </div>
            </div>
          </Link>
        ))}
      </section>
    </main>
  )
}
