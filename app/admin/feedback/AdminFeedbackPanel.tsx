'use client'

import Link from 'next/link'
import { useEffect, useState, type FormEvent } from 'react'

type FeedbackItem = {
  id: string
  title: string
  type: string
  typeLabel: string
  status: string
  statusLabel: string
  adminUnread: boolean
  userUnread: boolean
  content?: string
  contact?: string | null
  createdAt: string
  updatedAt: string
  lastReplyAt?: string | null
  user: { uid: number; nickname: string; avatarUrl?: string | null }
  attachments?: Array<{ id?: string; url: string }>
  replies?: Array<{
    id: string
    content: string
    authorRole: string
    createdAt: string
    author: { uid: number; nickname: string; avatarUrl?: string | null }
    attachments: Array<{ id?: string; url: string }>
  }>
}

const statusOptions = [
  ['OPEN', '未处理'],
  ['PROCESSING', '处理中'],
  ['REPLIED', '已回复'],
  ['RESOLVED', '已完成'],
]

const typeOptions = [
  ['BUG', '问题反馈'],
  ['FEATURE', '功能建议'],
  ['EXPERIENCE', '体验建议'],
  ['ACCOUNT', '账号问题'],
  ['OTHER', '其他'],
]

function formatTime(value?: string | null) {
  if (!value) return '暂无'
  return new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value))
}

export function AdminFeedbackPanel({ initialFeedbackId }: { initialFeedbackId?: string }) {
  const [items, setItems] = useState<FeedbackItem[]>([])
  const [selectedId, setSelectedId] = useState(initialFeedbackId || '')
  const [detail, setDetail] = useState<FeedbackItem | null>(null)
  const [status, setStatus] = useState('')
  const [type, setType] = useState('')
  const [q, setQ] = useState('')
  const [reply, setReply] = useState('')
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [replying, setReplying] = useState(false)
  const [page, setPage] = useState(1)
  const [hasMore, setHasMore] = useState(false)
  const [total, setTotal] = useState(0)

  useEffect(() => {
    loadList()
  }, [page])

  useEffect(() => {
    if (selectedId) loadDetail(selectedId)
  }, [selectedId])

  async function requestJson(url: string, init?: RequestInit) {
    const response = await fetch(url, init)
    const data = await response.json().catch(() => null)
    if (!response.ok) throw new Error(data?.message || '操作失败')
    return data
  }

  async function loadList(nextPage = page) {
    setLoading(true)
    setError('')
    const params = new URLSearchParams()
    if (status) params.set('status', status)
    if (type) params.set('type', type)
    if (q) params.set('q', q)
    params.set('page', String(nextPage))
    params.set('pageSize', '20')
    try {
      const data = await requestJson(`/api/admin/feedback?${params.toString()}`)
      setItems(data.feedbacks || [])
      setHasMore(Boolean(data.hasMore))
      setTotal(Number(data.total || 0))
      if (!selectedId && data.feedbacks?.[0]) setSelectedId(data.feedbacks[0].id)
    } catch (err) {
      setError(err instanceof Error ? err.message : '反馈列表加载失败')
    } finally {
      setLoading(false)
    }
  }

  async function loadDetail(id: string) {
    try {
      const data = await requestJson(`/api/admin/feedback/${id}`)
      setDetail(data.feedback)
      setItems((current) => current.map((item) => (item.id === id ? { ...item, ...data.feedback } : item)))
    } catch (err) {
      setError(err instanceof Error ? err.message : '反馈详情加载失败')
    }
  }

  async function submitReply(event: FormEvent) {
    event.preventDefault()
    if (!detail || replying) return
    setReplying(true)
    setError('')
    setMessage('')
    try {
      const data = await requestJson(`/api/admin/feedback/${detail.id}/replies`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: reply }),
      })
      setDetail(data.feedback)
      setItems((current) => current.map((item) => (item.id === detail.id ? { ...item, ...data.feedback } : item)))
      setReply('')
      setMessage('回复已发送，用户会收到站内通知')
    } catch (err) {
      setError(err instanceof Error ? err.message : '回复失败')
    } finally {
      setReplying(false)
    }
  }

  async function updateStatus(nextStatus: string) {
    if (!detail) return
    const data = await requestJson(`/api/admin/feedback/${detail.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: nextStatus }),
    })
    setDetail(data.feedback)
    setItems((current) => current.map((item) => (item.id === detail.id ? { ...item, ...data.feedback } : item)))
    setMessage('状态已更新')
  }

  function applyFilters() {
    setPage(1)
    loadList(1)
  }

  return (
    <main className="mx-auto max-w-7xl space-y-5 px-4 py-6 sm:px-5 sm:py-8">
      <section className="rounded-[28px] border border-sky-100 bg-white/85 p-6 shadow-sm">
        <p className="text-sm font-black uppercase tracking-[0.18em] text-brand-700">Feedback Admin</p>
        <h1 className="mt-2 text-3xl font-black text-brand-950">反馈中心</h1>
      </section>

      {message ? <p className="rounded-2xl bg-emerald-50 px-4 py-2 text-sm font-black text-emerald-700">{message}</p> : null}
      {error ? <p className="rounded-2xl bg-red-50 px-4 py-2 text-sm font-black text-red-600">{error}</p> : null}

      <section className="grid gap-5 md:grid-cols-[380px_1fr]">
        <aside className="rounded-[24px] border border-sky-100 bg-white/88 p-4 shadow-sm">
          <div className="grid gap-2 sm:grid-cols-2 md:grid-cols-1">
            <input value={q} onChange={(e) => setQ(e.target.value)} className="rounded-2xl border border-sky-100 px-4 py-2 text-sm font-bold outline-none" placeholder="搜索标题、昵称、UID" />
            <select value={status} onChange={(e) => setStatus(e.target.value)} className="rounded-2xl border border-sky-100 px-4 py-2 text-sm font-bold outline-none">
              <option value="">全部状态</option>
              {statusOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
            <select value={type} onChange={(e) => setType(e.target.value)} className="rounded-2xl border border-sky-100 px-4 py-2 text-sm font-bold outline-none">
              <option value="">全部分类</option>
              {typeOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
            <button onClick={applyFilters} className="rounded-full bg-brand-950 px-4 py-2 text-sm font-black text-white">筛选</button>
          </div>

          <div className="mt-4 space-y-2">
            {loading ? <p className="p-3 text-sm font-bold text-slate-500">加载中...</p> : null}
            {!loading && !items.length ? <p className="rounded-2xl bg-sky-50 p-4 text-sm font-bold text-slate-500">没有匹配的反馈。</p> : null}
            {items.map((item) => (
              <button key={item.id} onClick={() => setSelectedId(item.id)} className={`w-full rounded-2xl p-3 text-left ${selectedId === item.id ? 'bg-sky-100' : 'bg-sky-50/70 hover:bg-sky-50'}`}>
                <div className="flex items-center justify-between gap-2">
                  <p className="truncate text-sm font-black text-brand-950">{item.title}</p>
                  {item.adminUnread ? <span className="rounded-full bg-red-500 px-2 py-0.5 text-[10px] font-black text-white">新</span> : null}
                </div>
                <p className="mt-1 text-xs font-bold text-slate-500">{item.user.nickname} · UID {String(item.user.uid).padStart(5, '0')}</p>
                <p className="mt-1 text-xs font-bold text-slate-400">{item.typeLabel} · {item.statusLabel}</p>
                <p className="mt-1 text-xs font-bold text-slate-400">更新：{formatTime(item.updatedAt)}</p>
              </button>
            ))}
            <div className="flex items-center justify-between gap-2 pt-2 text-xs font-bold text-slate-500">
              <button disabled={page <= 1 || loading} onClick={() => setPage((current) => Math.max(1, current - 1))} className="rounded-full bg-sky-50 px-3 py-2 font-black text-brand-700 disabled:opacity-40">上一页</button>
              <span>第 {page} 页 / 共 {total} 条</span>
              <button disabled={!hasMore || loading} onClick={() => setPage((current) => current + 1)} className="rounded-full bg-sky-50 px-3 py-2 font-black text-brand-700 disabled:opacity-40">下一页</button>
            </div>
          </div>
        </aside>

        <section className="rounded-[24px] border border-sky-100 bg-white/88 p-5 shadow-sm">
          {detail ? (
            <div className="space-y-5">
              <div className="border-b border-sky-100 pb-4">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded-full bg-sky-50 px-3 py-1 text-xs font-black text-brand-700">{detail.typeLabel}</span>
                  <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-black text-slate-600">{detail.statusLabel}</span>
                </div>
                <h2 className="mt-3 text-2xl font-black text-brand-950">{detail.title}</h2>
                <p className="mt-2 text-xs font-bold text-slate-500">提交人：{detail.user.nickname} / UID {String(detail.user.uid).padStart(5, '0')} · 创建 {formatTime(detail.createdAt)} · 更新 {formatTime(detail.updatedAt)}</p>
                {detail.contact ? <p className="mt-3 rounded-2xl bg-amber-50 px-4 py-2 text-xs font-black text-amber-700">联系方式：{detail.contact}</p> : null}
              </div>

              <div className="flex flex-wrap gap-2">
                {statusOptions.map(([value, label]) => (
                  <button key={value} onClick={() => updateStatus(value)} className={`rounded-full px-3 py-2 text-xs font-black ${detail.status === value ? 'bg-brand-950 text-white' : 'bg-sky-50 text-brand-700'}`}>{label}</button>
                ))}
              </div>

              <div className="space-y-3">
                {(detail.replies || []).map((item) => (
                  <div key={item.id} className={`rounded-2xl p-4 ${item.authorRole === 'ADMIN' ? 'bg-brand-50' : 'bg-sky-50/70'}`}>
                    <p className="text-xs font-black text-slate-500">{item.author.nickname} · {item.authorRole === 'ADMIN' ? '管理员' : '用户'} · {formatTime(item.createdAt)}</p>
                    <p className="mt-2 whitespace-pre-wrap text-sm font-bold leading-7 text-slate-700">{item.content}</p>
                    <AttachmentGrid attachments={item.attachments} />
                  </div>
                ))}
              </div>

              {detail.status !== 'RESOLVED' && detail.status !== 'CLOSED' ? (
                <form onSubmit={submitReply} className="space-y-3">
                  <textarea value={reply} onChange={(e) => setReply(e.target.value)} className="min-h-28 w-full rounded-2xl border border-sky-100 px-4 py-2 text-sm font-bold outline-none" placeholder="回复用户" />
                  <button disabled={replying} className="rounded-full bg-brand-950 px-5 py-3 text-sm font-black text-white disabled:opacity-60">{replying ? '发送中...' : '回复并通知用户'}</button>
                </form>
              ) : (
                <p className="rounded-2xl bg-slate-50 px-4 py-2 text-sm font-black text-slate-500">该反馈已完成，如需回复请先改为处理中或已回复。</p>
              )}
            </div>
          ) : (
            <div className="grid min-h-96 place-items-center text-sm font-bold text-slate-500">选择一条反馈查看详情</div>
          )}
        </section>
      </section>
    </main>
  )
}

function AttachmentGrid({ attachments }: { attachments: Array<{ id?: string; url: string }> }) {
  const visible = attachments.filter((item) => item.url)
  if (!visible.length) return null
  return (
    <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
      {visible.map((item) => (
        <Link key={item.id || item.url} href={item.url} target="_blank" className="block overflow-hidden rounded-2xl bg-white">
          <img src={item.url} alt="反馈附件" className="h-28 w-full object-cover" />
        </Link>
      ))}
    </div>
  )
}
