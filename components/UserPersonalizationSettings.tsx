'use client'

import { useState } from 'react'

export function UserPersonalizationSettings({ initialCheckinMoodEnabled }: Readonly<{ initialCheckinMoodEnabled: boolean }>) {
  const [enabled, setEnabled] = useState(initialCheckinMoodEnabled)
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState('')
  const [error, setError] = useState('')

  async function update(next: boolean) {
    if (busy) return
    const previous = enabled
    setEnabled(next); setBusy(true); setStatus(''); setError('')
    try {
      const response = await fetch('/api/account/preferences', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin', body: JSON.stringify({ checkinMoodEnabled: next }) })
      const data = await response.json().catch(() => null)
      if (!response.ok) throw new Error(data?.message || '保存失败，请重试')
      setEnabled(Boolean(data.preferences?.checkinMoodEnabled))
      setStatus(data.message || '个性化设置已保存')
    } catch (reason) {
      setEnabled(previous)
      setError(reason instanceof Error ? reason.message : '保存失败，请重试')
    } finally { setBusy(false) }
  }

  return <section className="rounded-[28px] border border-sky-100 bg-white/78 p-5 shadow-sm shadow-sky-900/5 backdrop-blur-xl sm:p-7" aria-labelledby="personalization-title">
    <p className="text-xs font-black tracking-[0.2em] text-brand-700">个性化设置</p>
    <h2 id="personalization-title" className="mt-2 text-2xl font-black text-brand-950">个性化设置</h2>
    <div className="mt-5 flex items-center justify-between gap-5 rounded-2xl border border-sky-100 bg-sky-50/55 px-4 py-4 sm:px-5">
      <div className="min-w-0"><p className="font-black text-brand-950">签到时填写今日心情</p><p className="mt-1 text-sm font-bold leading-6 text-slate-500">关闭后，每日挂号页面将不再要求选择心情，点击签到即可直接完成挂号。</p></div>
      <button type="button" role="switch" aria-checked={enabled} aria-label="签到时填写今日心情" disabled={busy} onClick={() => void update(!enabled)} className={`relative h-8 w-14 shrink-0 rounded-full transition focus:outline-none focus:ring-4 focus:ring-brand-500/20 disabled:opacity-60 ${enabled ? 'bg-brand-700' : 'bg-slate-300'}`}><span className={`absolute top-1 size-6 rounded-full bg-white shadow-sm transition ${enabled ? 'left-7' : 'left-1'}`} /></button>
    </div>
    {busy ? <p className="mt-3 text-sm font-black text-slate-500" role="status">保存中...</p> : null}
    {status ? <p className="mt-3 text-sm font-black text-emerald-700" role="status">{status}</p> : null}
    {error ? <p className="mt-3 text-sm font-black text-red-600" role="alert">{error}</p> : null}
  </section>
}
