'use client'

import { useEffect, useMemo, useState } from 'react'
import { adminAuditOperationLabels } from '@/lib/admin-audit'

type AuditLog = {
  id: string
  operationType: string | null
  operationLabel: string
  action: string
  result: string
  reason: string | null
  createdAt: string
  operatorId: string | null
  operatorName: string
  operatorUsername: string | null
  operatorUid: number | null
  targetType: string
  targetId: string | null
  targetTitle: string | null
  targetUserId: string | null
  targetUserName: string | null
  targetUserUid: number | null
}

type Pagination = { page: number; pageSize: number; total: number; totalPages: number }

const operationOptions = Object.entries(adminAuditOperationLabels) as Array<[string, string]>

function formatDate(value: string) {
  return new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value))
}

export function AdminActionLogManager() {
  const [logs, setLogs] = useState<AuditLog[]>([])
  const [pagination, setPagination] = useState<Pagination>({ page: 1, pageSize: 20, total: 0, totalPages: 1 })
  const [admin, setAdmin] = useState('')
  const [operationType, setOperationType] = useState('')
  const [targetType, setTargetType] = useState('')
  const [query, setQuery] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const requestUrl = useMemo(() => {
    const params = new URLSearchParams({ page: String(pagination.page), pageSize: String(pagination.pageSize) })
    if (admin.trim()) params.set('admin', admin.trim())
    if (operationType) params.set('operationType', operationType)
    if (targetType) params.set('targetType', targetType)
    if (query.trim()) params.set('q', query.trim())
    if (from) params.set('from', from)
    if (to) params.set('to', to)
    return `/api/admin/admin-actions?${params.toString()}`
  }, [admin, from, operationType, pagination.page, pagination.pageSize, query, targetType, to])

  useEffect(() => {
    let active = true
    setLoading(true)
    setError('')
    fetch(requestUrl, { cache: 'no-store' })
      .then(async (response) => {
        const data = await response.json().catch(() => null)
        if (!response.ok) throw new Error(data?.message || '操作记录加载失败')
        if (!active) return
        setLogs(Array.isArray(data?.logs) ? data.logs as AuditLog[] : [])
        if (data?.pagination) setPagination(data.pagination as Pagination)
      })
      .catch((reason) => { if (active) setError(reason instanceof Error ? reason.message : '操作记录加载失败') })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [requestUrl])

  function applyFilters(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setPagination((current) => ({ ...current, page: 1 }))
  }

  function resetFilters() {
    setAdmin('')
    setOperationType('')
    setTargetType('')
    setQuery('')
    setFrom('')
    setTo('')
    setPagination((current) => ({ ...current, page: 1 }))
  }

  return (
    <section className="rounded-[28px] border border-sky-100 bg-white/90 p-5 shadow-sm sm:p-7">
      <header>
        <p className="text-xs font-black uppercase tracking-[0.18em] text-sky-700">Admin Audit Log</p>
        <h1 className="mt-2 text-3xl font-black text-brand-950">管理员操作记录</h1>
        <p className="mt-2 text-sm font-bold leading-6 text-slate-500">记录审核、精华、置顶、删除和管理员编辑等内容管理操作。历史记录只读、按最新时间优先。</p>
      </header>

      <form onSubmit={applyFilters} className="mt-6 grid gap-3 rounded-2xl border border-sky-100 bg-sky-50/50 p-4 md:grid-cols-2 xl:grid-cols-4">
        <label className="grid gap-1 text-xs font-black text-slate-600"><span>管理员 / UID</span><input value={admin} onChange={(event) => setAdmin(event.target.value)} placeholder="昵称、用户名或 UID" className="min-h-10 rounded-xl border border-sky-100 bg-white px-3" /></label>
        <label className="grid gap-1 text-xs font-black text-slate-600"><span>操作类型</span><select value={operationType} onChange={(event) => setOperationType(event.target.value)} className="min-h-10 rounded-xl border border-sky-100 bg-white px-3"><option value="">全部操作</option>{operationOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        <label className="grid gap-1 text-xs font-black text-slate-600"><span>对象类型</span><select value={targetType} onChange={(event) => setTargetType(event.target.value)} className="min-h-10 rounded-xl border border-sky-100 bg-white px-3"><option value="">全部对象</option><option value="POST">帖子</option></select></label>
        <label className="grid gap-1 text-xs font-black text-slate-600"><span>目标搜索</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="帖子标题、Post ID、作者 UID" className="min-h-10 rounded-xl border border-sky-100 bg-white px-3" /></label>
        <label className="grid gap-1 text-xs font-black text-slate-600"><span>开始日期</span><input type="date" value={from} onChange={(event) => setFrom(event.target.value)} className="min-h-10 rounded-xl border border-sky-100 bg-white px-3" /></label>
        <label className="grid gap-1 text-xs font-black text-slate-600"><span>结束日期</span><input type="date" value={to} onChange={(event) => setTo(event.target.value)} className="min-h-10 rounded-xl border border-sky-100 bg-white px-3" /></label>
        <div className="flex flex-wrap items-end gap-2 md:col-span-2 xl:justify-end"><button type="submit" className="min-h-10 rounded-xl bg-brand-700 px-4 text-sm font-black text-white">筛选</button><button type="button" onClick={resetFilters} className="min-h-10 rounded-xl border border-sky-200 bg-white px-4 text-sm font-black text-brand-700">重置</button></div>
      </form>

      {error ? <p role="alert" className="mt-4 rounded-xl bg-red-50 px-4 py-3 text-sm font-black text-red-700">{error}</p> : null}
      <div className="mt-6 overflow-x-auto">
        <table className="w-full min-w-[840px] border-collapse text-left text-sm">
          <thead><tr className="border-b border-sky-100 text-xs font-black text-slate-500"><th className="px-3 py-3">操作时间</th><th className="px-3 py-3">管理员</th><th className="px-3 py-3">操作</th><th className="px-3 py-3">目标</th><th className="px-3 py-3">结果 / 备注</th></tr></thead>
          <tbody>
            {logs.map((log) => <tr key={log.id} className="border-b border-sky-50 align-top"><td className="whitespace-nowrap px-3 py-4 text-xs font-bold text-slate-500">{formatDate(log.createdAt)}</td><td className="px-3 py-4"><p className="font-black text-brand-950">{log.operatorName}</p><p className="mt-1 text-xs font-bold text-slate-500">UID {log.operatorUid ?? '—'}{log.operatorUsername ? ` · ${log.operatorUsername}` : ''}</p></td><td className="px-3 py-4 font-black text-brand-700">{log.operationLabel}</td><td className="max-w-xs px-3 py-4"><p className="break-words font-black text-slate-800">{log.targetTitle || '目标已删除或无标题快照'}</p><p className="mt-1 break-all text-xs font-bold text-slate-500">{log.targetType} · {log.targetId || '—'}</p>{log.targetUserUid ? <p className="mt-1 text-xs font-bold text-slate-500">作者：{log.targetUserName || '—'} · UID {log.targetUserUid}</p> : null}</td><td className="max-w-sm px-3 py-4"><p className="font-black text-emerald-700">{log.result === 'SUCCESS' ? '成功' : log.result}</p>{log.reason ? <p className="mt-1 whitespace-pre-wrap break-words text-xs font-bold leading-5 text-slate-600">{log.reason}</p> : null}</td></tr>)}
            {!loading && !logs.length ? <tr><td colSpan={5} className="px-3 py-12 text-center text-sm font-bold text-slate-500">暂无符合条件的操作记录</td></tr> : null}
          </tbody>
        </table>
        {loading ? <p className="py-12 text-center text-sm font-bold text-slate-500">加载中…</p> : null}
      </div>
      <footer className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-sky-100 pt-4 text-sm font-bold text-slate-500"><span>共 {pagination.total} 条 · 第 {pagination.page} / {pagination.totalPages} 页</span><div className="flex gap-2"><button type="button" disabled={pagination.page <= 1 || loading} onClick={() => setPagination((current) => ({ ...current, page: current.page - 1 }))} className="rounded-xl border border-sky-200 px-4 py-2 font-black text-brand-700 disabled:opacity-40">上一页</button><button type="button" disabled={pagination.page >= pagination.totalPages || loading} onClick={() => setPagination((current) => ({ ...current, page: current.page + 1 }))} className="rounded-xl border border-sky-200 px-4 py-2 font-black text-brand-700 disabled:opacity-40">下一页</button></div></footer>
    </section>
  )
}

