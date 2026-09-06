'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { getCheckInTypeMeta } from '@/lib/checkin-type-meta'
import { publicImageVariantUrl } from '@/lib/image-variants'

type RecordsTypeFilter = 'ALL' | 'FREE_QUIZ' | 'PAID' | 'ADMIN'

type RecordRow = {
  checkInId: string
  dateKey: string
  type: string | null
  madeUpAt: string | null
  makeupCost: number | null
  createdAt: string
  targetUser: { id: string; uid: number; nickname: string; avatarUrl: string | null }
  operator: { uid: number | null; nickname: string; reason: string | null } | null
  challenge: { id: string; status: string; targetDateKey: string } | null
}

type RecordsResponse = {
  records: RecordRow[]
  total: number
  page: number
  pageSize: number
  totalPages: number
}

const TYPE_OPTIONS: Array<{ value: RecordsTypeFilter; label: string }> = [
  { value: 'ALL', label: '全部补签' },
  { value: 'FREE_QUIZ', label: '免费答题补签' },
  { value: 'PAID', label: '付费补签' },
  { value: 'ADMIN', label: '管理员补签' },
]

function formatDateKey(dateKey: string) {
  const [year, month, day] = dateKey.split('-').map(Number)
  return `${year}年${month}月${day}日`
}

function formatDateTime(value: string | null) {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return date.toLocaleString('zh-CN', { hour12: false })
}

export function AdminCheckInMakeupRecords() {
  const [query, setQuery] = useState('')
  const [typeFilter, setTypeFilter] = useState<RecordsTypeFilter>('ALL')
  const [targetDate, setTargetDate] = useState('')
  const [page, setPage] = useState(1)
  const [data, setData] = useState<RecordsResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const filtersRef = useRef({ query, typeFilter, targetDate })
  useEffect(() => {
    filtersRef.current = { query, typeFilter, targetDate }
  }, [query, typeFilter, targetDate])

  const fetchPage = useCallback(async (nextPage: number, signal?: AbortSignal) => {
    const { query: keyword, typeFilter: type, targetDate: date } = filtersRef.current
    setLoading(true)
    setError('')
    try {
      const params = new URLSearchParams({ page: String(nextPage), type })
      if (keyword.trim()) params.set('q', keyword.trim())
      if (date.trim()) params.set('targetDateKey', date.trim())
      const response = await fetch(`/api/admin/checkin-makeup/records?${params.toString()}`, { cache: 'no-store', signal })
      const body = await response.json() as RecordsResponse & { message?: string }
      if (!response.ok) throw new Error(body.message || '加载补签记录失败')
      setData(body)
      setPage(body.page)
    } catch (errorValue) {
      if (!signal?.aborted) setError(errorValue instanceof Error ? errorValue.message : '加载补签记录失败')
    } finally {
      if (!signal?.aborted) setLoading(false)
    }
  }, [])

  // 类型筛选 / 被补签日期变化立即回到第一页；关键词由「查询」按钮触发。
  useEffect(() => {
    const controller = new AbortController()
    void fetchPage(1, controller.signal)
    return () => controller.abort()
  }, [fetchPage, targetDate, typeFilter])

  const rows = data?.records || []
  const total = data?.total || 0
  const totalPages = data?.totalPages || 1

  return (
    <section className="border border-sky-100 bg-white p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-xl font-black text-brand-950">补签记录</h2>
        <p className="text-sm font-bold text-slate-500">共 {total} 条补签记录</p>
      </div>
      <p className="mt-1 text-xs font-bold leading-6 text-slate-500">补签记录均来自挂号记录本身（CheckIn.type），可区分免费答题 / 付费 / 管理员补签；管理员执行人取自管理操作日志。</p>

      <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <input className="min-h-11 border border-slate-300 px-3" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="用户昵称 / UID 搜索" />
        <select className="min-h-11 border border-slate-300 px-3" value={typeFilter} onChange={(event) => { setTypeFilter(event.target.value as RecordsTypeFilter); setPage(1) }}>
          {TYPE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select>
        <label className="flex min-h-11 items-center gap-2 border border-slate-300 px-3">
          <span className="shrink-0 text-xs font-black text-slate-500">被补签日期</span>
          <input type="date" className="min-w-0 flex-1 bg-transparent outline-none" value={targetDate} onChange={(event) => setTargetDate(event.target.value)} />
        </label>
        <button type="button" className="min-h-11 bg-brand-950 px-5 font-black text-white disabled:opacity-50" disabled={loading} onClick={() => void fetchPage(1)}>查询</button>
      </div>

      {error ? <p role="alert" className="mt-3 border border-amber-200 bg-amber-50 p-3 text-sm font-black text-amber-800">{error}</p> : null}
      {loading && !data ? <p className="mt-4 border border-sky-100 bg-sky-50 p-4 text-sm font-bold text-slate-600">正在加载补签记录…</p> : null}

      {data && !rows.length ? <p className="mt-4 border border-dashed border-slate-200 p-6 text-center font-bold text-slate-500">没有符合条件的补签记录。</p> : null}

      {rows.length ? (
        <>
          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[760px] text-left text-sm">
              <thead className="border-b border-sky-100 text-xs font-black text-slate-500">
                <tr>
                  <th className="p-3">用户</th>
                  <th className="p-3">被补签日期</th>
                  <th className="p-3">补签方式</th>
                  <th className="p-3">实际补签时间</th>
                  <th className="p-3">补签花费</th>
                  <th className="p-3">操作人</th>
                  <th className="p-3">免费挑战</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const meta = getCheckInTypeMeta(row.type)
                  const avatar = row.targetUser.avatarUrl ? publicImageVariantUrl(row.targetUser.avatarUrl, 'avatar-sm') || row.targetUser.avatarUrl : null
                  return (
                    <tr key={row.checkInId} className="border-b border-sky-50 align-top last:border-0">
                      <td className="p-3">
                        <div className="flex items-center gap-2">
                          <span className="grid size-8 shrink-0 place-items-center overflow-hidden rounded-full bg-brand-950 text-xs font-black text-white">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            {avatar ? <img src={avatar} alt="" className="size-full object-cover" loading="lazy" /> : (row.targetUser.nickname || 'E').slice(0, 1)}
                          </span>
                          <span className="min-w-0">
                            <span className="block truncate font-black text-brand-950">{row.targetUser.nickname}</span>
                            <span className="block text-xs font-bold text-slate-500">UID {String(row.targetUser.uid).padStart(5, '0')}</span>
                          </span>
                        </div>
                      </td>
                      <td className="whitespace-nowrap p-3 font-bold text-slate-700">{formatDateKey(row.dateKey)}</td>
                      <td className="whitespace-nowrap p-3 font-black text-brand-700">{meta.adminLabel}</td>
                      <td className="whitespace-nowrap p-3 text-slate-600">{formatDateTime(row.madeUpAt || row.createdAt)}</td>
                      <td className="whitespace-nowrap p-3 font-bold text-slate-700">{row.type === 'MAKEUP_PAID' ? `${row.makeupCost ?? 0} 挂号费` : '0 挂号费'}</td>
                      <td className="min-w-[140px] p-3 text-slate-600">
                        {row.operator ? (
                          <span className="block font-bold text-slate-700">{row.operator.nickname}{row.operator.uid !== null ? <span className="ml-1 text-xs font-bold text-slate-500">UID {String(row.operator.uid).padStart(5, '0')}</span> : null}</span>
                        ) : <span className="font-bold text-slate-500">用户自助</span>}
                        {row.operator?.reason ? <span className="mt-0.5 block max-w-[220px] truncate text-xs text-slate-500" title={row.operator.reason}>原因：{row.operator.reason}</span> : null}
                      </td>
                      <td className="whitespace-nowrap p-3 text-slate-600">{row.type === 'MAKEUP_FREE_QUIZ' && row.challenge ? (row.challenge.status === 'CORRECT' ? '答题正确' : row.challenge.status === 'WRONG' ? '答题错误' : '待作答') : '—'}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          {totalPages > 1 ? (
            <div className="mt-4 flex flex-wrap items-center justify-between gap-2 text-sm font-bold text-slate-600">
              <span>第 {data?.page ?? page} / {totalPages} 页</span>
              <div className="flex gap-2">
                <button type="button" className="min-h-9 bg-sky-50 px-4 font-black text-brand-700 disabled:opacity-40" disabled={loading || page <= 1} onClick={() => void fetchPage(Math.max(1, page - 1))}>上一页</button>
                <button type="button" className="min-h-9 bg-sky-50 px-4 font-black text-brand-700 disabled:opacity-40" disabled={loading || page >= totalPages} onClick={() => void fetchPage(Math.min(totalPages, page + 1))}>下一页</button>
              </div>
            </div>
          ) : null}
        </>
      ) : null}
    </section>
  )
}
