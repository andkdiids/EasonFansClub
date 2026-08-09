'use client'

import { useState, type FormEvent } from 'react'

export type AdminTodayEvent = {
  id: string
  date: string
  type: string
  title: string
  content: string
  imageUrl: string | null
  source: 'AUTO' | 'ADMIN'
  reference: string | null
  status: 'PENDING' | 'APPROVED' | 'REJECTED'
  rejectionReason: string | null
  submittedBy: { uid: number; name: string } | null
}

const types = [
  ['ALBUM', '专辑发行'],
  ['CONCERT', '演唱会'],
  ['SONG', '歌曲发行'],
  ['CAREER', '事业节点'],
  ['AWARD', '获奖'],
  ['CUSTOM', '自定义'],
  ['BIRTHDAY', '生日'],
  ['DEBUT', '出道'],
  ['ROOKIE_CONTEST', '新秀比赛'],
  ['ALBUM_RELEASE', '专辑发行'],
  ['OTHER', '其他'],
] as const

const statusLabels = { PENDING: '待审核', APPROVED: '已通过', REJECTED: '已拒绝' } as const

export function TodayAdminManager({ initialEvents }: { initialEvents: AdminTodayEvent[] }) {
  const [events, setEvents] = useState(initialEvents)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [form, setForm] = useState({ date: '', type: 'CUSTOM', title: '', content: '', imageUrl: '', reference: '' })
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  function reset() {
    setEditingId(null)
    setForm({ date: '', type: 'CUSTOM', title: '', content: '', imageUrl: '', reference: '' })
  }

  function edit(event: AdminTodayEvent) {
    setEditingId(event.id)
    setForm({ date: event.date.slice(0, 10), type: event.type, title: event.title, content: event.content, imageUrl: event.imageUrl || '', reference: event.reference || '' })
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setMessage('')
    setError('')
    const response = await fetch(editingId ? `/api/admin/today/${editingId}` : '/api/admin/today', {
      method: editingId ? 'PATCH' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(form),
    })
    const data = await response.json().catch(() => null)
    if (!response.ok) {
      setError(data?.message || '保存失败')
      return
    }
    if (editingId) {
      setEvents((current) => current.map((item) => item.id === editingId ? { ...item, ...form, imageUrl: form.imageUrl || null, reference: form.reference || null } : item))
    } else if (data?.event) {
      setEvents((current) => [{ ...data.event, ...form, imageUrl: form.imageUrl || null, reference: form.reference || null, source: 'ADMIN', status: data.event.status || 'APPROVED', rejectionReason: null, submittedBy: null }, ...current])
    }
    setMessage(editingId ? '内容已更新' : '内容已新增')
    reset()
  }

  async function updateStatus(id: string, status: 'APPROVED' | 'REJECTED') {
    setError('')
    const response = await fetch(`/api/admin/today/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status }) })
    const data = await response.json().catch(() => null)
    if (!response.ok) {
      setError(data?.message || '审核失败')
      return
    }
    setEvents((current) => current.map((item) => item.id === id ? { ...item, status } : item))
    setMessage(status === 'APPROVED' ? '内容已通过' : '内容已拒绝')
  }

  async function remove(id: string) {
    if (!window.confirm('确定删除这条今日内容吗？')) return
    const response = await fetch(`/api/admin/today/${id}`, { method: 'DELETE' })
    if (!response.ok) {
      setError('删除失败')
      return
    }
    setEvents((current) => current.filter((item) => item.id !== id))
    setMessage('内容已删除')
  }

  return (
    <>
      <form onSubmit={save} className="rounded-[28px] border border-sky-100 bg-white/90 p-5 shadow-sm sm:p-7">
        <div className="flex flex-wrap items-center justify-between gap-3"><div><p className="text-xs font-black uppercase tracking-[0.18em] text-sky-700">Today CMS</p><h2 className="mt-1 text-2xl font-black text-brand-950">{editingId ? '编辑今日内容' : '新增今日内容'}</h2></div>{editingId ? <button type="button" onClick={reset} className="rounded-full bg-sky-50 px-4 py-2 text-sm font-black text-brand-700">取消编辑</button> : null}</div>
        <div className="mt-5 grid gap-4 md:grid-cols-3"><label className="text-sm font-black text-slate-600">日期<input required type="date" value={form.date} onChange={(event) => setForm({ ...form, date: event.target.value })} className="mt-2 w-full rounded-xl border border-sky-100 px-3 py-2" /></label><label className="text-sm font-black text-slate-600">类型<select value={form.type} onChange={(event) => setForm({ ...form, type: event.target.value })} className="mt-2 w-full rounded-xl border border-sky-100 bg-white px-3 py-2">{types.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label className="text-sm font-black text-slate-600">参考来源<input value={form.reference} onChange={(event) => setForm({ ...form, reference: event.target.value })} className="mt-2 w-full rounded-xl border border-sky-100 px-3 py-2" /></label></div>
        <label className="mt-4 block text-sm font-black text-slate-600">标题<input required minLength={2} value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} className="mt-2 w-full rounded-xl border border-sky-100 px-3 py-2" /></label>
        <label className="mt-4 block text-sm font-black text-slate-600">内容<textarea required minLength={5} rows={4} value={form.content} onChange={(event) => setForm({ ...form, content: event.target.value })} className="mt-2 w-full rounded-xl border border-sky-100 px-3 py-2" /></label>
        <label className="mt-4 block text-sm font-black text-slate-600">图片 URL<input value={form.imageUrl} onChange={(event) => setForm({ ...form, imageUrl: event.target.value })} className="mt-2 w-full rounded-xl border border-sky-100 px-3 py-2" placeholder="COS WebP 地址" /></label>
        <button className="mt-5 rounded-full bg-brand-950 px-5 py-3 text-sm font-black text-white">{editingId ? '保存修改' : '新增并通过'}</button>
      </form>

      {message ? <p className="rounded-2xl bg-emerald-50 px-4 py-3 text-sm font-black text-emerald-700">{message}</p> : null}
      {error ? <p className="rounded-2xl bg-red-50 px-4 py-3 text-sm font-black text-red-700">{error}</p> : null}

      <section className="rounded-[28px] border border-sky-100 bg-white/90 p-5 shadow-sm sm:p-7">
        <div className="flex items-end justify-between gap-3"><div><p className="text-xs font-black uppercase tracking-[0.18em] text-sky-700">Moderation</p><h2 className="mt-1 text-2xl font-black text-brand-950">内容审核</h2></div><span className="text-sm font-black text-slate-500">待审核 {events.filter((item) => item.status === 'PENDING').length}</span></div>
        <div className="mt-5 divide-y divide-sky-100">
          {events.map((event) => <article key={event.id} className="grid gap-4 py-5 md:grid-cols-[minmax(0,1fr)_auto]"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><span className="rounded-full bg-sky-50 px-3 py-1 text-xs font-black text-brand-700">{types.find(([value]) => value === event.type)?.[1] || event.type}</span><span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-black text-slate-600">{event.source === 'AUTO' ? '自动生成' : '后台添加'}</span><span className={`rounded-full px-3 py-1 text-xs font-black ${event.status === 'PENDING' ? 'bg-amber-50 text-amber-700' : event.status === 'APPROVED' ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'}`}>{statusLabels[event.status]}</span><span className="text-xs font-bold text-slate-400">{event.date.slice(0, 10)}</span></div><h3 className="mt-3 text-xl font-black text-brand-950">{event.title}</h3><p className="mt-2 whitespace-pre-wrap text-sm leading-7 text-slate-600">{event.content}</p><p className="mt-2 text-xs font-bold text-slate-400">{event.submittedBy ? `提交人：${event.submittedBy.name}（UID ${event.submittedBy.uid}）` : '管理员创建'}{event.reference ? ` · 来源：${event.reference}` : ''}</p>{event.imageUrl ? <img src={event.imageUrl} alt={event.title} className="mt-3 h-24 w-40 rounded-xl object-cover" /> : null}</div><div className="flex flex-wrap items-start gap-2 md:flex-col"><button type="button" onClick={() => edit(event)} className="rounded-full bg-sky-50 px-4 py-2 text-sm font-black text-brand-700">编辑</button>{event.status === 'PENDING' ? <><button type="button" onClick={() => void updateStatus(event.id, 'APPROVED')} className="rounded-full bg-emerald-600 px-4 py-2 text-sm font-black text-white">通过</button><button type="button" onClick={() => void updateStatus(event.id, 'REJECTED')} className="rounded-full bg-red-50 px-4 py-2 text-sm font-black text-red-700">拒绝</button></> : null}<button type="button" onClick={() => void remove(event.id)} className="rounded-full bg-red-50 px-4 py-2 text-sm font-black text-red-700">删除</button></div></article>)}
          {!events.length ? <p className="py-8 text-center text-sm font-bold text-slate-500">暂无今日内容。</p> : null}
        </div>
      </section>
    </>
  )
}
