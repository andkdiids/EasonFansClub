'use client'

import { useCallback, useEffect, useState } from 'react'
import {
  isRecord,
  stringOr,
  type TopicLotteryAddress,
  type TopicLotteryAddressPayload,
} from '@/components/activities/TopicActivityV2LotteryTypes'

const inputClass = 'mt-1 min-h-11 w-full rounded-sm border border-[var(--border)] bg-[var(--surface)] px-3 text-sm disabled:opacity-50'
const buttonClass = 'min-h-11 rounded-sm border border-[var(--border)] px-4 text-sm font-bold disabled:opacity-40'

const emptyAddress = (): TopicLotteryAddress => ({ recipient: '', phone: '', province: '', city: '', district: '', address: '', remark: '' })

function readPayload(value: unknown): TopicLotteryAddressPayload | null {
  if (!isRecord(value) || !isRecord(value.winner)) return null
  const winner = value.winner
  const address = isRecord(value.address) ? {
    recipient: stringOr(value.address.recipient),
    phone: stringOr(value.address.phone),
    province: stringOr(value.address.province),
    city: stringOr(value.address.city),
    district: stringOr(value.address.district),
    address: stringOr(value.address.address),
    remark: stringOr(value.address.remark),
  } : null
  const shipment = isRecord(value.shipment) ? { carrier: typeof value.shipment.carrier === 'string' ? value.shipment.carrier : null, trackingNumber: typeof value.shipment.trackingNumber === 'string' ? value.shipment.trackingNumber : null } : null
  return {
    winner: { id: stringOr(winner.id), prizeName: stringOr(winner.prizeName, '中奖奖品'), addressDeadline: typeof winner.addressDeadline === 'string' ? winner.addressDeadline : null, shippingStatus: stringOr(winner.shippingStatus, 'WAITING_ADDRESS') },
    address,
    shipment,
  }
}

function dateLabel(value: string | null) {
  if (!value) return '未设置'
  const parsed = new Date(value)
  return Number.isFinite(parsed.getTime()) ? parsed.toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' }) : value
}

function statusLabel(value: string) {
  return ({ WAITING_ADDRESS: '等待提交收货信息', ADDRESS_SAVED: '收货信息已提交', TO_SHIP: '待发货', SHIPPED: '已发货', COMPLETED: '已送达', DELIVERED: '已送达', EXPIRED: '已过期', EXCEPTION: '配送异常', PII_DELETED: '收货信息已删除' } as Record<string, string>)[value] || value
}

export function TopicActivityV2LotteryClaim({ activityId, winnerId }: { activityId: string; winnerId: string }) {
  const [payload, setPayload] = useState<TopicLotteryAddressPayload | null>(null)
  const [draft, setDraft] = useState<TopicLotteryAddress>(emptyAddress)
  const [consent, setConsent] = useState(false)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')

  const base = '/api/activities/' + encodeURIComponent(activityId) + '/v2/lottery/winners/' + encodeURIComponent(winnerId) + '/address'
  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const response = await fetch(base, { credentials: 'same-origin', cache: 'no-store' })
      const body = await response.json().catch(() => null)
      if (!response.ok) throw new Error(isRecord(body) && typeof body.message === 'string' ? body.message : '收货信息加载失败')
      const value = readPayload(body)
      if (!value) throw new Error('收货信息格式不可用')
      setPayload(value)
      setDraft(value.address || emptyAddress())
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '收货信息加载失败')
    } finally {
      setLoading(false)
    }
  }, [base])

  useEffect(() => { void load() }, [load])

  function patchAddress(update: Partial<TopicLotteryAddress>) {
    setDraft((current) => ({ ...current, ...update }))
  }

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (saving) return
    if (!consent) { setError('请先同意仅用于本次抽奖配送的隐私说明。'); return }
    if (!draft.recipient.trim() || !draft.phone.trim() || !draft.province.trim() || !draft.city.trim() || !draft.district.trim() || !draft.address.trim()) { setError('请完整填写收件人、联系电话、省市区和详细地址。'); return }
    setSaving(true)
    setError('')
    setMessage('')
    try {
      const response = await fetch(base, { method: 'PUT', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ address: draft, consent: true }) })
      const body = await response.json().catch(() => null)
      if (!response.ok) throw new Error(isRecord(body) && typeof body.message === 'string' ? body.message : '收货信息提交失败')
      const value = readPayload(body)
      if (!value) throw new Error('收货信息返回格式不可用')
      setPayload(value)
      setDraft(value.address || draft)
      setConsent(false)
      setMessage('收货信息已保存。截止前可再次修改，发货后将锁定。')
    } catch (cause) {
      // Keep the controlled draft untouched so a transient API failure does not erase PII the user just entered.
      setError(cause instanceof Error ? cause.message : '收货信息提交失败')
    } finally {
      setSaving(false)
    }
  }

  const deadline = payload?.winner.addressDeadline ? Date.parse(payload.winner.addressDeadline) : Number.NaN
  const deadlinePassed = Number.isFinite(deadline) && Date.now() > deadline
  const locked = !payload || deadlinePassed || ['SHIPPED', 'COMPLETED', 'DELIVERED', 'EXPIRED', 'PII_DELETED'].includes(payload.winner.shippingStatus)

  return <main className="site-page-main mx-auto w-full max-w-2xl px-4 py-6 sm:py-10">
    <section className="space-y-5 border border-[var(--border)] bg-[var(--surface)] p-4 sm:p-7">
      <div><p className="text-xs font-black tracking-[0.16em] text-[var(--primary)]">TOPIC V2 LOTTERY</p><h1 className="mt-1 break-words text-2xl font-black">提交收货信息</h1><p className="mt-2 text-sm text-[var(--foreground-muted)]">仅用于本次实物奖品配送；收货信息不会出现在公开名单、通知或日志中。</p></div>
      {loading ? <p role="status" className="text-sm">正在加载中奖信息…</p> : null}
      {error && !payload ? <div><p role="alert" className="text-sm text-[var(--danger)]">{error}</p><button type="button" className={buttonClass + ' mt-3'} onClick={() => void load()}>重试</button></div> : null}
      {payload ? <><div className="border border-[var(--border)] p-3 text-sm"><p className="font-bold">中奖奖品：{payload.winner.prizeName}</p><p className="mt-1">收件截止：{dateLabel(payload.winner.addressDeadline)}</p><p className="mt-1">状态：{statusLabel(payload.winner.shippingStatus)}</p>{payload.shipment ? <p className="mt-1">物流：{payload.shipment.carrier || '未填写'} {payload.shipment.trackingNumber || ''}</p> : null}</div>{locked ? <p className="text-sm text-[var(--foreground-muted)]">{deadlinePassed ? '收件截止时间已过，无法再提交。' : ['SHIPPED', 'COMPLETED', 'DELIVERED'].includes(payload.winner.shippingStatus) ? '奖品已发货，收货信息已锁定。' : payload.winner.shippingStatus === 'EXPIRED' ? '收件信息提交期限已过。' : '收货信息已按保留规则删除。'}</p> : <form className="space-y-4" onSubmit={save}><div className="grid gap-4 sm:grid-cols-2"><label className="block text-sm">收件人<input className={inputClass} maxLength={80} value={draft.recipient} onChange={(event) => patchAddress({ recipient: event.target.value })} autoComplete="name" /></label><label className="block text-sm">联系电话<input className={inputClass} maxLength={40} value={draft.phone} onChange={(event) => patchAddress({ phone: event.target.value })} autoComplete="tel" /></label><label className="block text-sm">省<input className={inputClass} maxLength={40} value={draft.province} onChange={(event) => patchAddress({ province: event.target.value })} autoComplete="address-level1" /></label><label className="block text-sm">市<input className={inputClass} maxLength={40} value={draft.city} onChange={(event) => patchAddress({ city: event.target.value })} autoComplete="address-level2" /></label><label className="block text-sm">区 / 县<input className={inputClass} maxLength={40} value={draft.district} onChange={(event) => patchAddress({ district: event.target.value })} autoComplete="address-level3" /></label></div><label className="block text-sm">详细地址<textarea className={inputClass + ' p-3'} rows={3} maxLength={300} value={draft.address} onChange={(event) => patchAddress({ address: event.target.value })} autoComplete="street-address" /></label><label className="block text-sm">配送备注（可选）<textarea className={inputClass + ' p-3'} rows={2} maxLength={300} value={draft.remark} onChange={(event) => patchAddress({ remark: event.target.value })} /></label><label className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-1" checked={consent} onChange={(event) => setConsent(event.target.checked)} /><span>我同意将以上信息用于本次抽奖奖品配送，并理解发货后不能修改。</span></label><button type="submit" className={buttonClass} disabled={saving}>{saving ? '保存中…' : payload.address ? '保存修改' : '提交收货信息'}</button>{error ? <p role="alert" className="text-sm text-[var(--danger)]">{error}</p> : null}{message ? <p role="status" className="text-sm">{message}</p> : null}</form>}</> : null}
    </section>
  </main>
}
