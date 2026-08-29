'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { MaterialRedemptionQr } from '@/components/MaterialRedemptionQr'

type Order = {
  id: string
  material: { id: string; title: string; coverImageUrl: string | null; redeemEndAt: string }
  quantity: number
  totalCost: number
  status: string
  statusLabel: string
  source: 'MANUAL' | 'ACTIVITY_REGISTRATION_AUTO'
  sourceLabel: string
  linkedActivity: { id: string; title: string; startsAt: string | null; endsAt: string | null } | null
  redemptionSource: string | null
  redemptionSourceLabel: string | null
  linkedRegistration: { id: string; activityId: string; status: string; checkInSource: string | null } | null
  redeemCode: string
  redeemToken?: string
  createdAt: string
  redeemedAt: string | null
  expiredAt: string | null
  refundedAt: string | null
  refundReason: string | null
}

export function MaterialRedemptionOrderClient({ orderId }: { orderId: string }) {
  const [order, setOrder] = useState<Order | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    fetch(`/api/material-redemptions/orders/${orderId}`, { cache: 'no-store' })
      .then(async (response) => {
        const data = await response.json() as { order?: Order; message?: string }
        if (!response.ok || !data.order) throw new Error(data.message || '订单不存在')
        setOrder(data.order)
      })
      .catch((reason) => setError(reason instanceof Error ? reason.message : '订单加载失败'))
  }, [orderId])

  if (error) return <main className="site-page-main mx-auto max-w-4xl px-4 py-10"><section className="border border-rose-200 bg-rose-50 p-6 font-bold text-rose-700">{error}</section></main>
  if (!order) return <main className="site-page-main mx-auto max-w-4xl px-4 py-10"><section className="border border-sky-100 bg-white/90 p-8 text-center font-bold text-slate-500">正在加载订单…</section></main>
  const canShowQr = order.status === 'SUCCESS' && Boolean(order.redeemToken)

  return (
    <main className="site-page-main mx-auto min-w-0 max-w-4xl space-y-4 px-3 py-4 sm:space-y-5 sm:px-5 sm:py-9">
      <div className="flex flex-wrap items-center justify-between gap-3"><Link href="/material-redemptions/me" className="text-sm font-black text-brand-700">← 我的兑换</Link><span className="border border-sky-200 bg-sky-50 px-3 py-1 text-sm font-black text-brand-700">{order.statusLabel}</span></div>
      <section className="border border-sky-100 bg-white/90 p-4 shadow-sm sm:p-8"><p className="text-sm font-black tracking-[0.18em] text-brand-700">{order.sourceLabel}</p><h1 className="mt-2 break-words text-3xl font-black text-brand-950">{order.material.title}</h1><p className="mt-3 text-sm font-bold leading-6 text-slate-600 sm:leading-7">{order.source === 'ACTIVITY_REGISTRATION_AUTO' ? '这是活动报名成功后自动产生的物料记录，报名费用已包含本份物料，不需要再次支付。活动码或物料码任一扫描即可完成联动核销。' : '请在核销截止时间前向工作人员展示兑换码或二维码。扫码只会打开管理员确认页，不会自动完成核销。'}</p>{order.linkedActivity ? <p className="mt-3 text-sm font-black text-emerald-700">关联活动：{order.linkedActivity.title}{order.linkedActivity.startsAt ? ` · ${new Date(order.linkedActivity.startsAt).toLocaleString('zh-CN', { hour12: false, timeZone: 'Asia/Shanghai' })}` : ''}{order.linkedActivity.endsAt ? ` — ${new Date(order.linkedActivity.endsAt).toLocaleString('zh-CN', { hour12: false, timeZone: 'Asia/Shanghai' })}` : ''}</p> : null}<dl className="mt-4 grid gap-2 sm:mt-6 sm:grid-cols-3 sm:gap-3"><div className="border border-sky-100 bg-sky-50/60 p-3 sm:p-4"><dt className="text-xs font-bold text-slate-500">兑换码</dt><dd className="mt-1 break-all text-lg font-black tracking-[0.08em] text-brand-950 sm:mt-2">{order.redeemCode}</dd></div><div className="border border-sky-100 bg-sky-50/60 p-3 sm:p-4"><dt className="text-xs font-bold text-slate-500">数量 / 费用</dt><dd className="mt-1 text-lg font-black text-brand-950 sm:mt-2">{order.quantity} 件 · {order.source === 'ACTIVITY_REGISTRATION_AUTO' ? '活动报名费已包含' : `${order.totalCost} 挂号费`}</dd></div><div className="border border-sky-100 bg-sky-50/60 p-3 sm:p-4"><dt className="text-xs font-bold text-slate-500">{order.source === 'ACTIVITY_REGISTRATION_AUTO' ? '活动结束' : '核销截止'}</dt><dd className="mt-1 text-sm font-black text-brand-950 sm:mt-2">{new Date(order.source === 'ACTIVITY_REGISTRATION_AUTO' && order.linkedActivity?.endsAt ? order.linkedActivity.endsAt : order.material.redeemEndAt).toLocaleString('zh-CN', { hour12: false, timeZone: 'Asia/Shanghai' })}</dd></div></dl>{order.redemptionSourceLabel ? <p className="mt-4 text-sm font-black text-emerald-700">核销来源：{order.redemptionSourceLabel}</p> : null}</section>
      {canShowQr ? <section className="grid gap-3 border border-sky-100 bg-white/90 p-3 shadow-sm sm:gap-5 sm:grid-cols-[minmax(0,280px)_minmax(0,1fr)] sm:p-8"><MaterialRedemptionQr token={order.redeemToken!} /><div className="flex flex-col justify-center px-1 sm:px-0"><h2 className="text-xl font-black text-brand-950">到场核销</h2><p className="mt-3 text-sm font-bold leading-6 text-slate-600 sm:leading-7">请让管理员使用已登录的后台设备扫描。管理员确认物料、用户、数量和截止时间后，才会把订单从“待核销”改为“已核销”。</p></div></section> : null}
      {order.status === 'REDEEMED' ? <section className="border border-emerald-200 bg-emerald-50 p-5 text-sm font-bold text-emerald-800">该订单已于 {order.redeemedAt ? new Date(order.redeemedAt).toLocaleString('zh-CN', { hour12: false, timeZone: 'Asia/Shanghai' }) : '此前'} 完成核销。</section> : null}
      {order.status === 'REFUNDED' ? <section className="border border-amber-200 bg-amber-50 p-5 text-sm font-bold text-amber-800">该订单已退款。{order.refundReason ? `原因：${order.refundReason}` : ''}</section> : null}
      {order.status === 'EXPIRED' ? <section className="border border-slate-200 bg-slate-50 p-5 text-sm font-bold text-slate-600">该订单已超过核销截止时间，不能再核销。</section> : null}
    </main>
  )
}
