'use client'

import { useRef, useState } from 'react'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { ActivityImageUploader, uploadActivityImage, type ActivityImageSelection, type ActivityImageUploadStatus } from '@/components/activities/ActivityImageUploader'
import {
  GLOBAL_POINTS_GRANT_CONFIRMATION_TEXT,
  GLOBAL_POINTS_GRANT_MAX_AMOUNT,
  requiresGlobalPointsGrantStrongConfirmation,
} from '@/lib/global-points-grant-constants'

type Batch = {
  id: string
  title: string
  content: string
  imageUrl: string | null
  amount: number
  recipientCount: number
  totalAmount: number
  successAmount: number
  successCount: number
  failedCount: number
  status: string
  createdAt: string
  completedAt: string | null
  createdBy: { uid: number; nickname: string } | null
}

type Overview = { recipientCount: number; history: Batch[] }
type Detail = Batch & {
  failedRecipients: Array<{
    id: string
    userId: string
    uid: number | null
    username: string | null
    nickname: string | null
    amount: number
    status: string
    failureReason: string | null
    processedAt: string | null
  }>
}

function newIdempotencyKey() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  return `global-points-grant-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

function formatNumber(value: number) {
  return new Intl.NumberFormat('zh-CN').format(value)
}

function formatDateTime(value: string | null) {
  if (!value) return '—'
  return new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium', timeStyle: 'short', hour12: false }).format(new Date(value))
}

function statusLabel(status: string) {
  if (status === 'COMPLETED') return '已完成'
  if (status === 'PARTIAL_FAILED') return '部分失败'
  if (status === 'FAILED') return '全部失败'
  if (status === 'PROCESSING') return '处理中'
  return '待处理'
}

function statusClass(status: string) {
  if (status === 'COMPLETED') return 'bg-emerald-50 text-emerald-700'
  if (status === 'PARTIAL_FAILED' || status === 'FAILED') return 'bg-red-50 text-red-700'
  return 'bg-amber-50 text-amber-700'
}

export function GlobalPointsGrantManager({ initialOverview }: Readonly<{ initialOverview: Overview }>) {
  const [overview, setOverview] = useState(initialOverview)
  const [detail, setDetail] = useState<Detail | null>(null)
  const [title, setTitle] = useState('')
  const [content, setContent] = useState('')
  const [amount, setAmount] = useState('')
  const [imageUrl, setImageUrl] = useState<string | null>(null)
  const [imageStatus, setImageStatus] = useState<ActivityImageUploadStatus>('idle')
  const [imageError, setImageError] = useState('')
  const [resetSignal, setResetSignal] = useState(0)
  const [strongConfirmation, setStrongConfirmation] = useState('')
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [historyLoading, setHistoryLoading] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const idempotencyKeyRef = useRef(newIdempotencyKey())

  const numericAmount = Number(amount)
  const validAmount = Number.isSafeInteger(numericAmount) && numericAmount >= 1 && numericAmount <= GLOBAL_POINTS_GRANT_MAX_AMOUNT
  const previewTotal = validAmount ? overview.recipientCount * numericAmount : 0
  const requiresStrongConfirmation = validAmount && requiresGlobalPointsGrantStrongConfirmation(numericAmount, previewTotal)

  async function loadOverview() {
    setHistoryLoading(true)
    try {
      const response = await fetch('/api/admin/global-points-grants', { credentials: 'same-origin', cache: 'no-store' })
      const data = await response.json().catch(() => null) as Overview & { message?: string } | null
      if (!response.ok || !data) throw new Error(data?.message || '发放记录加载失败')
      setOverview(data)
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : '发放记录加载失败')
    } finally {
      setHistoryLoading(false)
    }
  }

  async function loadDetail(batchId: string) {
    setError('')
    try {
      const response = await fetch(`/api/admin/global-points-grants?id=${encodeURIComponent(batchId)}`, { credentials: 'same-origin', cache: 'no-store' })
      const data = await response.json().catch(() => null) as Detail & { message?: string } | null
      if (!response.ok || !data) throw new Error(data?.message || '发放详情加载失败')
      setDetail(data)
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : '发放详情加载失败')
    }
  }

  async function handleImageSelection(selection: ActivityImageSelection) {
    setImageError('')
    if (!selection.file) {
      setImageUrl(null)
      setImageStatus('idle')
      return
    }
    setImageStatus('uploading')
    try {
      setImageUrl(await uploadActivityImage(selection.file))
      setImageStatus('success')
    } catch (uploadError) {
      setImageUrl(null)
      setImageStatus('error')
      setImageError(uploadError instanceof Error ? uploadError.message : '图片上传失败，请稍后重试')
    }
  }

  async function refreshPreview() {
    setError('')
    if (!validAmount) {
      setError(`挂号费必须是 1-${GLOBAL_POINTS_GRANT_MAX_AMOUNT} 的正整数`)
      return
    }
    try {
      const response = await fetch('/api/admin/global-points-grants', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'preview', amount: numericAmount }),
      })
      const data = await response.json().catch(() => null) as { recipientCount?: number; message?: string } | null
      if (!response.ok || !data || typeof data.recipientCount !== 'number') throw new Error(data?.message || '人数预览失败')
      setOverview((current) => ({ ...current, recipientCount: data.recipientCount! }))
    } catch (previewError) {
      setError(previewError instanceof Error ? previewError.message : '人数预览失败')
    }
  }

  function prepareSend() {
    setMessage('')
    setError('')
    if (!title.trim()) { setError('发放标题不能为空'); return }
    if (!content.trim()) { setError('发放说明不能为空'); return }
    if (!validAmount) { setError(`挂号费必须是 1-${GLOBAL_POINTS_GRANT_MAX_AMOUNT} 的正整数`); return }
    if (imageStatus === 'uploading') { setError('图片仍在上传，请稍候'); return }
    if (imageStatus === 'error') { setError('请重新上传图片或移除图片'); return }
    if (overview.recipientCount === 0) { setError('当前没有可发放的有效用户'); return }
    setConfirmOpen(true)
  }

  async function submitGrant() {
    if (loading || !validAmount) return
    setLoading(true)
    setError('')
    try {
      const response = await fetch('/api/admin/global-points-grants', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'send',
          title,
          content,
          amount: numericAmount,
          imageUrl,
          idempotencyKey: idempotencyKeyRef.current,
          confirm: true,
          confirmationText: requiresStrongConfirmation ? strongConfirmation.trim() : undefined,
        }),
      })
      const data = await response.json().catch(() => null) as { message?: string; batch?: Batch } | null
      if (!response.ok) throw new Error(data?.message || '发放失败，请稍后重试')
      setConfirmOpen(false)
      setMessage(data?.message || '全站挂号费发放完成')
      setTitle('')
      setContent('')
      setAmount('')
      setImageUrl(null)
      setImageStatus('idle')
      setStrongConfirmation('')
      setResetSignal((value) => value + 1)
      idempotencyKeyRef.current = newIdempotencyKey()
      await loadOverview()
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : '发放失败，请稍后重试')
    } finally {
      setLoading(false)
    }
  }

  async function retryFailed() {
    if (!detail || loading || detail.failedCount === 0) return
    setLoading(true)
    setError('')
    try {
      const response = await fetch('/api/admin/global-points-grants', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'retry', batchId: detail.id }),
      })
      const data = await response.json().catch(() => null) as { message?: string } | null
      if (!response.ok) throw new Error(data?.message || '失败用户重试失败')
      setMessage(data?.message || '失败用户重试完成')
      await Promise.all([loadOverview(), loadDetail(detail.id)])
    } catch (retryError) {
      setError(retryError instanceof Error ? retryError.message : '失败用户重试失败')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="space-y-5">
      <section className="border border-sky-100 bg-white/90 p-5 shadow-sm sm:p-6">
        <p className="text-xs font-black tracking-[0.18em] text-brand-700">运营工具</p>
        <h1 className="mt-1 text-2xl font-black text-brand-950 sm:text-3xl">全站挂号费发放</h1>
        <p className="mt-2 max-w-3xl text-sm font-bold leading-6 text-slate-500">只向服务端筛选出的有效用户发放挂号费。每位用户独立记账、通知和处理结果，管理员与普通用户按现有有效用户规则一并计入。</p>
      </section>

      {message ? <p role="status" className="border border-emerald-100 bg-emerald-50 px-4 py-3 text-sm font-black text-emerald-700">{message}</p> : null}
      {error ? <p role="alert" className="border border-red-100 bg-red-50 px-4 py-3 text-sm font-black text-red-700">{error}</p> : null}

      <section className="border border-sky-100 bg-white/90 p-5 shadow-sm sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div><p className="text-xs font-black uppercase tracking-[0.16em] text-brand-700">New batch</p><h2 className="mt-1 text-xl font-black text-brand-950">创建发放批次</h2></div>
          <button type="button" onClick={() => void refreshPreview()} disabled={loading} className="min-h-10 border border-sky-200 bg-white px-4 text-sm font-black text-brand-700 disabled:opacity-50">刷新人数</button>
        </div>

        <div className="mt-5 grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(18rem,0.7fr)]">
          <div className="space-y-4">
            <label className="block text-sm font-black text-slate-700">发放标题
              <input value={title} maxLength={120} onChange={(event) => setTitle(event.target.value)} placeholder="例如：中秋特别挂号费" className="mt-1 min-h-11 w-full border border-sky-100 bg-white px-3 font-bold text-slate-800 outline-none focus:border-brand-300" />
            </label>
            <label className="block text-sm font-black text-slate-700">说明
              <textarea value={content} maxLength={5000} onChange={(event) => setContent(event.target.value)} rows={6} placeholder="请输入用户收到的说明" className="mt-1 w-full resize-y border border-sky-100 bg-white px-3 py-3 font-bold leading-6 text-slate-800 outline-none focus:border-brand-300" />
              <span className="mt-1 block text-right text-xs font-bold text-slate-400">{content.length}/5000</span>
            </label>
            <label className="block text-sm font-black text-slate-700">挂号费金额
              <input type="number" min={1} max={GLOBAL_POINTS_GRANT_MAX_AMOUNT} step={1} inputMode="numeric" value={amount} onChange={(event) => setAmount(event.target.value)} placeholder="例如：74" className="mt-1 min-h-12 w-full border border-amber-200 bg-amber-50/50 px-3 text-lg font-black text-brand-950 outline-none focus:border-amber-400" />
              <span className="mt-1 block text-xs font-bold text-slate-400">仅支持 1-{GLOBAL_POINTS_GRANT_MAX_AMOUNT} 的正整数。</span>
            </label>
            <ActivityImageUploader label="通知图片（可选，最多 1 张）" resetSignal={resetSignal} disabled={loading} status={imageStatus} errorMessage={imageError} onSelectionChange={(selection) => { void handleImageSelection(selection) }} />
            {requiresStrongConfirmation ? <label className="block border border-amber-200 bg-amber-50 px-3 py-3 text-sm font-black text-amber-900">金额较大，请在确认前输入 {GLOBAL_POINTS_GRANT_CONFIRMATION_TEXT}
              <input value={strongConfirmation} onChange={(event) => setStrongConfirmation(event.target.value)} placeholder={GLOBAL_POINTS_GRANT_CONFIRMATION_TEXT} className="mt-2 min-h-10 w-full border border-amber-200 bg-white px-3 font-bold outline-none" />
            </label> : null}
            <button type="button" onClick={prepareSend} disabled={loading || historyLoading} className="min-h-11 bg-brand-950 px-5 text-sm font-black text-white disabled:cursor-not-allowed disabled:opacity-50">发放</button>
          </div>

          <aside className="border border-sky-100 bg-sky-50/60 p-4">
            <p className="text-xs font-black tracking-[0.15em] text-sky-700">服务端预览</p>
            <dl className="mt-4 space-y-3">
              <div className="flex items-baseline justify-between gap-3 border-b border-sky-100 pb-3"><dt className="text-sm font-bold text-slate-500">预计发放人数</dt><dd className="text-2xl font-black text-brand-950">{formatNumber(overview.recipientCount)} 人</dd></div>
              <div className="flex items-baseline justify-between gap-3 border-b border-sky-100 pb-3"><dt className="text-sm font-bold text-slate-500">单人金额</dt><dd className="text-xl font-black text-emerald-700">{validAmount ? `+${formatNumber(numericAmount)}` : '—'}</dd></div>
              <div className="flex items-baseline justify-between gap-3"><dt className="text-sm font-bold text-slate-500">预计总额</dt><dd className="text-xl font-black text-brand-950">{validAmount ? formatNumber(previewTotal) : '—'}</dd></div>
            </dl>
            <p className="mt-5 border-t border-sky-100 pt-3 text-xs font-bold leading-5 text-slate-500">发放前服务端会重新统计有效用户并计算总额，前端人数只用于预览。</p>
          </aside>
        </div>
      </section>

      <section className="border border-sky-100 bg-white/90 p-5 shadow-sm sm:p-6">
        <div className="flex flex-wrap items-end justify-between gap-3"><div><p className="text-xs font-black uppercase tracking-[0.16em] text-brand-700">History</p><h2 className="mt-1 text-xl font-black text-brand-950">发放记录</h2></div><button type="button" onClick={() => void loadOverview()} disabled={historyLoading} className="min-h-10 border border-sky-200 bg-white px-4 text-sm font-black text-brand-700 disabled:opacity-50">{historyLoading ? '加载中…' : '刷新记录'}</button></div>
        <div className="mt-4 space-y-2">
          {overview.history.length ? overview.history.map((batch) => (
            <button key={batch.id} type="button" onClick={() => void loadDetail(batch.id)} className="flex w-full min-w-0 flex-wrap items-start gap-3 border border-sky-100 bg-white p-3 text-left transition hover:border-sky-300">
              {batch.imageUrl ? (
                <span className="size-16 shrink-0">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={batch.imageUrl} alt="发放通知图片" className="size-16 object-cover" />
                </span>
              ) : <span className="grid size-16 shrink-0 place-items-center bg-slate-50 text-xs font-black text-slate-400">无图片</span>}
              <span className="min-w-0 flex-1"><span className="flex flex-wrap items-center gap-2"><span className="break-words font-black text-brand-950">{batch.title}</span><span className={`px-2 py-0.5 text-[11px] font-black ${statusClass(batch.status)}`}>{statusLabel(batch.status)}</span></span><span className="mt-1 block text-xs font-bold text-slate-500">+{formatNumber(batch.amount)} · {formatNumber(batch.recipientCount)} 人 · 成功 {formatNumber(batch.successCount)} · 失败 {formatNumber(batch.failedCount)}</span><span className="mt-1 block text-[11px] font-bold text-slate-400">总额 {formatNumber(batch.totalAmount)} · {formatDateTime(batch.createdAt)}{batch.createdBy ? ` · ${batch.createdBy.nickname}（UID ${batch.createdBy.uid}）` : ''}</span></span>
            </button>
          )) : <p className="border border-sky-100 bg-sky-50/50 p-6 text-center text-sm font-bold text-slate-500">暂无发放记录</p>}
        </div>
      </section>

      {detail ? <section className="border border-sky-100 bg-white/90 p-5 shadow-sm sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-xs font-black uppercase tracking-[0.16em] text-brand-700">Batch detail</p><h2 className="mt-1 break-words text-xl font-black text-brand-950">{detail.title}</h2></div><button type="button" onClick={() => setDetail(null)} className="min-h-10 border border-sky-200 bg-white px-4 text-sm font-black text-slate-600">关闭详情</button></div>
        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4"><div className="bg-sky-50 p-3"><span className="text-xs font-black text-slate-500">金额</span><strong className="mt-1 block text-lg font-black text-emerald-700">+{formatNumber(detail.amount)}</strong></div><div className="bg-sky-50 p-3"><span className="text-xs font-black text-slate-500">预计人数</span><strong className="mt-1 block text-lg font-black text-brand-950">{formatNumber(detail.recipientCount)}</strong></div><div className="bg-sky-50 p-3"><span className="text-xs font-black text-slate-500">成功 / 失败</span><strong className="mt-1 block text-lg font-black text-brand-950">{detail.successCount} / {detail.failedCount}</strong></div><div className="bg-sky-50 p-3"><span className="text-xs font-black text-slate-500">成功总额</span><strong className="mt-1 block text-lg font-black text-brand-950">{formatNumber(detail.successAmount)}</strong></div></div>
        <p className="mt-4 whitespace-pre-wrap break-words text-sm font-bold leading-6 text-slate-600">{detail.content}</p>
        {detail.imageUrl ? (
          <span className="mt-4 block">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={detail.imageUrl} alt="发放通知图片" className="max-h-56 max-w-full object-contain" />
          </span>
        ) : null}
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-sky-100 pt-4"><p className="text-xs font-bold text-slate-400">创建：{formatDateTime(detail.createdAt)} · 完成：{formatDateTime(detail.completedAt)}</p>{detail.failedCount > 0 ? <button type="button" onClick={() => void retryFailed()} disabled={loading} className="min-h-10 bg-amber-600 px-4 text-sm font-black text-white disabled:opacity-50">重试失败用户</button> : null}</div>
        {detail.failedRecipients.length ? <div className="mt-4 overflow-x-auto"><table className="min-w-[680px] w-full border-collapse text-left text-sm"><thead className="border-b border-sky-100 text-xs font-black text-slate-400"><tr><th className="px-2 py-2">用户</th><th className="px-2 py-2">UID</th><th className="px-2 py-2">失败原因</th><th className="px-2 py-2">时间</th></tr></thead><tbody>{detail.failedRecipients.map((recipient) => <tr key={recipient.id} className="border-b border-sky-50"><td className="px-2 py-2 font-black text-brand-950">{recipient.username || recipient.userId}</td><td className="px-2 py-2 font-bold text-slate-500">{recipient.uid || '—'}</td><td className="max-w-sm whitespace-pre-wrap break-words px-2 py-2 font-bold text-red-700">{recipient.failureReason || '处理失败'}</td><td className="px-2 py-2 font-bold text-slate-400">{formatDateTime(recipient.processedAt)}</td></tr>)}</tbody></table></div> : <p className="mt-4 text-sm font-bold text-slate-500">当前没有失败用户。</p>}
      </section> : null}

      <ConfirmDialog open={confirmOpen} title="确认全站发放挂号费？" description={`即将向 ${formatNumber(overview.recipientCount)} 名有效用户发放：\n挂号费：+${formatNumber(numericAmount)}\n总发放挂号费：${formatNumber(previewTotal)}\n标题：${title.trim()}\n\n确认后将为每位用户写入挂号费流水并发送一条通知。`} confirmLabel="确认发放" loading={loading} confirmDisabled={Boolean(requiresStrongConfirmation && strongConfirmation.trim() !== GLOBAL_POINTS_GRANT_CONFIRMATION_TEXT)} onConfirm={() => void submitGrant()} onCancel={() => { if (!loading) setConfirmOpen(false) }} />
    </div>
  )
}
