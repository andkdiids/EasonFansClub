'use client'

import { useEffect, useState, type FormEvent } from 'react'

type NotificationItem = {
  id: string
  title: string
  content: string
  link?: string | null
  type: string
  typeLabel: string
  cover?: string | null
  priority: number
  popup: boolean
  sticky: boolean
  publishAt: string
  expireAt?: string | null
  published: boolean
  buttonText?: string | null
  buttonUrl?: string | null
  version?: string | null
  readCount: number
  unreadCount?: number
}

const typeOptions = [
  ['SYSTEM', '系统通知'],
  ['UPDATE', '更新日志'],
  ['ANNOUNCEMENT', '公告'],
  ['ACTIVITY', '活动'],
  ['MAINTENANCE', '维护'],
  ['SECURITY', '安全'],
]

const emptyForm = {
  id: '',
  title: '',
  content: '',
  link: '',
  type: 'SYSTEM',
  cover: '',
  priority: 0,
  popup: false,
  sticky: false,
  publishAt: '',
  expireAt: '',
  published: true,
  buttonText: '',
  buttonUrl: '',
  version: '',
}

function toInputDate(value?: string | null) {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16)
}

export function NotificationBroadcastForm() {
  const [items, setItems] = useState<NotificationItem[]>([])
  const [form, setForm] = useState(emptyForm)
  const [statusFilter, setStatusFilter] = useState('')
  const [typeFilter, setTypeFilter] = useState('')
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)

  useEffect(() => {
    load()
  }, [statusFilter, typeFilter])

  function update(key: keyof typeof form, value: string | boolean | number) {
    setForm((current) => ({ ...current, [key]: value }))
  }

  async function requestJson(url: string, init?: RequestInit) {
    const response = await fetch(url, init)
    const data = await response.json().catch(() => null)
    if (!response.ok) throw new Error(data?.message || '操作失败')
    return data
  }

  async function load() {
    setError('')
    try {
      const params = new URLSearchParams()
      if (statusFilter) params.set('status', statusFilter)
      if (typeFilter) params.set('type', typeFilter)
      const data = await requestJson(`/api/admin/system-notifications?${params.toString()}`)
      setItems(data.notifications || [])
    } catch (err) {
      setError(err instanceof Error ? err.message : '通知加载失败')
    }
  }

  function edit(item: NotificationItem) {
    setForm({
      id: item.id,
      title: item.title,
      content: item.content,
      link: item.link || '',
      type: item.type,
      cover: item.cover || '',
      priority: item.priority,
      popup: item.popup,
      sticky: item.sticky,
      publishAt: toInputDate(item.publishAt),
      expireAt: toInputDate(item.expireAt),
      published: item.published,
      buttonText: item.buttonText || '',
      buttonUrl: item.buttonUrl || '',
      version: item.version || '',
    })
    setMessage('正在编辑通知')
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (form.type === 'UPDATE' && !form.version.trim()) {
      setError('更新日志必须填写版本号')
      return
    }
    if (form.published && !window.confirm('确定保存并发布这条通知吗？')) return

    setMessage('')
    setError('')
    setIsSubmitting(true)
    try {
      const payload = {
        ...form,
        priority: Number(form.priority) || 0,
        publishAt: form.publishAt || undefined,
        expireAt: form.expireAt || undefined,
      }
      const data = await requestJson('/api/admin/system-notifications', {
        method: form.id ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      setMessage(data.message || '通知已保存')
      setForm(emptyForm)
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存失败')
    } finally {
      setIsSubmitting(false)
    }
  }

  async function patch(id: string, body: Record<string, unknown>) {
    const data = await requestJson('/api/admin/system-notifications', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, ...body }),
    })
    setItems((current) => current.map((item) => (item.id === id ? data.notification : item)))
    setMessage(data.message || '通知已保存')
  }

  async function remove(id: string) {
    if (!window.confirm('确定删除这条通知吗？删除后不可恢复。')) return
    await requestJson(`/api/admin/system-notifications?id=${encodeURIComponent(id)}`, { method: 'DELETE' })
    setItems((current) => current.filter((item) => item.id !== id))
    setMessage('通知已删除')
  }

  return (
    <main className="mx-auto grid max-w-7xl gap-6 px-5 py-8 md:grid-cols-[430px_minmax(0,1fr)]">
      <form onSubmit={submit} className="space-y-4 rounded-[28px] border border-sky-100 bg-white/85 p-6 shadow-sm">
        <div>
          <p className="text-sm font-black tracking-[0.18em] text-brand-700">全站通知</p>
          <h1 className="mt-2 text-3xl font-black text-brand-950">{form.id ? '编辑系统通知' : '新建系统通知'}</h1>
          <p className="mt-2 text-sm font-bold text-slate-500">系统通知不会为每位用户创建独立记录，已读状态由读取表记录。</p>
        </div>

        <input value={form.title} onChange={(event) => update('title', event.target.value)} maxLength={100} className="w-full rounded-2xl border border-sky-100 px-4 py-2 text-sm font-bold outline-none" placeholder="标题" />
        <textarea value={form.content} onChange={(event) => update('content', event.target.value)} rows={6} maxLength={8000} className="w-full resize-none rounded-2xl border border-sky-100 px-4 py-2 text-sm font-bold leading-7 outline-none" placeholder="内容，可使用纯文本分行" />

        <div className="grid gap-3 md:grid-cols-2">
          <select value={form.type} onChange={(event) => update('type', event.target.value)} className="rounded-2xl border border-sky-100 px-4 py-2 text-sm font-bold outline-none">
            {typeOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
          <input value={form.version} onChange={(event) => update('version', event.target.value)} className="rounded-2xl border border-sky-100 px-4 py-2 text-sm font-bold outline-none" placeholder="版本号，UPDATE 必填，如 v1.0.1" />
          <input value={form.link} onChange={(event) => update('link', event.target.value)} className="rounded-2xl border border-sky-100 px-4 py-2 text-sm font-bold outline-none" placeholder="详情链接 /notifications" />
          <input value={form.buttonUrl} onChange={(event) => update('buttonUrl', event.target.value)} className="rounded-2xl border border-sky-100 px-4 py-2 text-sm font-bold outline-none" placeholder="按钮链接，可选" />
          <input value={form.buttonText} onChange={(event) => update('buttonText', event.target.value)} className="rounded-2xl border border-sky-100 px-4 py-2 text-sm font-bold outline-none" placeholder="按钮文字，可选" />
          <input value={form.cover} onChange={(event) => update('cover', event.target.value)} className="rounded-2xl border border-sky-100 px-4 py-2 text-sm font-bold outline-none" placeholder="封面图 URL，可选" />
          <input type="number" min={0} max={100} value={form.priority} onChange={(event) => update('priority', Number(event.target.value))} className="rounded-2xl border border-sky-100 px-4 py-2 text-sm font-bold outline-none" placeholder="优先级" />
          <input type="datetime-local" value={form.publishAt} onChange={(event) => update('publishAt', event.target.value)} className="rounded-2xl border border-sky-100 px-4 py-2 text-sm font-bold outline-none" />
          <input type="datetime-local" value={form.expireAt} onChange={(event) => update('expireAt', event.target.value)} className="rounded-2xl border border-sky-100 px-4 py-2 text-sm font-bold outline-none" />
        </div>

        <div className="grid gap-2 rounded-2xl bg-sky-50 px-4 py-2 text-sm font-black text-slate-600 sm:grid-cols-2">
          <label className="flex items-center gap-2"><input type="checkbox" checked={form.published} onChange={(event) => update('published', event.target.checked)} />发布</label>
          <label className="flex items-center gap-2"><input type="checkbox" checked={form.sticky} onChange={(event) => update('sticky', event.target.checked)} />置顶</label>
          <label className="flex items-center gap-2"><input type="checkbox" checked={form.popup} onChange={(event) => update('popup', event.target.checked)} />右下角弹窗</label>
        </div>

        {message ? <p className="rounded-2xl bg-emerald-50 px-4 py-2 text-sm font-black text-emerald-700">{message}</p> : null}
        {error ? <p className="rounded-2xl bg-red-50 px-4 py-2 text-sm font-black text-red-600">{error}</p> : null}

        <div className="flex gap-2">
          <button disabled={isSubmitting} className="flex-1 rounded-2xl bg-brand-950 px-5 py-3 text-sm font-black text-white disabled:cursor-not-allowed disabled:opacity-60">
            {isSubmitting ? '保存中...' : form.id ? '保存修改' : '创建通知'}
          </button>
          {form.id ? <button type="button" onClick={() => setForm(emptyForm)} className="rounded-2xl bg-slate-100 px-5 py-3 text-sm font-black text-slate-600">取消</button> : null}
        </div>
      </form>

      <section className="rounded-[28px] border border-sky-100 bg-white/85 p-6 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-2xl font-black text-brand-950">系统通知管理</h2>
            <p className="mt-1 text-sm font-bold text-slate-500">支持定时、过期、置顶、弹窗和更新日志。</p>
          </div>
          <div className="flex gap-2">
            <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} className="rounded-full border border-sky-100 px-3 py-2 text-xs font-black">
              <option value="">全部状态</option>
              <option value="published">已发布</option>
              <option value="draft">未发布</option>
            </select>
            <select value={typeFilter} onChange={(event) => setTypeFilter(event.target.value)} className="rounded-full border border-sky-100 px-3 py-2 text-xs font-black">
              <option value="">全部类型</option>
              {typeOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </div>
        </div>

        <div className="mt-5 space-y-3">
          {items.map((item) => (
            <article key={item.id} className="rounded-2xl bg-sky-50/70 p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap gap-2">
                    <span className="rounded-full bg-brand-950 px-3 py-1 text-xs font-black text-white">{item.typeLabel}</span>
                    {item.version ? <span className="rounded-full bg-white px-3 py-1 text-xs font-black text-brand-700">{item.version}</span> : null}
                    {item.sticky ? <span className="rounded-full bg-amber-50 px-3 py-1 text-xs font-black text-amber-700">置顶</span> : null}
                    {item.popup ? <span className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-black text-emerald-700">弹窗</span> : null}
                  </div>
                  <p className="mt-3 text-lg font-black text-brand-950">{item.title}</p>
                  <p className="mt-2 whitespace-pre-wrap break-words text-sm font-bold leading-6 text-slate-600">{item.content}</p>
                  <p className="mt-3 text-xs font-black text-slate-500">
                    发布时间 {new Date(item.publishAt).toLocaleString('zh-CN', { hour12: false })} · 已读 {item.readCount} · 未读 {item.unreadCount ?? 0}
                  </p>
                </div>
                <span className={`rounded-full px-3 py-1 text-xs font-black ${item.published ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>
                  {item.published ? '已发布' : '未发布'}
                </span>
              </div>
              <div className="mt-4 flex flex-wrap gap-2">
                <button onClick={() => edit(item)} className="rounded-full bg-white px-4 py-2 text-xs font-black text-brand-700">编辑</button>
                <button onClick={() => patch(item.id, { published: !item.published })} className="rounded-full bg-white px-4 py-2 text-xs font-black text-slate-600">{item.published ? '下架' : '发布'}</button>
                <button onClick={() => patch(item.id, { sticky: !item.sticky })} className="rounded-full bg-white px-4 py-2 text-xs font-black text-slate-600">{item.sticky ? '取消置顶' : '置顶'}</button>
                <button onClick={() => patch(item.id, { popup: !item.popup })} className="rounded-full bg-white px-4 py-2 text-xs font-black text-slate-600">{item.popup ? '关闭弹窗' : '设为弹窗'}</button>
                <button onClick={() => remove(item.id)} className="rounded-full bg-red-50 px-4 py-2 text-xs font-black text-red-600">删除</button>
              </div>
            </article>
          ))}
          {!items.length ? <p className="rounded-2xl bg-sky-50 p-5 text-sm font-bold text-slate-500">暂无系统通知。</p> : null}
        </div>
      </section>
    </main>
  )
}
