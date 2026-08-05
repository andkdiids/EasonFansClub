'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

type Attendance = {
  id: string
  seatInfo: string | null
  mood: string | null
  note: string | null
  isPublic: boolean
  updatedAt: string | Date
}

const emptyForm = { seatInfo: '', mood: '', note: '', isPublic: false }
const ATTENDANCE_UPDATED_EVENT = 'music-live:attendance-updated'

export function AttendancePanel({ concertId, loggedIn, initialAttendance }: Readonly<{
  concertId: string
  loggedIn: boolean
  initialAttendance: Attendance | null
}>) {
  const router = useRouter()
  const pathname = usePathname()
  const [attendance, setAttendance] = useState(initialAttendance)
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState(emptyForm)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const firstInputRef = useRef<HTMLInputElement>(null)
  const baseline = useMemo(() => attendance ? {
    seatInfo: attendance.seatInfo || '',
    mood: attendance.mood || '',
    note: attendance.note || '',
    isPublic: attendance.isPublic,
  } : emptyForm, [attendance])
  const dirty = JSON.stringify(form) !== JSON.stringify(baseline)

  function beginEdit() {
    setForm(baseline)
    setError('')
    setMessage('')
    setOpen(true)
  }

  const requestClose = useCallback(() => {
    if (busy) return
    if (dirty && !window.confirm('还有未保存的观演记录，确定关闭吗？')) return
    setOpen(false)
  }, [busy, dirty])

  useEffect(() => {
    if (!open) return
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    window.setTimeout(() => firstInputRef.current?.focus(), 0)
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') requestClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => {
      document.body.style.overflow = previousOverflow
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [open, requestClose])

  async function save() {
    if (busy) return
    setBusy(true)
    setError('')
    try {
      const response = await fetch(`/api/music/live/concerts/${concertId}/attendance`, {
        method: attendance ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        cache: 'no-store',
        body: JSON.stringify(attendance ? { ...form, updatedAt: attendance.updatedAt } : form),
      })
      const data = await response.json().catch(() => null)
      if (!response.ok || !data?.attendance) {
        setError(data?.message || '保存失败，请稍后重试')
        return
      }
      setAttendance(data.attendance)
      setForm({
        seatInfo: data.attendance.seatInfo || '',
        mood: data.attendance.mood || '',
        note: data.attendance.note || '',
        isPublic: data.attendance.isPublic,
      })
      setMessage(data.message || (attendance ? '观演记录已更新' : '已加入我的现场'))
      setOpen(false)
      window.dispatchEvent(new CustomEvent(ATTENDANCE_UPDATED_EVENT))
      router.refresh()
    } catch (error) {
      console.error('[music.live.attendance.save]', error)
      setError('保存失败，请稍后重试')
    } finally {
      setBusy(false)
    }
  }

  async function remove() {
    if (busy || !attendance) return
    if (!window.confirm('取消后，该场演唱会将从你的观演记录和歌曲解锁统计中移除。是否继续？')) return
    setBusy(true)
    setError('')
    try {
      const response = await fetch(`/api/music/live/concerts/${concertId}/attendance`, { method: 'DELETE', credentials: 'same-origin', cache: 'no-store' })
      const data = await response.json().catch(() => null)
      if (!response.ok) {
        setError(data?.message || '取消失败，请稍后重试')
        return
      }
      setAttendance(null)
      setForm(emptyForm)
      setMessage(data.message || '已从我的现场移除')
      window.dispatchEvent(new CustomEvent(ATTENDANCE_UPDATED_EVENT))
      router.refresh()
    } catch (error) {
      console.error('[music.live.attendance.remove]', error)
      setError('取消失败，请稍后重试')
    } finally {
      setBusy(false)
    }
  }

  if (!loggedIn) {
    return <section className="mt-6 border border-sky-300/20 bg-sky-300/[0.06] p-4"><Link href={`/login?redirect=${encodeURIComponent(pathname)}`} className="inline-flex bg-sky-100 px-5 py-3 text-sm font-black text-[#06101d]">登录后记录我看过</Link></section>
  }

  return <section className="mt-6 border border-sky-300/20 bg-sky-300/[0.06] p-4 sm:p-5" aria-label="我的观演记录">
    <div className="flex flex-wrap items-center gap-3">
      {attendance ? <><span className="font-black text-emerald-200">✓ 我看过</span><button type="button" onClick={beginEdit} className="border border-white/15 px-4 py-2 text-sm font-black text-white">编辑记录</button><button type="button" onClick={() => void remove()} disabled={busy} className="border border-red-300/25 px-4 py-2 text-sm font-black text-red-200 disabled:opacity-50">取消标记</button></> : <button type="button" onClick={beginEdit} className="bg-sky-100 px-5 py-3 text-sm font-black text-[#06101d]">标记我看过</button>}
      <Link href="/music/live/me" className="text-sm font-black text-sky-200/80">进入我的现场 →</Link>
    </div>
    {message ? <p role="status" className="mt-3 text-sm font-bold text-emerald-200">{message}</p> : null}
    {error && !open ? <p role="alert" className="mt-3 text-sm font-bold text-red-200">{error}</p> : null}
    {open ? <div className="fixed inset-0 z-[var(--layer-dialog)] flex items-end justify-center bg-black/70 p-0 sm:items-center sm:p-5" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) requestClose() }}>
      <div role="dialog" aria-modal="true" aria-labelledby="attendance-dialog-title" className="max-h-[calc(100dvh-24px)] w-full max-w-xl overflow-y-auto border border-sky-200/20 bg-[#07182d] p-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))] shadow-2xl sm:p-7">
        <div className="flex items-start justify-between gap-4"><div><p className="text-xs font-black tracking-[0.18em] text-sky-300/60">MY LIVE HISTORY</p><h2 id="attendance-dialog-title" className="mt-2 text-2xl font-black text-white">{attendance ? '编辑记录' : '标记我看过'}</h2></div><button type="button" onClick={requestClose} aria-label="关闭观演记录编辑" className="px-3 py-2 text-xl text-slate-300">×</button></div>
        <div className="mt-6 space-y-4">
          <label className="block text-sm font-black text-slate-200">座位信息（选填）<input ref={firstInputRef} value={form.seatInfo} maxLength={100} onChange={(event) => setForm({ ...form, seatInfo: event.target.value })} className="mt-2 w-full border border-white/15 bg-white/[0.06] px-3 py-3 text-white outline-none focus:border-sky-300" placeholder="例如：内场 A3 区 8 排" /></label>
          <label className="block text-sm font-black text-slate-200">当晚心情（选填）<input value={form.mood} maxLength={100} onChange={(event) => setForm({ ...form, mood: event.target.value })} className="mt-2 w-full border border-white/15 bg-white/[0.06] px-3 py-3 text-white outline-none focus:border-sky-300" /></label>
          <label className="block text-sm font-black text-slate-200">个人笔记（选填）<textarea value={form.note} maxLength={5000} rows={7} onChange={(event) => setForm({ ...form, note: event.target.value })} className="mt-2 w-full resize-y border border-white/15 bg-white/[0.06] px-3 py-3 text-white outline-none focus:border-sky-300" /></label>
          <label className="flex items-start gap-3 border border-white/10 p-3 text-sm font-bold text-slate-200"><input type="checkbox" checked={form.isPublic} onChange={(event) => setForm({ ...form, isPublic: event.target.checked })} className="mt-1" /><span>允许在个人病历展示<span className="mt-1 block text-xs font-medium text-slate-400">仅展示场次、城市、场馆、巡演与心情；个人笔记始终不会公开。</span></span></label>
        </div>
        {error ? <p role="alert" className="mt-4 border border-red-300/20 bg-red-300/10 p-3 text-sm font-bold text-red-200">{error}</p> : null}
        <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end"><button type="button" onClick={requestClose} disabled={busy} className="border border-white/15 px-5 py-3 text-sm font-black text-white">取消</button><button type="button" onClick={() => void save()} disabled={busy} className="bg-sky-100 px-5 py-3 text-sm font-black text-[#06101d] disabled:opacity-50">{busy ? '保存中…' : '保存观演记录'}</button></div>
      </div>
    </div> : null}
  </section>
}
