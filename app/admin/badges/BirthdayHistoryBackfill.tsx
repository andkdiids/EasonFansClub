'use client'

import { useState } from 'react'
import type { BirthdayHistoryBackfillInput, BirthdayHistoryBackfillSummary } from '@/lib/birthday-history-backfill'

const DEFAULT_START_DATE = '2026-07-01'
const DEFAULT_END_DATE = '2026-09-01'

type BackfillResponse = { summary?: BirthdayHistoryBackfillSummary; message?: string }

function displayDate(value: string) {
  return value.replaceAll('-', '/')
}

function Count({ label, value, tone = 'text-brand-950' }: { label: string; value: number; tone?: string }) {
  return <div className="rounded-xl border border-sky-100 bg-white/80 p-3"><strong className={`block text-xl font-black ${tone}`}>{value}</strong><span className="text-[11px] font-bold text-slate-500">{label}</span></div>
}

function CategorySummary({ title, category }: { title: string; category: BirthdayHistoryBackfillSummary['birthday'] }) {
  return (
    <div className="rounded-2xl border border-sky-100 bg-white/75 p-4">
      <h3 className="font-black text-brand-950">{title}</h3>
      <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Count label="应补发" value={category.eligible} tone="text-violet-800" />
        <Count label="已拥有" value={category.alreadyOwned} tone="text-slate-600" />
        <Count label="无对应规则" value={category.noRule} tone="text-amber-800" />
        <Count label="预计新增" value={category.pending} tone="text-emerald-800" />
      </div>
      {category.failed ? <p className="mt-3 text-xs font-black text-red-700">执行失败：{category.failed} 项</p> : null}
    </div>
  )
}

export function BirthdayHistoryBackfill() {
  const [startDate, setStartDate] = useState(DEFAULT_START_DATE)
  const [endDate, setEndDate] = useState(DEFAULT_END_DATE)
  const [includeBirthday, setIncludeBirthday] = useState(true)
  const [includeZodiac, setIncludeZodiac] = useState(true)
  const [preview, setPreview] = useState<BirthdayHistoryBackfillSummary | null>(null)
  const [previewInput, setPreviewInput] = useState<BirthdayHistoryBackfillInput | null>(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  function clearPreview() {
    setPreview(null)
    setPreviewInput(null)
    setMessage('')
  }

  function updateStartDate(value: string) {
    setStartDate(value)
    clearPreview()
  }

  function updateEndDate(value: string) {
    setEndDate(value)
    clearPreview()
  }

  function updateIncludeBirthday(value: boolean) {
    setIncludeBirthday(value)
    clearPreview()
  }

  function updateIncludeZodiac(value: boolean) {
    setIncludeZodiac(value)
    clearPreview()
  }

  async function previewBackfill(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setBusy(true)
    setError('')
    setMessage('')
    const input = { startDate, endDate, includeBirthday, includeZodiac }
    try {
      const response = await fetch('/api/admin/badges/birthday-backfill/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      })
      const data = await response.json().catch(() => null) as BackfillResponse | null
      if (!response.ok || !data?.summary) throw new Error(data?.message || '历史补发预览失败')
      setPreview(data.summary)
      setPreviewInput(input)
    } catch (previewError) {
      setError(previewError instanceof Error ? previewError.message : '历史补发预览失败')
    } finally {
      setBusy(false)
    }
  }

  async function executeBackfill() {
    if (!preview || !previewInput || busy) return
    const confirmed = window.confirm([
      '确认补发历史生日 / 星座勋章？',
      '',
      `日期范围：${displayDate(previewInput.startDate)} ～ ${displayDate(previewInput.endDate)}`,
      `预计涉及：${preview.matchedUserCount} 位用户`,
      `预计新增：${preview.totalPending} 枚勋章`,
      '',
      '该操作不会回收已有勋章，也不会重复授予。',
    ].join('\n'))
    if (!confirmed) return

    setBusy(true)
    setError('')
    setMessage('')
    try {
      const response = await fetch('/api/admin/badges/birthday-backfill/execute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...previewInput, confirmed: true }),
      })
      const data = await response.json().catch(() => null) as BackfillResponse | null
      if (!response.ok || !data?.summary) throw new Error(data?.message || '历史补发执行失败')
      setPreview(data.summary)
      setMessage(`补发完成：新增 ${data.summary.totalGranted} 枚，已跳过 ${data.summary.totalSkipped} 项，失败 ${data.summary.totalFailed} 项。`)
    } catch (executeError) {
      setError(executeError instanceof Error ? executeError.message : '历史补发执行失败')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="rounded-[28px] border border-violet-100 bg-violet-50/70 p-5 shadow-sm sm:p-7" data-birthday-history-backfill>
      <header>
        <p className="text-xs font-black uppercase tracking-[0.18em] text-violet-700">Historical Badge Backfill</p>
        <h2 className="mt-2 text-2xl font-black text-brand-950">生日 / 星座勋章历史补发</h2>
        <p className="mt-2 max-w-3xl text-sm font-bold leading-6 text-slate-600">按上海时区的历史日期重新判断生日当天与所属星座周期。预览只读；确认执行后只补发缺失勋章，不修改生日、不回收勋章。</p>
      </header>

      <form onSubmit={previewBackfill} className="mt-5 grid gap-3 rounded-2xl border border-violet-100 bg-white/75 p-4 md:grid-cols-2">
        <label className="text-xs font-black text-slate-600">开始日期<input required type="date" value={startDate} onChange={(event) => updateStartDate(event.target.value)} className="admin-badge-input" /></label>
        <label className="text-xs font-black text-slate-600">结束日期<input required type="date" value={endDate} onChange={(event) => updateEndDate(event.target.value)} className="admin-badge-input" /></label>
        <div className="flex flex-wrap gap-4 text-sm font-black text-brand-950 md:col-span-2">
          <label className="flex items-center gap-2"><input type="checkbox" checked={includeBirthday} onChange={(event) => updateIncludeBirthday(event.target.checked)} />生日当天勋章</label>
          <label className="flex items-center gap-2"><input type="checkbox" checked={includeZodiac} onChange={(event) => updateIncludeZodiac(event.target.checked)} />星座勋章</label>
        </div>
        <p className="text-xs font-bold leading-5 text-slate-500 md:col-span-2">默认范围：2026/07/01 ～ 2026/09/01（包含起止日期）。只有点击“预览补发”后才会计算，预览不会写入数据库。</p>
        <div className="md:col-span-2"><button type="submit" disabled={busy} className="min-h-10 rounded-xl bg-brand-950 px-5 py-2 text-sm font-black text-white disabled:opacity-50">{busy ? '处理中…' : '预览补发'}</button></div>
      </form>

      {error ? <p role="alert" className="mt-4 rounded-xl bg-red-50 px-4 py-3 text-sm font-black text-red-700">{error}</p> : null}
      {message ? <p role="status" className="mt-4 rounded-xl bg-emerald-50 px-4 py-3 text-sm font-black text-emerald-700">{message}</p> : null}

      {preview ? (
        <section className="mt-5 rounded-2xl border border-violet-100 bg-white/85 p-4 sm:p-5" aria-live="polite">
          <h3 className="font-black text-brand-950">补发预览</h3>
          <p className="mt-1 text-sm font-bold text-slate-600">日期范围：{displayDate(preview.startDate)} ～ {displayDate(preview.endDate)} · 时区：{preview.timezone}</p>
          <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Count label="候选用户" value={preview.candidateUserCount} />
            <Count label="匹配用户" value={preview.matchedUserCount} tone="text-violet-800" />
            <Count label="预计新增" value={preview.totalPending} tone="text-emerald-800" />
            <Count label="失败" value={preview.totalFailed} tone="text-red-700" />
          </div>
          <div className="mt-4 grid gap-3 md:grid-cols-2">
            {preview.includeBirthday ? <CategorySummary title="生日勋章" category={preview.birthday} /> : null}
            {preview.includeZodiac ? <CategorySummary title="星座勋章" category={preview.zodiac} /> : null}
          </div>
          <p className="mt-4 rounded-xl bg-amber-50 px-3 py-3 text-sm font-black text-amber-900">总计预计新发放：{preview.totalPending} 枚勋章。已有勋章会自动跳过，预览不会发放或发送通知。</p>
          <div className="mt-4 flex flex-wrap gap-2">
            <button type="button" onClick={clearPreview} disabled={busy} className="min-h-10 rounded-xl border border-sky-200 bg-white px-4 py-2 text-sm font-black text-brand-700 disabled:opacity-50">取消</button>
            <button type="button" onClick={() => void executeBackfill()} disabled={busy || preview.totalPending === 0} className="min-h-10 rounded-xl bg-brand-950 px-4 py-2 text-sm font-black text-white disabled:opacity-50">{busy ? '处理中…' : '确认执行补发'}</button>
          </div>
        </section>
      ) : null}
    </section>
  )
}
