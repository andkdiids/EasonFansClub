'use client'

import { useEffect, useState, type FormEvent } from 'react'

type ChangelogItem = {
  id: string
  version: string
  title: string
  content: string
  type: string
  typeLabel: string
  status: string
  statusLabel: string
  isMajor: boolean
  publishedAt?: string | null
  createdAt: string
}

const typeOptions = [
  ['FEATURE', '新功能'],
  ['IMPROVEMENT', '功能优化'],
  ['FIX', '问题修复'],
  ['SECURITY', '安全更新'],
  ['CONTENT', '内容更新'],
]

const bumpOptions = [
  ['patch', '补丁版本'],
  ['minor', '次版本'],
  ['major', '主版本'],
]

function formatTime(value?: string | null) {
  if (!value) return '未发布'
  return new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value))
}

export function AdminChangelogPanel() {
  const [items, setItems] = useState<ChangelogItem[]>([])
  const [form, setForm] = useState({ title: '', content: '', type: 'IMPROVEMENT', bump: 'patch', isMajor: false, publishNow: false })
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    load()
  }, [])

  async function requestJson(url: string, init?: RequestInit) {
    const response = await fetch(url, init)
    const data = await response.json().catch(() => null)
    if (!response.ok) throw new Error(data?.message || '操作失败')
    return data
  }

  async function load() {
    try {
      const data = await requestJson('/api/admin/changelog')
      setItems(data.changelogs || [])
    } catch (err) {
      setError(err instanceof Error ? err.message : '更新日志加载失败')
    }
  }

  async function create(event: FormEvent) {
    event.preventDefault()
    if (submitting) return
    setSubmitting(true)
    setError('')
    setMessage('')
    try {
      const data = await requestJson('/api/admin/changelog', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      })
      setItems((current) => [data.changelog, ...current])
      setForm({ title: '', content: '', type: 'IMPROVEMENT', bump: 'patch', isMajor: false, publishNow: false })
      setMessage(data.message || '更新日志已创建')
    } catch (err) {
      setError(err instanceof Error ? err.message : '创建失败')
    } finally {
      setSubmitting(false)
    }
  }

  async function patch(id: string, body: Record<string, unknown>) {
    const data = await requestJson(`/api/admin/changelog/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    setItems((current) => current.map((item) => (item.id === id ? data.changelog : item)))
    setMessage(data.message || '已保存')
  }

  async function deleteDraft(id: string) {
    if (!window.confirm('确定删除这条草稿吗？')) return
    await requestJson(`/api/admin/changelog/${id}`, { method: 'DELETE' })
    setItems((current) => current.filter((item) => item.id !== id))
    setMessage('草稿已删除')
  }

  return (
    <main className="mx-auto max-w-6xl space-y-5 px-4 py-6 sm:px-5 sm:py-8">
      <section className="rounded-[28px] border border-sky-100 bg-white/85 p-6 shadow-sm">
        <p className="text-sm font-black uppercase tracking-[0.18em] text-brand-700">Changelog</p>
        <h1 className="mt-2 text-3xl font-black text-brand-950">更新日志</h1>
      </section>

      {message ? <p className="rounded-2xl bg-emerald-50 px-4 py-2 text-sm font-black text-emerald-700">{message}</p> : null}
      {error ? <p className="rounded-2xl bg-red-50 px-4 py-2 text-sm font-black text-red-600">{error}</p> : null}

      <form onSubmit={create} className="rounded-[24px] border border-sky-100 bg-white/88 p-5 shadow-sm">
        <h2 className="text-xl font-black text-brand-950">新建更新日志</h2>
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          <input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} className="rounded-2xl border border-sky-100 px-4 py-2 text-sm font-bold outline-none" placeholder="更新标题" />
          <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })} className="rounded-2xl border border-sky-100 px-4 py-2 text-sm font-bold outline-none">
            {typeOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
          <select value={form.bump} onChange={(e) => setForm({ ...form, bump: e.target.value })} className="rounded-2xl border border-sky-100 px-4 py-2 text-sm font-bold outline-none">
            {bumpOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
          <div className="flex flex-wrap items-center gap-4 rounded-2xl bg-sky-50 px-4 py-2 text-sm font-black text-slate-600">
            <label className="flex items-center gap-2"><input type="checkbox" checked={form.isMajor} onChange={(e) => setForm({ ...form, isMajor: e.target.checked })} />重大更新</label>
            <label className="flex items-center gap-2"><input type="checkbox" checked={form.publishNow} onChange={(e) => setForm({ ...form, publishNow: e.target.checked })} />立即发布</label>
          </div>
        </div>
        <textarea value={form.content} onChange={(e) => setForm({ ...form, content: e.target.value })} className="mt-3 min-h-36 w-full rounded-2xl border border-sky-100 px-4 py-2 text-sm font-bold outline-none" placeholder="支持分条或 Markdown 文本" />
        <button disabled={submitting} className="mt-4 rounded-full bg-brand-950 px-5 py-3 text-sm font-black text-white disabled:opacity-60">{submitting ? '创建中...' : '创建更新日志'}</button>
      </form>

      <section className="space-y-3">
        {items.map((item) => (
          <article key={item.id} className="rounded-[24px] border border-sky-100 bg-white/88 p-5 shadow-sm">
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-full bg-brand-950 px-3 py-1 text-xs font-black text-white">{item.version}</span>
              <span className="rounded-full bg-sky-50 px-3 py-1 text-xs font-black text-brand-700">{item.typeLabel}</span>
              <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-black text-slate-600">{item.statusLabel}</span>
              {item.isMajor ? <span className="rounded-full bg-amber-50 px-3 py-1 text-xs font-black text-amber-700">重大更新</span> : null}
            </div>
            <h2 className="mt-3 text-2xl font-black text-brand-950">{item.title}</h2>
            <p className="mt-1 text-xs font-bold text-slate-400">{formatTime(item.publishedAt)}</p>
            <p className="mt-4 whitespace-pre-wrap text-sm font-bold leading-7 text-slate-600">{item.content}</p>
            <div className="mt-4 flex flex-wrap gap-2">
              {item.status !== 'PUBLISHED' ? <button onClick={() => patch(item.id, { status: 'PUBLISHED' })} className="rounded-full bg-emerald-50 px-4 py-2 text-xs font-black text-emerald-700">发布</button> : null}
              {item.status === 'PUBLISHED' ? <button onClick={() => patch(item.id, { status: 'UNPUBLISHED' })} className="rounded-full bg-amber-50 px-4 py-2 text-xs font-black text-amber-700">下架</button> : null}
              {item.status === 'DRAFT' ? <button onClick={() => deleteDraft(item.id)} className="rounded-full bg-red-50 px-4 py-2 text-xs font-black text-red-600">删除草稿</button> : null}
            </div>
          </article>
        ))}
      </section>
    </main>
  )
}
