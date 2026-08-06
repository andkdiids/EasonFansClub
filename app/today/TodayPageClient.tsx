'use client'

import Link from 'next/link'
import { useState, type ChangeEvent, type FormEvent } from 'react'

export type TodayEventView = {
  id: string
  date: string
  year: number
  month: number
  day: number
  type: string
  title: string
  content: string
  imageUrl: string | null
  source: 'AUTO' | 'ADMIN'
  reference: string | null
  status: 'APPROVED'
  href: string | null
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

function yearsFromToday(year: number) {
  return Math.max(0, new Date().getFullYear() - year)
}

function formatEventDate(event: TodayEventView) {
  return `${event.year}年${String(event.month).padStart(2, '0')}月${String(event.day).padStart(2, '0')}日`
}

export function TodayPageClient({ month, day, initialEvents }: { month: number; day: number; initialEvents: TodayEventView[] }) {
  const [open, setOpen] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [uploading, setUploading] = useState(false)
  const [form, setForm] = useState({ date: '', type: 'CUSTOM', title: '', content: '', imageUrl: '', reference: '' })
  const events = [...initialEvents].sort((a, b) => b.year - a.year || b.date.localeCompare(a.date) || a.title.localeCompare(b.title, 'zh-CN'))

  async function uploadImage(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    setUploading(true)
    setError('')
    const body = new FormData()
    body.append('file', file)
    const response = await fetch('/api/uploads/today-image', { method: 'POST', body })
    const data = await response.json().catch(() => null)
    setUploading(false)
    if (!response.ok) {
      setError(data?.message || '图片上传失败')
      return
    }
    setForm((current) => ({ ...current, imageUrl: data.url || '' }))
    setMessage('图片已自动转换为 WebP 并上传 COS。')
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError('')
    setMessage('')
    const response = await fetch('/api/today', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form) })
    const data = await response.json().catch(() => null)
    if (!response.ok) {
      setError(data?.message || '提交失败，请稍后重试')
      return
    }
    setMessage(data?.message || '已提交，等待管理员审核。')
    setOpen(false)
    setForm({ date: '', type: 'CUSTOM', title: '', content: '', imageUrl: '', reference: '' })
  }

  return <main className="site-page-main flat-page mx-auto max-w-6xl space-y-6 px-4 py-6 sm:px-5 sm:py-9">
    <section className="flex flex-wrap items-end justify-between gap-4">
      <div>
        <p className="text-sm font-black uppercase tracking-[0.2em] text-sky-700">ON THIS DAY</p>
        <h1 className="mt-2 text-4xl font-black text-brand-950 sm:text-6xl">历史上的今天</h1>
        <p className="mt-3 text-lg font-black text-slate-600">{month} 月 {day} 日 · 记录 Eason 与 E 友的时间线</p>
      </div>
      <button type="button" onClick={() => setOpen((value) => !value)} className="rounded-full bg-brand-950 px-5 py-3 text-sm font-black text-white">提交今日内容</button>
    </section>
    {message ? <p className="rounded-2xl bg-emerald-50 px-4 py-3 text-sm font-black text-emerald-700">{message}</p> : null}
    {error ? <p className="rounded-2xl bg-red-50 px-4 py-3 text-sm font-black text-red-700">{error}</p> : null}
    {open ? <form onSubmit={submit} className="rounded-[28px] border border-sky-100 bg-white/90 p-6 shadow-sm"><h2 className="text-2xl font-black text-brand-950">提交历史记录</h2><p className="mt-2 text-sm font-bold leading-6 text-slate-500">提交后会进入 PENDING 状态，管理员审核通过后才会公开。</p><div className="mt-5 grid gap-4 md:grid-cols-3"><label className="text-sm font-black text-slate-600">日期<input required type="date" value={form.date} onChange={(event) => setForm({ ...form, date: event.target.value })} className="mt-2 w-full rounded-xl border border-sky-100 px-3 py-2" /></label><label className="text-sm font-black text-slate-600">类型<select value={form.type} onChange={(event) => setForm({ ...form, type: event.target.value })} className="mt-2 w-full rounded-xl border border-sky-100 bg-white px-3 py-2">{types.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label className="text-sm font-black text-slate-600">参考来源<input value={form.reference} onChange={(event) => setForm({ ...form, reference: event.target.value })} className="mt-2 w-full rounded-xl border border-sky-100 px-3 py-2" /></label></div><label className="mt-4 block text-sm font-black text-slate-600">标题<input required minLength={2} value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} className="mt-2 w-full rounded-xl border border-sky-100 px-3 py-2" /></label><label className="mt-4 block text-sm font-black text-slate-600">内容<textarea required minLength={5} rows={4} value={form.content} onChange={(event) => setForm({ ...form, content: event.target.value })} className="mt-2 w-full rounded-xl border border-sky-100 px-3 py-2" /></label><div className="mt-4 flex flex-wrap items-center gap-3"><label className="cursor-pointer rounded-full bg-sky-50 px-4 py-2 text-sm font-black text-brand-700">{uploading ? '上传中...' : '上传图片（自动 WebP）'}<input type="file" accept="image/jpeg,image/png,image/webp,image/gif" onChange={(event) => void uploadImage(event)} className="hidden" /></label>{form.imageUrl ? <span className="truncate text-xs font-bold text-emerald-600">已上传</span> : null}</div><div className="mt-5 flex items-center gap-3"><button type="submit" className="rounded-full bg-brand-950 px-6 py-3 text-sm font-black text-white">提交记录</button><button type="button" onClick={() => setOpen(false)} className="rounded-full border border-sky-100 px-6 py-3 text-sm font-black text-slate-500">取消</button></div></form> : null}

    <section className="today-poster-wall">
      {events.map((item) => (
        <article key={item.id} className="today-poster-card overflow-hidden rounded-2xl border border-sky-100 bg-white/90 shadow-sm">
          {item.imageUrl ? (
            <img src={item.imageUrl} alt={item.title} className="today-poster-image" loading="lazy" />
          ) : (
            <div className="today-poster-image today-poster-image-empty" />
          )}
          <div className="today-poster-body">
            <div className="today-poster-row">
              <time className="today-poster-date">{formatEventDate(item)}</time>
              <div className="today-poster-title">
                <h2 className="break-words text-lg font-black text-brand-950">{item.title}</h2>
                {item.content ? <p className="mt-1 break-words text-sm font-bold leading-6 text-slate-500">{item.content}</p> : null}
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <span className="rounded-full bg-sky-50 px-3 py-1 text-xs font-black text-brand-700">{types.find(([value]) => value === item.type)?.[1] || item.type}</span>
                  {item.reference ? <span className="text-xs font-bold text-slate-400">{item.reference}</span> : null}
                </div>
              </div>
              <div className="today-poster-anniversary">{yearsFromToday(item.year)} 周年</div>
            </div>
            {item.href ? <Link href={item.href} className="mt-3 inline-flex text-sm font-black text-brand-700">查看相关资料 →</Link> : null}
          </div>
        </article>
      ))}
      {!events.length ? <div className="rounded-[26px] border border-dashed border-sky-200 bg-white/70 p-10 text-center"><p className="text-4xl">✦</p><h2 className="mt-3 text-2xl font-black text-brand-950">今天还没有已收录内容</h2><p className="mt-2 text-sm font-bold text-slate-500">欢迎提交一条与 Eason 有关的历史记录。</p></div> : null}
    </section>
  </main>
}
