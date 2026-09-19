'use client'

import { useEffect, useState, type FormEvent } from 'react'

type Topic = {
  id: string
  name: string
  description: string | null
  coverImage: string | null
  isOfficial: boolean
  activityId: string | null
  startAt: string | null
  endAt: string | null
  _count?: { PostTopic: number }
  Activity?: { id: string; title: string } | null
}

type FormState = {
  name: string
  description: string
  coverImage: string
  isOfficial: boolean
  activityId: string
  startAt: string
  endAt: string
}

const emptyForm: FormState = { name: '', description: '', coverImage: '', isOfficial: true, activityId: '', startAt: '', endAt: '' }

function toInputDate(value: string | null) {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  const pad = (part: number) => String(part).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

export function TopicAdminManager() {
  const [topics, setTopics] = useState<Topic[]>([])
  const [form, setForm] = useState<FormState>(emptyForm)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')

  async function load() {
    const response = await fetch('/api/admin/topics', { cache: 'no-store' })
    if (!response.ok) throw new Error('话题列表加载失败')
    const data = await response.json() as { topics?: Topic[] }
    setTopics(data.topics || [])
  }

  useEffect(() => { void load().catch((error) => setMessage(error instanceof Error ? error.message : '话题列表加载失败')) }, [])

  function edit(topic: Topic) {
    setEditingId(topic.id)
    setForm({ name: topic.name, description: topic.description || '', coverImage: topic.coverImage || '', isOfficial: topic.isOfficial, activityId: topic.activityId || '', startAt: toInputDate(topic.startAt), endAt: toInputDate(topic.endAt) })
    setMessage('')
  }

  function reset() {
    setEditingId(null)
    setForm(emptyForm)
  }

  async function submit(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    setMessage('')
    try {
      const response = await fetch(editingId ? `/api/admin/topics/${editingId}` : '/api/admin/topics', {
        method: editingId ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      })
      const data = await response.json().catch(() => null) as { message?: string } | null
      if (!response.ok) throw new Error(data?.message || '保存失败')
      setMessage('话题已保存')
      reset()
      await load()
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '保存失败')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="space-y-6">
      <form onSubmit={submit} className="grid gap-4 border border-sky-100 bg-white/90 p-6 shadow-sm dark:border-slate-700 dark:bg-slate-900/90 md:grid-cols-2">
        <label className="text-sm font-black text-brand-950 dark:text-slate-100">名称<input required value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} className="mt-2 w-full border border-sky-200 px-3 py-2 font-bold" placeholder="太子湾花园城" /></label>
        <label className="text-sm font-black text-brand-950 dark:text-slate-100">关联活动 ID（可选）<input value={form.activityId} onChange={(event) => setForm({ ...form, activityId: event.target.value })} className="mt-2 w-full border border-sky-200 px-3 py-2 font-bold" /></label>
        <label className="text-sm font-black text-brand-950 dark:text-slate-100 md:col-span-2">简介<textarea value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} className="mt-2 min-h-24 w-full border border-sky-200 px-3 py-2 font-bold" /></label>
        <label className="text-sm font-black text-brand-950 dark:text-slate-100">封面 URL<input value={form.coverImage} onChange={(event) => setForm({ ...form, coverImage: event.target.value })} className="mt-2 w-full border border-sky-200 px-3 py-2 font-bold" /></label>
        <label className="flex items-center gap-2 self-end text-sm font-black text-brand-950 dark:text-slate-100"><input type="checkbox" checked={form.isOfficial} onChange={(event) => setForm({ ...form, isOfficial: event.target.checked })} />官方话题</label>
        <label className="text-sm font-black text-brand-950 dark:text-slate-100">开始时间<input type="datetime-local" value={form.startAt} onChange={(event) => setForm({ ...form, startAt: event.target.value })} className="mt-2 w-full border border-sky-200 px-3 py-2 font-bold" /></label>
        <label className="text-sm font-black text-brand-950 dark:text-slate-100">结束时间<input type="datetime-local" value={form.endAt} onChange={(event) => setForm({ ...form, endAt: event.target.value })} className="mt-2 w-full border border-sky-200 px-3 py-2 font-bold" /></label>
        <div className="flex items-center gap-3 md:col-span-2"><button type="submit" disabled={busy} className="border border-brand-700 bg-brand-700 px-4 py-2 text-sm font-black text-white disabled:opacity-50">{busy ? '保存中…' : editingId ? '保存修改' : '创建话题'}</button>{editingId ? <button type="button" onClick={reset} className="border border-sky-200 px-4 py-2 text-sm font-black text-brand-700">取消编辑</button> : null}{message ? <span className="text-sm font-bold text-slate-600">{message}</span> : null}</div>
      </form>
      <div className="divide-y divide-sky-100 border border-sky-100 bg-white/90 dark:divide-slate-700 dark:border-slate-700 dark:bg-slate-900/90">
        {topics.map((topic) => <div key={topic.id} className="flex flex-wrap items-center justify-between gap-4 p-5"><div><div className="font-black text-brand-950 dark:text-slate-100">#{topic.name} {topic.isOfficial ? <span className="text-amber-700">官方</span> : null}</div><div className="mt-1 text-xs font-bold text-slate-500">{topic._count?.PostTopic || 0} 条关联帖子 · {topic.id}</div></div><button type="button" onClick={() => edit(topic)} className="border border-sky-200 px-3 py-2 text-sm font-black text-brand-700">编辑</button></div>)}
        {!topics.length ? <p className="p-6 text-sm font-bold text-slate-500">暂无话题。</p> : null}
      </div>
    </section>
  )
}
