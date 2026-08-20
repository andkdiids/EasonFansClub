'use client'

import Link from 'next/link'
import { useRef, useState, type FormEvent } from 'react'
import { formatCalendarDate, parseCalendarDate } from '@/lib/calendar-date'
import { publicImageVariantUrl } from '@/lib/image-variants'
import { todayImageFileKey } from '@/lib/today-image'
import { TodayImageUploader, uploadTodayImage, type TodayImageSelection, type TodayImageUploadStatus } from '@/components/TodayImageUploader'

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

const emptyForm = { date: '', type: 'CUSTOM', title: '', content: '', reference: '' }
const emptySelection: TodayImageSelection = { file: null, removed: false }

function yearsFromToday(year: number) {
  return Math.max(0, parseCalendarDate(new Date()).year - year)
}

function formatEventDate(event: TodayEventView) {
  return formatCalendarDate(event.date)
}

export function TodayPageClient({ month, day, initialEvents }: { month: number; day: number; initialEvents: TodayEventView[] }) {
  const [open, setOpen] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [uploadStatus, setUploadStatus] = useState<TodayImageUploadStatus>('idle')
  const [selection, setSelection] = useState<TodayImageSelection>(emptySelection)
  const [cachedUpload, setCachedUpload] = useState<{ key: string; url: string } | null>(null)
  const [saving, setSaving] = useState(false)
  const savingRef = useRef(false)
  const [form, setForm] = useState(emptyForm)
  const events = [...initialEvents].sort((a, b) => b.year - a.year || b.date.localeCompare(a.date) || a.title.localeCompare(b.title, 'zh-CN'))

  function handleImageSelection(nextSelection: TodayImageSelection) {
    setSelection(nextSelection)
    setCachedUpload(null)
    setUploadStatus('idle')
    if (nextSelection.file) setError('')
  }

  function resetForm() {
    setForm(emptyForm)
    setSelection(emptySelection)
    setCachedUpload(null)
    setUploadStatus('idle')
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (savingRef.current) return

    savingRef.current = true
    setSaving(true)
    setError('')
    setMessage('')

    try {
      let imageUrl: string | undefined
      if (selection.file) {
        const key = todayImageFileKey(selection.file)
        imageUrl = cachedUpload?.key === key ? cachedUpload.url : undefined
        if (!imageUrl) {
          setUploadStatus('uploading')
          imageUrl = await uploadTodayImage(selection.file)
          setCachedUpload({ key, url: imageUrl })
        }
        setUploadStatus('success')
      }

      const response = await fetch('/api/today', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify(imageUrl ? { ...form, imageUrl } : form),
      })
      const data = await response.json().catch(() => null)
      if (!response.ok) {
        setError(data?.message || '提交失败，请稍后重试')
        return
      }

      setMessage(data?.message || '已提交，等待管理员审核。')
      setOpen(false)
      resetForm()
    } catch (submitError) {
      if (selection.file) setUploadStatus('error')
      setError(submitError instanceof Error ? submitError.message : '提交失败，请稍后重试')
    } finally {
      savingRef.current = false
      setSaving(false)
    }
  }

  return (
    <main className="site-page-main flat-page mx-auto max-w-6xl space-y-6 px-4 py-6 sm:px-5 sm:py-9">
      <section className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-4xl font-black text-brand-950 sm:text-6xl">历史上的今天</h1>
          <p className="mt-3 text-lg font-black text-slate-600">{month} 月 {day} 日 · 记录 Eason 与 E 友的时间线</p>
        </div>
        <button type="button" onClick={() => setOpen((value) => !value)} disabled={saving} className="rounded-full bg-brand-950 px-5 py-3 text-sm font-black text-white disabled:cursor-not-allowed disabled:opacity-60">提交今日内容</button>
      </section>
      {message ? <p className="rounded-2xl bg-emerald-50 px-4 py-3 text-sm font-black text-emerald-700">{message}</p> : null}
      {error ? <p role="alert" className="rounded-2xl bg-red-50 px-4 py-3 text-sm font-black text-red-700">{error}</p> : null}
      {open ? (
        <form onSubmit={submit} className="rounded-[28px] border border-sky-100 bg-white/90 p-6 shadow-sm">
          <h2 className="text-2xl font-black text-brand-950">提交历史记录</h2>
          <p className="mt-2 text-sm font-bold leading-6 text-slate-500">提交后会进入 PENDING 状态，管理员审核通过后才会公开。</p>
          <div className="mt-5 grid gap-4 md:grid-cols-3">
            <label className="text-sm font-black text-slate-600">日期<input required type="date" value={form.date} onChange={(event) => setForm({ ...form, date: event.target.value })} className="mt-2 w-full rounded-xl border border-sky-100 px-3 py-2" /></label>
            <label className="text-sm font-black text-slate-600">类型<select value={form.type} onChange={(event) => setForm({ ...form, type: event.target.value })} className="mt-2 w-full rounded-xl border border-sky-100 bg-white px-3 py-2">{types.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
            <label className="text-sm font-black text-slate-600">参考来源<input value={form.reference} onChange={(event) => setForm({ ...form, reference: event.target.value })} className="mt-2 w-full rounded-xl border border-sky-100 px-3 py-2" /></label>
          </div>
          <label className="mt-4 block text-sm font-black text-slate-600">标题<input required minLength={2} value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} className="mt-2 w-full rounded-xl border border-sky-100 px-3 py-2" /></label>
          <label className="mt-4 block text-sm font-black text-slate-600">内容<textarea required minLength={5} rows={4} value={form.content} onChange={(event) => setForm({ ...form, content: event.target.value })} className="mt-2 w-full rounded-xl border border-sky-100 px-3 py-2" /></label>
          <div className="mt-4">
            <TodayImageUploader disabled={saving} status={uploadStatus} onSelectionChange={handleImageSelection} />
          </div>
          <div className="mt-5 flex items-center gap-3">
            <button type="submit" disabled={saving} className="rounded-full bg-brand-950 px-6 py-3 text-sm font-black text-white disabled:cursor-not-allowed disabled:opacity-60">{saving ? '保存中...' : '提交记录'}</button>
            <button type="button" disabled={saving} onClick={() => { setOpen(false); resetForm() }} className="rounded-full border border-sky-100 px-6 py-3 text-sm font-black text-slate-500 disabled:cursor-not-allowed disabled:opacity-60">取消</button>
          </div>
        </form>
      ) : null}

      <section className="today-poster-wall">
        {events.map((item) => (
          <article key={item.id} className="today-poster-card overflow-hidden rounded-2xl border border-sky-100 bg-white/90 shadow-sm">
            {item.imageUrl ? (
              <div className="today-poster-image-wrap" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: '100%', padding: '8px' }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={publicImageVariantUrl(item.imageUrl, 'card') || item.imageUrl} alt={item.title} className="today-poster-image" style={{ display: 'block', maxWidth: '100%', maxHeight: '640px', width: 'auto', height: 'auto', objectFit: 'contain' }} loading="lazy" />
              </div>
            ) : (
              <div className="today-poster-image today-poster-image-empty" style={{ height: '240px', background: 'linear-gradient(135deg,#e0f2fe,#f1f5f9)' }} />
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
  )
}
