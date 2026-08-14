'use client'

import Link from 'next/link'
import { useState } from 'react'
import { Pagination } from '@/components/ui/Pagination'
import { REGISTRATION_FEE_HISTORY_PAGE_SIZE } from '@/lib/registration-fee-constants'

type RegistrationFeeRecord = {
  id: string
  amount: number
  sourceType: string
  sourceLabel: string
  description: string | null
  relatedId: string | null
  createdAt: string
  displayTime: string
}

type RegistrationFeeHistory = {
  currentBalance: number
  records: RegistrationFeeRecord[]
  page: number
  pageSize: number
  total: number
  totalPages: number
}

function formatTime(value: string) {
  return new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium', timeStyle: 'short', hour12: false }).format(new Date(value))
}

export function RegistrationFeeHistoryClient({ initialData }: { initialData: RegistrationFeeHistory }) {
  const [data, setData] = useState(initialData)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function loadPage(page: number) {
    if (loading) return
    setLoading(true)
    setError('')
    try {
      const response = await fetch(`/api/points/history?page=${page}&pageSize=${REGISTRATION_FEE_HISTORY_PAGE_SIZE}`, { cache: 'no-store' })
      const payload = await response.json().catch(() => null) as { ok?: boolean; data?: RegistrationFeeHistory; message?: string } | null
      if (!response.ok || !payload?.ok || !payload.data) throw new Error(payload?.message || '挂号费记录加载失败')
      setData(payload.data)
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : '挂号费记录加载失败')
    } finally {
      setLoading(false)
    }
  }

  return (
    <section className="rounded-sm border border-[var(--border)] bg-[var(--surface)] p-4 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-[var(--border)] pb-4">
        <div>
          <p className="text-xs font-black tracking-[0.16em] text-[var(--primary)]">REGISTRATION FEE LEDGER</p>
          <h1 className="mt-2 text-2xl font-black text-[var(--foreground)] sm:text-3xl">挂号费记录</h1>
          <p className="mt-2 text-sm font-bold text-[var(--foreground-muted)]">这里沿用现有挂号费流水，奖励说明会原样保留。</p>
        </div>
        <div className="rounded-sm border border-[var(--border)] bg-[var(--surface-subtle)] px-4 py-3 text-right">
          <p className="text-[11px] font-black text-[var(--foreground-muted)]">当前余额</p>
          <p className="mt-1 text-2xl font-black text-[var(--foreground)]">{data.currentBalance}</p>
        </div>
      </div>

      {error ? <p className="mt-4 border border-[var(--danger)]/30 bg-[var(--surface-subtle)] px-3 py-2 text-sm font-bold text-[var(--danger)]" role="alert">{error}</p> : null}
      {data.records.length ? (
        <div className="mt-4 divide-y divide-[var(--border)] border-y border-[var(--border)]">
          {data.records.map((record) => (
            <div key={record.id} className="flex min-w-0 flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
              <div className="min-w-0">
                <p className="text-sm font-black text-[var(--foreground)]">{record.sourceLabel}</p>
                {record.description ? <p className="mt-1 whitespace-pre-wrap break-words text-xs font-bold text-[var(--foreground-muted)]">{record.description}</p> : null}
                <time dateTime={record.createdAt} className="mt-1 block text-[11px] font-bold text-[var(--foreground-muted)]">{formatTime(record.createdAt)}</time>
              </div>
              <span className={`shrink-0 text-base font-black ${record.amount >= 0 ? 'text-[var(--success)]' : 'text-[var(--danger)]'}`}>{record.amount >= 0 ? '+' : ''}{record.amount}</span>
            </div>
          ))}
        </div>
      ) : <p className="mt-4 border border-dashed border-[var(--border)] px-4 py-8 text-center text-sm font-bold text-[var(--foreground-muted)]">暂无挂号费记录。</p>}

      {data.total > data.pageSize ? <Pagination currentPage={data.page} totalPages={data.totalPages} onPageChange={(page) => void loadPage(page)} disabled={loading} ariaLabel="挂号费记录分页" className="mt-5" /> : null}
      <Link href="/checkin" className="mt-5 inline-flex min-h-10 items-center border border-[var(--border)] px-4 text-sm font-black text-[var(--primary)]">返回每日挂号</Link>
    </section>
  )
}
