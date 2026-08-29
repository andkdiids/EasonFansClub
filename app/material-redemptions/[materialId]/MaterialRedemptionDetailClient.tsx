'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'

type MaterialDetail = {
  id: string
  title: string
  description: string
  coverImageUrl: string | null
  instructions: string | null
  cost: number
  stockRemaining: number
  stockTotal: number
  perUserLimit: number
  exchangeStartAt: string
  exchangeEndAt: string
  redeemEndAt: string
  state: string
  stateLabel: string
  redemptionRule: 'DEFAULT' | 'ACTIVITY_REGISTRATION_REQUIRED'
  linkedActivityId: string | null
  linkedActivity: { id: string; title: string; startsAt: string | null; endsAt: string | null; registrationFee: number } | null
  isActivityBound: boolean
  rules: Array<{ type: string; label: string }>
  activityRegistration?: {
    id: string
    status: 'ACTIVE' | 'CANCELLED'
    paidRegistrationFee: number
    verifiedAt: string | null
    checkedInAt: string | null
    checkInSource: string | null
    linkedMaterialRedemption: { id: string; status: string; redeemCode: string; redeemedAt: string | null } | null
  } | null
  eligibility?: { qualified: boolean; reasons: string[]; canExchange: boolean; balanceEnough: boolean; priorQuantity: number; remainingUserQuota: number; progress: Array<{ type: string; operator: string; actual: number | boolean; qualified: boolean }> }
  currentBalance?: number
}

function formatDate(value: string) {
  return new Date(value).toLocaleString('zh-CN', { hour12: false, timeZone: 'Asia/Shanghai' })
}

function activityMaterialStatusLabel(status: string) {
  if (status === 'REDEEMED') return '已核销'
  if (status === 'CANCELLED' || status === 'REFUNDED') return '兑换已取消'
  return '待核销'
}

export function MaterialRedemptionDetailClient({ materialId }: { materialId: string }) {
  const router = useRouter()
  const [material, setMaterial] = useState<MaterialDetail | null>(null)
  const [quantity, setQuantity] = useState(1)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [message, setMessage] = useState('')

  useEffect(() => {
    fetch(`/api/material-redemptions/${materialId}`, { cache: 'no-store' })
      .then(async (response) => {
        const data = await response.json() as { material?: MaterialDetail; message?: string }
        if (!response.ok || !data.material) throw new Error(data.message || '物料不存在')
        setMaterial(data.material)
        setQuantity(Math.max(1, Math.min(data.material.eligibility?.remainingUserQuota || data.material.perUserLimit, 1)))
      })
      .catch((error) => setMessage(error instanceof Error ? error.message : '物料加载失败'))
      .finally(() => setLoading(false))
  }, [materialId])

  async function exchange() {
    if (!material) return
    setBusy(true)
    setMessage('')
    const idempotencyKey = `material-${material.id}-${crypto.randomUUID()}`
    try {
      const response = await fetch(`/api/material-redemptions/${material.id}/exchange`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey }, body: JSON.stringify({ idempotencyKey, quantity }) })
      const data = await response.json() as { order?: { id: string }; message?: string }
      if (!response.ok || !data.order) throw new Error(data.message || '兑换失败')
      router.push(`/material-redemptions/orders/${data.order.id}`)
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '兑换失败')
    } finally {
      setBusy(false)
    }
  }

  if (loading) return <main className="site-page-main mx-auto max-w-5xl px-4 py-10"><section className="border border-sky-100 bg-white/90 p-10 text-center font-bold text-slate-500">正在加载物料…</section></main>
  if (!material) return <main className="site-page-main mx-auto max-w-5xl px-4 py-10"><section className="border border-rose-200 bg-rose-50 p-6 font-bold text-rose-700">{message || '物料不存在'}</section></main>
  const balanceQuantity = material.cost > 0 && material.currentBalance !== undefined ? Math.floor(material.currentBalance / material.cost) : material.perUserLimit
  const maxQuantity = Math.max(1, Math.min(material.perUserLimit, material.eligibility?.remainingUserQuota || material.perUserLimit, material.stockRemaining, Math.max(1, balanceQuantity)))
  const canExchange = !material.isActivityBound && Boolean(material.eligibility?.canExchange && maxQuantity > 0)
  const activity = material.linkedActivity
  const activityRegistration = material.activityRegistration

  return (
    <main className="site-page-main mx-auto min-w-0 max-w-5xl space-y-5 px-4 py-6 sm:px-5 sm:py-9">
      <Link href="/material-redemptions" className="text-sm font-black text-brand-700">← 返回物料列表</Link>
      <section className="grid min-w-0 overflow-hidden border border-sky-100 bg-white/90 shadow-sm md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div className="min-h-64 bg-sky-50 md:min-h-full">{material.coverImageUrl ? <img src={material.coverImageUrl} alt="" className="size-full object-cover" /> : <div className="grid size-full min-h-64 place-items-center text-7xl">🎁</div>}</div>
        <div className="min-w-0 p-6 sm:p-8">
          <div className="flex items-start justify-between gap-3"><h1 className="min-w-0 break-words text-3xl font-black text-brand-950">{material.title}</h1><span className="shrink-0 border border-sky-200 bg-sky-50 px-2 py-1 text-xs font-black text-brand-700">{material.stateLabel}</span></div>
          <p className="mt-4 whitespace-pre-wrap break-words text-sm font-bold leading-7 text-slate-600">{material.description}</p>
          {material.isActivityBound && activity ? <section className="mt-5 border border-emerald-200 bg-emerald-50/70 p-4 text-sm font-bold text-emerald-950"><p className="font-black">活动限定</p><p className="mt-2">需报名「{activity.title}」后自动兑换，无需在物料页另行支付挂号费。</p><p className="mt-2">活动时间：{activity.startsAt ? formatDate(activity.startsAt) : '未设置'}{activity.endsAt ? ` — ${formatDate(activity.endsAt)}` : ''}</p>{activityRegistration?.status === 'CANCELLED' ? <p className="mt-3 font-black text-amber-800">你已取消过该活动报名，兑换已取消且不能再次报名。</p> : activityRegistration?.linkedMaterialRedemption ? <p className="mt-3 font-black">已通过活动报名自动兑换 · {activityMaterialStatusLabel(activityRegistration.linkedMaterialRedemption.status)} · 核销码 {activityRegistration.linkedMaterialRedemption.redeemCode}</p> : activityRegistration?.status === 'ACTIVE' ? <p className="mt-3 font-black">已报名，活动物料将在活动核销时同步完成核销。</p> : null}<Link href={`/activities/${activity.id}`} className="mt-4 inline-flex min-h-10 items-center border border-emerald-700 px-4 text-sm font-black text-emerald-800">前往活动报名</Link></section> : null}
          <dl className="mt-6 grid gap-3 text-sm font-bold text-slate-600 sm:grid-cols-2">
            <div className="border border-sky-100 bg-sky-50/60 p-3"><dt className="text-xs text-slate-500">所需费用</dt><dd className="mt-1 text-lg font-black text-brand-700">{material.isActivityBound ? '已包含在活动报名费中' : material.cost === 0 ? '免费兑换' : `${material.cost} 挂号费`}</dd></div>
            <div className="border border-sky-100 bg-sky-50/60 p-3"><dt className="text-xs text-slate-500">剩余数量</dt><dd className="mt-1 text-lg font-black text-brand-700">{material.stockRemaining} / {material.stockTotal}</dd></div>
            <div className="border border-sky-100 bg-sky-50/60 p-3"><dt className="text-xs text-slate-500">{material.isActivityBound ? '活动开始' : '兑换截止'}</dt><dd className="mt-1 text-sm font-black text-brand-950">{formatDate(material.isActivityBound ? material.exchangeStartAt : material.exchangeEndAt)}</dd></div>
            <div className="border border-sky-100 bg-sky-50/60 p-3"><dt className="text-xs text-slate-500">{material.isActivityBound ? '活动结束' : '核销截止'}</dt><dd className="mt-1 text-sm font-black text-brand-950">{formatDate(material.isActivityBound ? material.exchangeEndAt : material.redeemEndAt)}</dd></div>
          </dl>
          {!material.isActivityBound && material.eligibility ? <div className="mt-5 border border-sky-100 p-4 text-sm font-bold text-slate-600"><p>当前挂号费：<span className="font-black text-brand-700">{material.currentBalance ?? 0}</span></p><p className="mt-2">资格：<span className={material.eligibility.qualified ? 'text-emerald-700' : 'text-rose-700'}>{material.eligibility.qualified ? '已满足' : material.eligibility.reasons.join('；') || '未满足'}</span></p>{!material.eligibility.balanceEnough ? <p className="mt-2 text-rose-700">挂号费不足：需要 {material.cost}，当前 {material.currentBalance ?? 0}</p> : null}<p className="mt-2">本账号还可兑换：{material.eligibility.remainingUserQuota} 件</p></div> : !material.isActivityBound ? <p className="mt-5 border border-amber-100 bg-amber-50 p-4 text-sm font-bold text-amber-800">兑换前需要登录，并会在提交时再次检查资格、库存和挂号费。</p> : null}
          {material.rules.length ? <div className="mt-5"><p className="text-sm font-black text-brand-950">兑换条件</p><ul className="mt-2 list-disc space-y-1 pl-5 text-sm font-bold text-slate-600">{material.rules.map((rule, index) => <li key={`${rule.type}-${index}`}>{rule.label}</li>)}</ul></div> : null}
          {material.eligibility?.progress?.length ? <div className="mt-4 border border-sky-100 bg-sky-50/50 p-4"><p className="text-sm font-black text-brand-950">当前条件进度</p><ul className="mt-2 space-y-2 text-sm font-bold text-slate-600">{material.eligibility.progress.map((progress, index) => <li key={`${progress.type}-${index}`} className="flex items-start justify-between gap-3"><span className="min-w-0 break-words">{material.rules[index]?.label || '兑换条件'}</span><span className={progress.qualified ? 'shrink-0 text-emerald-700' : 'shrink-0 text-rose-700'}>{typeof progress.actual === 'boolean' ? (progress.qualified ? '已满足' : '未满足') : `当前 ${progress.actual}`}</span></li>)}</ul></div> : null}
          {material.instructions ? <div className="mt-5 border-t border-sky-100 pt-5"><p className="text-sm font-black text-brand-950">兑换说明</p><p className="mt-2 whitespace-pre-wrap break-words text-sm font-bold leading-7 text-slate-600">{material.instructions}</p></div> : null}
          {!material.isActivityBound ? <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-end">
            <label className="text-sm font-black text-brand-950">数量<input type="number" min={1} max={maxQuantity} value={quantity} onChange={(event) => setQuantity(Math.max(1, Math.min(maxQuantity, Number(event.target.value) || 1)))} className="mt-2 block h-11 w-28 border border-sky-200 px-3" disabled={!canExchange || busy} /></label>
            <button type="button" onClick={() => setConfirmOpen(true)} disabled={!canExchange || busy} className="inline-flex min-h-11 flex-1 items-center justify-center bg-brand-950 px-5 text-sm font-black text-white disabled:cursor-not-allowed disabled:opacity-40">{busy ? '提交中…' : material.state === 'UPCOMING' ? '尚未开始' : material.state === 'PAUSED' ? '兑换已暂停' : material.stockRemaining < 1 ? '暂时无库存' : '确认兑换'}</button>
          </div> : null}
          {message ? <p className="mt-4 border border-rose-200 bg-rose-50 p-3 text-sm font-bold text-rose-700">{message}</p> : null}
        </div>
      </section>
      {confirmOpen ? <div className="fixed inset-0 z-50 grid place-items-center bg-brand-950/55 p-4" role="presentation" onClick={() => { if (!busy) setConfirmOpen(false) }}><div role="dialog" aria-modal="true" aria-labelledby="material-redemption-confirm-title" className="w-full max-w-md border border-sky-100 bg-white p-6 shadow-xl" onClick={(event) => event.stopPropagation()}><h2 id="material-redemption-confirm-title" className="text-xl font-black text-brand-950">确认兑换？</h2><p className="mt-3 break-words text-lg font-black text-brand-950">{material.title}</p><dl className="mt-5 grid gap-3 text-sm font-bold text-slate-600"><div className="flex justify-between gap-4 border-b border-sky-100 pb-2"><dt>需要消耗</dt><dd className="font-black text-brand-700">{material.cost * quantity} 挂号费</dd></div><div className="flex justify-between gap-4 border-b border-sky-100 pb-2"><dt>当前余额</dt><dd className="font-black text-brand-950">{material.currentBalance ?? 0}</dd></div><div className="flex justify-between gap-4 border-b border-sky-100 pb-2"><dt>兑换后余额</dt><dd className="font-black text-brand-950">{(material.currentBalance ?? 0) - material.cost * quantity}</dd></div><div className="flex justify-between gap-4"><dt>本次数量 / 每人限兑</dt><dd className="font-black text-brand-950">{quantity} / {material.perUserLimit} 件</dd></div></dl><div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end"><button type="button" onClick={() => setConfirmOpen(false)} disabled={busy} className="min-h-11 border border-slate-200 px-5 text-sm font-black text-slate-600">取消</button><button type="button" onClick={() => void exchange()} disabled={busy} className="min-h-11 bg-brand-950 px-5 text-sm font-black text-white disabled:opacity-40">{busy ? '兑换中…' : '确认兑换'}</button></div></div></div> : null}
    </main>
  )
}
