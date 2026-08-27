'use client'

import { useEffect, useState } from 'react'

type StatusPayload = {
  provider: string
  target: string
  proxyConfigured: boolean
  proxyType: string | null
  directFallback: boolean
  browserEnabled: boolean
  brightDataConfigured: boolean
  apifyConfigured: boolean
  enabled: boolean
  syncEnabled: boolean
  notificationEnabled: boolean
  storageMode: string | null
  syncState: { lastCheckedAt: string | null; lastSuccessfulSyncAt: string | null; lastChangedAt: string | null; nextAllowedSyncAt: string | null; consecutiveFailures: number; lastErrorCode: string | null; baselineCompletedAt: string | null } | null
  alerts: string[]
}

type SyncLog = { id: string; provider: string; target: string; datasetId: string | null; runId: string | null; startedAt: string; status: string; foundCount: number; createdCount: number; updatedCount: number; mediaCount: number; durationMs: number | null; errorCode: string | null; errorMessage: string | null }
type AdminPost = { id: string; externalId: string; authorUsername: string; publishedAt: string; mediaType: string; status: string; media: { id: string; type: string; sortOrder: number }[]; likeCount: number; commentCount: number; viewerLiked: boolean }

function formatStatusTime(value: string | null | undefined) {
  return value ? new Date(value).toLocaleString('zh-CN') : '—'
}

export function AnywhereDoorAdminClient() {
  const [status, setStatus] = useState<StatusPayload | null>(null)
  const [logs, setLogs] = useState<SyncLog[]>([])
  const [posts, setPosts] = useState<AdminPost[]>([])
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  async function load() {
    const [statusResponse, postsResponse] = await Promise.all([
      fetch('/api/admin/anywhere-door/status', { cache: 'no-store' }),
      fetch('/api/admin/anywhere-door/posts', { cache: 'no-store' }),
    ])
    const statusPayload = await statusResponse.json().catch(() => null)
    const postsPayload = await postsResponse.json().catch(() => null)
    if (!statusResponse.ok) throw new Error(statusPayload?.message || '状态加载失败')
    if (!postsResponse.ok) throw new Error(postsPayload?.message || '动态加载失败')
    setStatus(statusPayload.status)
    setLogs(statusPayload.logs || [])
    setPosts(postsPayload.items || [])
  }

  useEffect(() => { void load().catch((caught) => setError(caught instanceof Error ? caught.message : '加载失败')) }, [])

  async function runSync() {
    setBusy(true)
    setMessage('')
    setError('')
    try {
      const baseline = !status?.syncState?.baselineCompletedAt
      const response = await fetch('/api/admin/anywhere-door/sync', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ baseline }) })
      const payload = await response.json().catch(() => null)
      if (!response.ok) throw new Error(payload?.message || `同步未登记：${payload?.code || response.status}`)
      setMessage(`${baseline ? '基线初始化' : '同步'}请求已登记，将由独立 Worker 执行；当前请求不会占用页面连接。`)
      await load()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '同步失败')
    } finally {
      setBusy(false)
    }
  }

  async function setPostStatus(id: string, nextStatus: 'READY' | 'HIDDEN') {
    const response = await fetch(`/api/admin/anywhere-door/posts/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: nextStatus }) })
    if (!response.ok) {
      const payload = await response.json().catch(() => null)
      setError(payload?.message || '状态更新失败')
      return
    }
    await load()
  }

  return (
    <div className="space-y-5">
      {message ? <p className="rounded-2xl bg-emerald-50 px-4 py-3 text-sm font-bold text-emerald-700" role="status">{message}</p> : null}
      {error ? <p className="rounded-2xl bg-red-50 px-4 py-3 text-sm font-bold text-red-700" role="alert">{error}</p> : null}
      <section className="rounded-[28px] border border-sky-100 bg-white/90 p-5 shadow-sm sm:p-7">
        <div className="flex flex-wrap items-start justify-between gap-4"><div><p className="text-xs font-black uppercase tracking-[0.18em] text-brand-700">Provider 状态</p><h2 className="mt-2 text-2xl font-black text-brand-950">同步控制台</h2></div><button type="button" disabled={busy} onClick={() => void runSync()} className="min-h-11 rounded-full bg-brand-950 px-5 text-sm font-black text-white disabled:opacity-50">{busy ? '登记中…' : status?.syncState?.baselineCompletedAt ? '请求一次同步' : '初始化随意门'}</button></div>
        {status ? <dl className="mt-5 grid gap-3 text-sm sm:grid-cols-2"><div className="rounded-2xl bg-sky-50/70 p-3"><dt className="font-bold text-slate-500">当前 Provider</dt><dd className="mt-1 font-black text-brand-950">{status.provider}</dd></div><div className="rounded-2xl bg-sky-50/70 p-3"><dt className="font-bold text-slate-500">目标账号</dt><dd className="mt-1 font-black text-brand-950">{status.target}</dd></div><div className="rounded-2xl bg-sky-50/70 p-3"><dt className="font-bold text-slate-500">功能 / 同步 / 通知</dt><dd className="mt-1 font-black text-brand-950">{status.enabled ? '开' : '关'} / {status.syncEnabled ? '开' : '关'} / {status.notificationEnabled ? '开' : '关'}</dd></div><div className="rounded-2xl bg-sky-50/70 p-3"><dt className="font-bold text-slate-500">存储模式</dt><dd className="mt-1 font-black text-brand-950">{status.storageMode || 'CONFIG_ERROR'}</dd></div><div className="rounded-2xl bg-amber-50 p-3"><dt className="font-bold text-amber-700">生产安全边界</dt><dd className="mt-1 font-black text-amber-900">DIRECT fallback: {status.directFallback ? '启用（需修正）' : '关闭'} · Browser: {status.browserEnabled ? 'enabled' : 'disabled'}</dd></div><div className="rounded-2xl bg-slate-50 p-3"><dt className="font-bold text-slate-500">最近检查</dt><dd className="mt-1 font-black text-brand-950">{formatStatusTime(status.syncState?.lastCheckedAt)}</dd></div><div className="rounded-2xl bg-slate-50 p-3"><dt className="font-bold text-slate-500">最近成功</dt><dd className="mt-1 font-black text-brand-950">{formatStatusTime(status.syncState?.lastSuccessfulSyncAt)}</dd></div><div className="rounded-2xl bg-slate-50 p-3"><dt className="font-bold text-slate-500">最近变更</dt><dd className="mt-1 font-black text-brand-950">{formatStatusTime(status.syncState?.lastChangedAt)}</dd></div><div className="rounded-2xl bg-slate-50 p-3"><dt className="font-bold text-slate-500">下次允许</dt><dd className="mt-1 font-black text-brand-950">{formatStatusTime(status.syncState?.nextAllowedSyncAt)}</dd></div><div className="rounded-2xl bg-slate-50 p-3"><dt className="font-bold text-slate-500">失败 / 最后错误</dt><dd className="mt-1 font-black text-brand-950">{status.syncState?.consecutiveFailures ?? 0} 次 · {status.syncState?.lastErrorCode || '—'}</dd></div><div className="rounded-2xl bg-slate-50 p-3"><dt className="font-bold text-slate-500">Baseline</dt><dd className="mt-1 font-black text-brand-950">{status.syncState?.baselineCompletedAt ? `已初始化 · ${formatStatusTime(status.syncState.baselineCompletedAt)}` : '未初始化'}</dd></div></dl> : <p className="mt-5 text-sm font-bold text-slate-400">状态加载中…</p>}
        {status?.alerts?.length ? <div className="mt-4 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm font-black text-red-700"><p>需要管理员处理：</p><ul className="mt-2 list-disc pl-5">{status.alerts.map((alert) => <li key={alert}>{alert}</li>)}</ul></div> : null}
        <p className="mt-4 text-xs font-bold leading-5 text-slate-400">按钮只登记同步请求；Provider Run 由独立 Worker 在开关、锁、冷却和额度检查通过后执行。</p>
      </section>
      <section className="rounded-[28px] border border-sky-100 bg-white/90 p-5 shadow-sm sm:p-7"><h2 className="text-xl font-black text-brand-950">已同步动态</h2><div className="mt-4 overflow-x-auto"><table className="w-full min-w-[680px] text-left text-sm"><thead className="border-b border-sky-100 text-xs font-black text-slate-500"><tr><th className="px-3 py-3">发布时间</th><th className="px-3 py-3">类型</th><th className="px-3 py-3">媒体</th><th className="px-3 py-3">互动</th><th className="px-3 py-3">状态</th><th className="px-3 py-3">操作</th></tr></thead><tbody>{posts.map((post) => <tr key={post.id} className="border-b border-sky-50"><td className="px-3 py-3 font-bold">{new Date(post.publishedAt).toLocaleString('zh-CN')}</td><td className="px-3 py-3 font-black">{post.mediaType}</td><td className="px-3 py-3">{post.media.length}</td><td className="px-3 py-3">♥ {post.likeCount} · 评论 {post.commentCount}</td><td className="px-3 py-3 font-black">{post.status}</td><td className="px-3 py-3">{post.status === 'HIDDEN' ? <button type="button" onClick={() => void setPostStatus(post.id, 'READY')} className="text-xs font-black text-emerald-700 hover:underline">恢复</button> : <button type="button" onClick={() => void setPostStatus(post.id, 'HIDDEN')} className="text-xs font-black text-red-600 hover:underline">隐藏</button>}</td></tr>)}</tbody></table>{!posts.length ? <p className="py-8 text-center text-sm font-bold text-slate-400">暂无动态；请先登记同步请求。</p> : null}</div></section>
      <section className="rounded-[28px] border border-sky-100 bg-white/90 p-5 shadow-sm sm:p-7"><h2 className="text-xl font-black text-brand-950">最近同步日志</h2><div className="mt-4 space-y-2">{logs.map((log) => <div key={log.id} className="grid gap-1 rounded-2xl bg-slate-50 p-3 text-xs sm:grid-cols-[1fr_auto_auto] sm:items-center"><div><span className="font-black text-brand-950">{log.status}</span><span className="ml-2 font-bold text-slate-500">{log.provider} · {log.target}</span></div><span className="font-bold text-slate-500">发现 {log.foundCount} · 新增 {log.createdCount} · 媒体 {log.mediaCount}</span><time className="font-bold text-slate-400">{new Date(log.startedAt).toLocaleString('zh-CN')}</time>{log.datasetId ? <p className="text-slate-500">Dataset {log.datasetId}{log.runId ? ` · Run ${log.runId}` : ''}</p> : null}{log.errorCode ? <p className="text-red-600">{log.errorCode}：{log.errorMessage || '无详细信息'}</p> : null}</div>)}{!logs.length ? <p className="py-5 text-sm font-bold text-slate-400">暂无同步记录。</p> : null}</div></section>
    </div>
  )
}
