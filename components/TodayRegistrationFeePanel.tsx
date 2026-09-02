'use client'

import Link from 'next/link'
import { useCallback, useEffect, useId, useMemo, useState } from 'react'

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

export function TodayRegistrationFeePanel() {
  const [summary, setSummary] = useState<TodayRegistrationFeeSummary | null>(null)
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const [showAll, setShowAll] = useState(false)
  const recordsId = useId()

  const loadSummary = useCallback(async () => {
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
  }, [])

  useEffect(() => {
    void loadSummary()
  }, [loadSummary])

  useEffect(() => {
    const refresh = () => void loadSummary()
    const refreshFromRealtime = (event: Event) => {
      const detail = (event as CustomEvent<{ changed?: string[]; type?: string }>).detail
      if (detail?.type === 'notification-changed' || detail?.changed?.includes('notification')) refresh()
    }
    window.addEventListener('checkin:completed', refresh)
    window.addEventListener('user:points-updated', refresh)
    window.addEventListener('realtime:event', refreshFromRealtime)
    return () => {
      window.removeEventListener('checkin:completed', refresh)
      window.removeEventListener('user:points-updated', refresh)
      window.removeEventListener('realtime:event', refreshFromRealtime)
    }
  }, [loadSummary])

  const visibleSummary = useMemo(
    () => summary,
    [summary],
  )
  const visibleRecords = useMemo(() => {
    if (!visibleSummary) return []
    return showAll ? visibleSummary.records : visibleSummary.records.slice(0, 10)
  }, [showAll, visibleSummary])

  return (
    <section className="mt-4 rounded-sm border border-[var(--border)] bg-[var(--surface)] p-3.5 sm:p-4" aria-labelledby="today-registration-fee-title">
      <div className="flex items-center gap-2">
        <button
          type="button"
          className="flex min-w-0 flex-1 items-center justify-between gap-3 border-0 bg-transparent p-0 text-left text-[var(--foreground)]"
          aria-expanded={expanded}
          aria-controls={recordsId}
          onClick={() => setExpanded((value) => !value)}
        >
          <span id="today-registration-fee-title" role="heading" aria-level={2} className="text-lg font-black">医保余额</span>
          <svg aria-hidden="true" viewBox="0 0 20 20" className={`h-4 w-4 flex-none text-[var(--foreground-muted)] transition-transform motion-reduce:transition-none ${expanded ? 'rotate-180' : ''}`}>
            <path d="m5 7 5 5 5-5" fill="none" stroke="currentColor" strokeLinecap="square" strokeLinejoin="miter" strokeWidth="1.7" />
          </svg>
        </button>
        {failed ? (
          <button type="button" onClick={() => void loadSummary()} className="flex-none border border-[var(--border)] px-2.5 py-1.5 text-[11px] font-black text-[var(--primary)]">
            重试
          </button>
        ) : null}
        <Link href="/registration-fee" className="flex-none border border-[var(--border)] px-2.5 py-1.5 text-[11px] font-black text-[var(--primary)]">全部记录</Link>
      </div>

      {loading ? (
        <div className="mt-3 grid grid-cols-2 gap-2.5" aria-live="polite" aria-busy="true">
          <div className="h-14 animate-pulse rounded-sm bg-[var(--surface-subtle)]" />
          <div className="h-14 animate-pulse rounded-sm bg-[var(--surface-subtle)]" />
        </div>
      ) : failed ? (
        <p className="mt-3 border border-[var(--border)] bg-[var(--surface-subtle)] px-3 py-2.5 text-xs font-bold text-[var(--danger)]" role="alert">获取记录失败</p>
      ) : visibleSummary ? (
        <>
          <div className="mt-3 grid grid-cols-2 gap-2.5">
            <div className="min-w-0 rounded-sm border border-[var(--border)] bg-[var(--surface-subtle)] px-3 py-2.5">
              <p className="text-[11px] font-black text-[var(--foreground-muted)]">当前余额</p>
              <p className="mt-1 truncate text-2xl font-black leading-none text-[var(--foreground)]">{visibleSummary.currentBalance}</p>
            </div>
            <div className="min-w-0 rounded-sm border border-[var(--border)] bg-[var(--surface-subtle)] px-3 py-2.5">
              <p className="text-[11px] font-black text-[var(--foreground-muted)]">今日共获取</p>
              <p className="mt-1 truncate text-2xl font-black leading-none text-[var(--foreground)]">{visibleSummary.todayEarned}</p>
            </div>
          </div>

          {expanded ? <div id={recordsId} className="mt-3">
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-sm font-black text-[var(--foreground)]">今日获取记录</h3>
              {visibleSummary.records.length > 10 ? (
                <button type="button" onClick={() => setShowAll((value) => !value)} className="text-[11px] font-black text-[var(--primary)]">
                  {showAll ? '收起记录' : '查看全部今日记录'}
                </button>
              ) : null}
            </div>

            {visibleRecords.length ? (
              <div className="mt-2 divide-y divide-[var(--border)] border-y border-[var(--border)]">
                {visibleRecords.map((record) => (
                  <div key={record.id} className="flex min-w-0 items-center justify-between gap-3 py-2.5">
                    <div className="min-w-0">
                      <p className="truncate text-xs font-black text-[var(--foreground)]">{record.sourceLabel}</p>
                      {record.description ? <p className="mt-0.5 truncate text-[10px] font-bold text-[var(--foreground-muted)]">{record.description}</p> : null}
                    </div>
                    <div className="flex flex-none items-end gap-3 text-right">
                      <span className="text-sm font-black text-[var(--success)]">+{record.amount} 挂号费</span>
                      <time dateTime={record.createdAt} className="text-[11px] font-bold text-[var(--foreground-muted)]">{record.displayTime}</time>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="mt-2 border border-dashed border-[var(--border)] px-3 py-4 text-center text-xs font-bold text-[var(--foreground-muted)]">今天还没有挂号费收入</p>
            )}
          </div> : null}
        </>
      ) : null}
    </section>
  )
}
