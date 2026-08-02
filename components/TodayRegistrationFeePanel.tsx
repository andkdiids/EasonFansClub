'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'

type TodayRegistrationFeeRecord = {
  id: string
  amount: number
  sourceType: string
  sourceLabel: string
  description: string | null
  relatedId: string | null
  createdAt: string
  displayTime: string
}

type TodayRegistrationFeeSummary = {
  currentBalance: number
  todayEarned: number
  dateKey: string
  records: TodayRegistrationFeeRecord[]
}

type TodayRegistrationFeePanelProps = {
  initialBalance: number
  previewMode?: boolean
}

function isSummary(value: unknown): value is TodayRegistrationFeeSummary {
  if (!value || typeof value !== 'object') return false
  const item = value as Partial<TodayRegistrationFeeSummary>
  return (
    Number.isSafeInteger(item.currentBalance) &&
    Number.isSafeInteger(item.todayEarned) &&
    typeof item.dateKey === 'string' &&
    Array.isArray(item.records)
  )
}

export function TodayRegistrationFeePanel({ initialBalance, previewMode = false }: TodayRegistrationFeePanelProps) {
  const [summary, setSummary] = useState<TodayRegistrationFeeSummary | null>(null)
  const [loading, setLoading] = useState(!previewMode)
  const [failed, setFailed] = useState(false)
  const [showAll, setShowAll] = useState(false)

  const loadSummary = useCallback(async () => {
    if (previewMode) return
    setLoading(true)
    setFailed(false)
    setSummary(null)
    try {
      const response = await fetch('/api/points/today', { cache: 'no-store', headers: { Accept: 'application/json' } })
      const payload = await response.json().catch(() => null) as { ok?: boolean; data?: unknown }
      if (!response.ok || !payload?.ok || !isSummary(payload.data)) throw new Error('TODAY_REGISTRATION_FEE_LOAD_FAILED')
      setSummary(payload.data)
    } catch {
      setSummary(null)
      setFailed(true)
    } finally {
      setLoading(false)
    }
  }, [previewMode])

  useEffect(() => {
    if (!previewMode) void loadSummary()
  }, [loadSummary, previewMode])

  useEffect(() => {
    if (previewMode) return
    const refresh = () => void loadSummary()
    window.addEventListener('checkin:completed', refresh)
    window.addEventListener('user:points-updated', refresh)
    return () => {
      window.removeEventListener('checkin:completed', refresh)
      window.removeEventListener('user:points-updated', refresh)
    }
  }, [loadSummary, previewMode])

  const visibleSummary = useMemo(
    () => (previewMode ? { currentBalance: initialBalance, todayEarned: 0, dateKey: '', records: [] } : summary),
    [initialBalance, previewMode, summary],
  )
  const visibleRecords = useMemo(() => {
    if (!visibleSummary) return []
    return showAll ? visibleSummary.records : visibleSummary.records.slice(0, 10)
  }, [showAll, visibleSummary])

  return (
    <section className="mt-4 rounded-sm border border-sky-100 bg-white/85 p-3.5 sm:p-4" aria-labelledby="today-registration-fee-title">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-[11px] font-black uppercase tracking-[0.14em] text-brand-700">收入流水</p>
          <h2 id="today-registration-fee-title" className="mt-1 text-lg font-black text-brand-950">今日挂号费</h2>
        </div>
        {!previewMode && failed ? (
          <button type="button" onClick={() => void loadSummary()} className="border border-sky-200 px-2.5 py-1.5 text-[11px] font-black text-brand-700">
            重试
          </button>
        ) : null}
      </div>

      {loading ? (
        <div className="mt-3 grid gap-2 sm:grid-cols-2" aria-live="polite" aria-busy="true">
          <div className="h-16 animate-pulse rounded-sm bg-slate-100" />
          <div className="h-16 animate-pulse rounded-sm bg-slate-100" />
          <div className="h-12 animate-pulse rounded-sm bg-slate-100 sm:col-span-2" />
        </div>
      ) : failed ? (
        <p className="mt-3 border border-red-200 bg-red-50 px-3 py-2.5 text-xs font-bold text-red-700" role="alert">获取记录失败</p>
      ) : visibleSummary ? (
        <>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            <div className="rounded-sm border border-sky-100 bg-sky-50/75 p-3">
              <p className="text-[11px] font-black text-slate-500">当前余额</p>
              <p className="mt-1 text-2xl font-black leading-none text-brand-950">{visibleSummary.currentBalance}</p>
              <p className="mt-1 text-[11px] font-bold text-slate-500">挂号费</p>
            </div>
            <div className="rounded-sm border border-sky-100 bg-sky-50/75 p-3">
              <p className="text-[11px] font-black text-slate-500">今日共获取</p>
              <p className="mt-1 text-2xl font-black leading-none text-brand-950">{visibleSummary.todayEarned}</p>
              <p className="mt-1 text-[11px] font-bold text-slate-500">挂号费</p>
            </div>
          </div>

          <div className="mt-4">
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-sm font-black text-brand-950">今日获取记录</h3>
              {visibleSummary.records.length > 10 ? (
                <button type="button" onClick={() => setShowAll((value) => !value)} className="text-[11px] font-black text-brand-700">
                  {showAll ? '收起记录' : '查看全部今日记录'}
                </button>
              ) : null}
            </div>

            {visibleRecords.length ? (
              <div className="mt-2 divide-y divide-sky-100 border-y border-sky-100">
                {visibleRecords.map((record) => (
                  <div key={record.id} className="flex min-w-0 items-center justify-between gap-3 py-2.5">
                    <div className="min-w-0">
                      <p className="truncate text-xs font-black text-brand-950">{record.sourceLabel}</p>
                      {record.description ? <p className="mt-0.5 truncate text-[10px] font-bold text-slate-500">{record.description}</p> : null}
                    </div>
                    <div className="flex flex-none items-end gap-3 text-right">
                      <span className="text-sm font-black text-emerald-600">+{record.amount} 挂号费</span>
                      <time dateTime={record.createdAt} className="text-[11px] font-bold text-slate-500">{record.displayTime}</time>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="mt-2 border border-dashed border-sky-200 px-3 py-4 text-center text-xs font-bold text-slate-500">今天还没有挂号费收入</p>
            )}
          </div>
        </>
      ) : null}
    </section>
  )
}
