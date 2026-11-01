'use client'

import { useRef, useState, type FormEvent } from 'react'

export function ManualPostForm({ onCreated }: Readonly<{ onCreated: () => Promise<void> }>) {
  const formRef = useRef<HTMLFormElement>(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy) return
    setBusy(true)
    setMessage('')
    setError('')
    try {
      const form = event.currentTarget
      const data = new FormData(form)
      const rawDate = String(data.get('publishedAt') || '')
      const publishedAt = new Date(rawDate)
      if (!Number.isFinite(publishedAt.getTime())) throw new Error('请填写有效的原始发布时间')
      data.set('publishedAt', publishedAt.toISOString())
      const response = await fetch('/api/admin/anywhere-door/posts/manual', { method: 'POST', body: data, credentials: 'same-origin' })
      const payload = await response.json().catch(() => null)
      if (!response.ok) throw new Error(payload?.message || '内容补录失败，请保留表单后重试')
      setMessage(payload?.result?.deduplicated
        ? '已找到相同来源内容，没有创建重复动态。'
        : '内容已补录，前台作者显示为 mreasonchan。')
      formRef.current?.reset()
      try {
        await onCreated()
      } catch {
        setError('内容已保存，但列表刷新失败；请稍后刷新页面确认，避免重复补录。')
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '内容补录失败，请重试')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="rounded-[28px] border border-sky-100 bg-white/90 p-5 shadow-sm sm:p-7">
      <div>
        <p className="text-xs font-black uppercase tracking-[0.18em] text-brand-700">内容兜底</p>
        <h2 className="mt-2 text-xl font-black text-brand-950">手动补录真实动态</h2>
        <p className="mt-1 text-sm font-bold leading-6 text-slate-500">仅补录 mreasonchan 的真实公开内容；记录原始发布时间和可选原文链接。视频经腾讯 COS 存储，管理员身份只记入后台审计。</p>
      </div>
      <form ref={formRef} onSubmit={submit} className="mt-5 grid gap-4">
        <label className="grid gap-1.5 text-sm font-black text-brand-950">正文（纯文字动态可只填写此项）<textarea name="caption" maxLength={10_000} rows={5} className="rounded-2xl border border-slate-200 px-4 py-3 font-medium leading-6 outline-none focus:border-brand-500" /></label>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="grid gap-1.5 text-sm font-black text-brand-950">原始发布时间<input name="publishedAt" type="datetime-local" required className="min-h-11 rounded-xl border border-slate-200 px-3 font-medium outline-none focus:border-brand-500" /></label>
          <label className="grid gap-1.5 text-sm font-black text-brand-950">原文链接（可选）<input name="sourceUrl" type="url" placeholder="https://www.instagram.com/p/.../" className="min-h-11 rounded-xl border border-slate-200 px-3 font-medium outline-none focus:border-brand-500" /></label>
        </div>
        <label className="grid gap-1.5 text-sm font-black text-brand-950">视频（可选，纯文字或文字+视频）<input name="video" type="file" accept="video/mp4,.mp4" className="min-h-11 rounded-xl border border-slate-200 px-3 py-2 text-sm font-medium" /> <span className="text-xs font-bold text-slate-400">仅 MP4，最大 50MB。失败时表单保留，可重新提交。</span></label>
        {message ? <p className="text-sm font-bold text-emerald-700" role="status">{message}</p> : null}
        {error ? <p className="text-sm font-bold text-red-600" role="alert">{error}</p> : null}
        <div><button type="submit" disabled={busy} className="min-h-11 rounded-full bg-brand-950 px-5 text-sm font-black text-white disabled:cursor-wait disabled:opacity-50">{busy ? '正在保存…' : '补录动态'}</button></div>
      </form>
    </section>
  )
}
