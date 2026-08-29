'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'

type Order = {
  id: string
  material: { title: string; coverImageUrl: string | null; redeemEndAt: string }
  quantity: number
  totalCost: number
  status: string
  statusLabel: string
  source: 'MANUAL' | 'ACTIVITY_REGISTRATION_AUTO'
  sourceLabel: string
  linkedActivity: { id: string; title: string; startsAt: string | null; endsAt: string | null } | null
  redemptionSourceLabel: string | null
  linkedRegistration: { id: string; status: string; checkInSource: string | null } | null
  redeemCode: string
  createdAt: string
}

const tabs = [{ key: '', label: '全部' }, { key: 'SUCCESS', label: '待核销' }, { key: 'REDEEMED', label: '已核销' }, { key: 'EXPIRED', label: '已过期' }, { key: 'REFUNDED', label: '已退款' }]

export function MaterialRedemptionOrdersClient() {
  const [status, setStatus] = useState('')
  const [orders, setOrders] = useState<Order[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    setLoading(true)
    fetch(`/api/material-redemptions/me${status ? `?status=${status}` : ''}`, { cache: 'no-store' })
      .then(async (response) => {
        const data = await response.json() as { orders?: Order[]; message?: string }
        if (!response.ok) throw new Error(data.message || '订单加载失败')
        setOrders(data.orders || [])
      })
      .catch((reason) => setError(reason instanceof Error ? reason.message : '订单加载失败'))
      .finally(() => setLoading(false))
  }, [status])

  return (
    <main className="site-page-main mx-auto min-w-0 max-w-5xl space-y-5 px-4 py-6 sm:px-5 sm:py-9">
      <div className="flex flex-wrap items-center justify-between gap-3"><div><p className="text-sm font-black tracking-[0.18em] text-brand-700">EASON FANS CLUB</p><h1 className="mt-2 text-3xl font-black text-brand-950">我的兑换</h1></div><Link href="/material-redemptions" className="inline-flex min-h-11 items-center border border-brand-700 px-4 text-sm font-black text-brand-700">继续浏览物料</Link></div>
      <nav className="flex min-w-0 gap-2 overflow-x-auto border-b border-sky-100 pb-2" aria-label="兑换订单状态"><div className="flex min-w-max gap-2">{tabs.map((tab) => <button key={tab.key} type="button" onClick={() => setStatus(tab.key)} className={`min-h-10 border px-4 text-sm font-black ${status === tab.key ? 'border-brand-950 bg-brand-950 text-white' : 'border-sky-100 bg-white text-slate-600'}`}>{tab.label}</button>)}</div></nav>
      {loading ? <section className="border border-sky-100 bg-white/80 p-8 text-center font-bold text-slate-500">正在加载订单…</section> : null}
      {error ? <section className="border border-rose-200 bg-rose-50 p-4 font-bold text-rose-700">{error}</section> : null}
      {!loading && !error && !orders.length ? <section className="border border-sky-100 bg-white/80 p-8 text-center font-bold text-slate-500">当前分类还没有兑换订单。</section> : null}
      <section className="grid gap-3">
        {orders.map((order) => <Link key={order.id} href={`/material-redemptions/orders/${order.id}`} className="flex min-w-0 gap-4 border border-sky-100 bg-white/90 p-4 shadow-sm transition hover:border-sky-300"><div className="size-20 shrink-0 overflow-hidden bg-sky-50">{order.material.coverImageUrl ? <img src={order.material.coverImageUrl} alt="" className="size-full object-cover" /> : <div className="grid size-full place-items-center text-3xl">🎁</div>}</div><div className="min-w-0 flex-1"><div className="flex flex-wrap items-start justify-between gap-2"><h2 className="break-words text-lg font-black text-brand-950">{order.material.title}</h2><span className="shrink-0 border border-sky-200 bg-sky-50 px-2 py-1 text-xs font-black text-brand-700">{order.statusLabel}</span></div><p className="mt-2 text-sm font-black text-emerald-700">{order.sourceLabel}</p>{order.linkedActivity ? <p className="mt-1 text-sm font-bold text-slate-600">关联活动：{order.linkedActivity.title}</p> : null}<p className="mt-2 text-sm font-bold text-slate-600">兑换 {order.quantity} 件 · {order.source === 'ACTIVITY_REGISTRATION_AUTO' ? '已包含在活动报名费中' : `消耗 ${order.totalCost} 挂号费`}</p><p className="mt-2 text-xs font-bold text-slate-400">兑换码 {order.redeemCode} · {order.redemptionSourceLabel || `核销截止 ${new Date(order.material.redeemEndAt).toLocaleString('zh-CN', { hour12: false, timeZone: 'Asia/Shanghai' })}`}</p></div></Link>)}
      </section>
    </main>
  )
}
