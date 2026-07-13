'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'

export function NotificationBroadcastForm() {
  const router = useRouter()
  const [form, setForm] = useState({
    title: '',
    content: '',
    link: '',
    type: 'SYSTEM',
    publishNow: true,
  })
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)

  function update(key: keyof typeof form, value: string | boolean) {
    setForm((current) => ({ ...current, [key]: value }))
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!confirm('确认向所有用户发送这条通知吗？')) return

    setMessage('')
    setError('')
    setIsSubmitting(true)
    const response = await fetch('/api/admin/system-notifications', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(form),
    })
    const data = await response.json().catch(() => ({}))
    setIsSubmitting(false)

    if (!response.ok) {
      setError(data.message || '发送失败')
      return
    }

    setMessage(data.message || '全站通知已发布')
    setForm({ title: '', content: '', link: '', type: 'SYSTEM', publishNow: true })
    router.refresh()
  }

  return (
    <form onSubmit={submit} className="space-y-4 rounded-[28px] border border-sky-100 bg-white/85 p-6 shadow-sm">
      <div>
        <p className="text-sm font-black uppercase tracking-[0.18em] text-brand-700">Broadcast</p>
        <h1 className="mt-2 text-3xl font-black text-brand-950">发送全站通知</h1>
        <p className="mt-2 text-sm font-bold text-slate-500">通知只创建一条广播记录，通过已读表记录用户阅读状态。</p>
      </div>

      <label className="block">
        <span className="text-sm font-black text-slate-700">通知标题</span>
        <input value={form.title} onChange={(event) => update('title', event.target.value)} maxLength={80} className="mt-2 w-full rounded-2xl border border-sky-100 px-4 py-3 text-sm font-bold outline-none" />
      </label>

      <label className="block">
        <span className="text-sm font-black text-slate-700">通知内容</span>
        <textarea value={form.content} onChange={(event) => update('content', event.target.value)} rows={5} maxLength={2000} className="mt-2 w-full resize-none rounded-2xl border border-sky-100 px-4 py-3 text-sm font-bold leading-7 outline-none" />
      </label>

      <div className="grid gap-4 md:grid-cols-2">
        <label className="block">
          <span className="text-sm font-black text-slate-700">跳转链接（可选）</span>
          <input value={form.link} onChange={(event) => update('link', event.target.value)} placeholder="/notifications" className="mt-2 w-full rounded-2xl border border-sky-100 px-4 py-3 text-sm font-bold outline-none" />
        </label>
        <label className="block">
          <span className="text-sm font-black text-slate-700">通知类型</span>
          <select value={form.type} onChange={(event) => update('type', event.target.value)} className="mt-2 w-full rounded-2xl border border-sky-100 px-4 py-3 text-sm font-bold outline-none">
            <option value="SYSTEM">系统通知</option>
            <option value="ACTIVITY">活动通知</option>
            <option value="ADMIN">管理员通知</option>
          </select>
        </label>
      </div>

      <label className="flex items-center gap-3 rounded-2xl bg-sky-50 px-4 py-3 text-sm font-black text-slate-600">
        <input type="checkbox" checked={form.publishNow} onChange={(event) => update('publishNow', event.target.checked)} />
        立即发送
      </label>

      {message ? <p className="rounded-2xl bg-emerald-50 px-4 py-3 text-sm font-black text-emerald-700">{message}</p> : null}
      {error ? <p className="rounded-2xl bg-red-50 px-4 py-3 text-sm font-black text-red-600">{error}</p> : null}

      <button disabled={isSubmitting} className="w-full rounded-2xl bg-brand-950 px-5 py-3 text-sm font-black text-white disabled:cursor-not-allowed disabled:opacity-60">
        {isSubmitting ? '发送中...' : '发送通知'}
      </button>
    </form>
  )
}
