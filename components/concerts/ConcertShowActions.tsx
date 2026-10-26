'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

export function ConcertShowActions({ slug, showId, isAuthenticated, canMark, initialMark, wantToGoCount, hasTicketCount, reminderEnabled, initialReminder }: Readonly<{
  slug: string; showId: string; isAuthenticated: boolean; canMark: boolean; initialMark: { wantToGo: boolean; hasTicket: boolean; isPublic: boolean } | null
  wantToGoCount: number; hasTicketCount: number; reminderEnabled: boolean; initialReminder: boolean
}>) {
  const router = useRouter()
  const [mark, setMark] = useState(initialMark)
  const [wantCount, setWantCount] = useState(wantToGoCount)
  const [ticketCount, setTicketCount] = useState(hasTicketCount)
  const [reminder, setReminder] = useState(initialReminder)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')

  async function save(next: { wantToGo: boolean; hasTicket: boolean; isPublic: boolean }) {
    if (!isAuthenticated) { router.push(`/login?redirect=${encodeURIComponent(`/concerts/${slug}/shows/${showId}`)}`); return }
    if (busy) return
    setBusy(true); setMessage('')
    try {
      const response = await fetch(`/api/concert-events/${encodeURIComponent(slug)}/shows/${encodeURIComponent(showId)}/mark`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(next) })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(data.message || '保存失败')
      const saved = data.mark as typeof mark
      setMark(saved); setMessage('场次状态已更新')
      try {
        const refreshed = await fetch(`/api/concert-events/${encodeURIComponent(slug)}`, { cache: 'no-store' })
        if (refreshed.ok) {
          const refreshedData = await refreshed.json().catch(() => null)
          const updatedShow = refreshedData?.event?.shows?.find((show: { id: string }) => show.id === showId)
          if (updatedShow) {
            setMark(updatedShow.viewerMark)
            setWantCount(updatedShow.wantToGoCount)
            setTicketCount(updatedShow.hasTicketCount)
          }
        }
      } catch { /* The mutation succeeded; public aggregate counts refresh on the next request. */ }
    } catch (error) { setMessage(error instanceof Error ? error.message : '保存失败，请稍后重试') }
    finally { setBusy(false) }
  }

  async function toggleReminder() {
    if (!isAuthenticated) { router.push(`/login?redirect=${encodeURIComponent(`/concerts/${slug}/shows/${showId}`)}`); return }
    if (busy) return
    setBusy(true); setMessage('')
    try {
      const response = await fetch(`/api/concert-events/${encodeURIComponent(slug)}/reminders`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ targetType: 'SHOW', targetId: showId, enabled: !reminder }) })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(data.message || '提醒设置失败')
      setReminder(Boolean(data.subscribed)); setMessage(data.subscribed ? '已订阅演出前一日站内提醒' : '已取消提醒')
    } catch (error) { setMessage(error instanceof Error ? error.message : '提醒设置失败') }
    finally { setBusy(false) }
  }

  return <section className="border border-[var(--border)] bg-[var(--surface)] p-4"><h2 className="font-black text-[var(--foreground)]">我的场次状态</h2><p className="mt-1 text-xs text-[var(--foreground-muted)]">想看和有票可同时选择；默认不公开名单。需要时可主动勾选公开展示。</p>
    <div className="mt-3 flex flex-wrap gap-2">{canMark ? <><button type="button" disabled={busy} onClick={() => void save({ wantToGo: !mark?.wantToGo, hasTicket: Boolean(mark?.hasTicket), isPublic: mark?.isPublic ?? false })} className={`min-h-10 border px-3 text-sm font-bold ${mark?.wantToGo ? 'border-[var(--primary)] text-[var(--primary)]' : 'border-[var(--border)] text-[var(--foreground-muted)]'} disabled:opacity-50`}>{mark?.wantToGo ? '想看 ✓' : '想看'}</button><button type="button" disabled={busy} onClick={() => void save({ wantToGo: Boolean(mark?.wantToGo), hasTicket: !mark?.hasTicket, isPublic: mark?.isPublic ?? false })} className={`min-h-10 border px-3 text-sm font-bold ${mark?.hasTicket ? 'border-emerald-600 text-emerald-700 dark:text-emerald-300' : 'border-[var(--border)] text-[var(--foreground-muted)]'} disabled:opacity-50`}>{mark?.hasTicket ? '有票 ✓' : '有票'}</button>{mark && (mark.wantToGo || mark.hasTicket) ? <label className="inline-flex min-h-10 items-center gap-2 px-2 text-xs text-[var(--foreground-muted)]"><input type="checkbox" checked={mark.isPublic} disabled={busy} onChange={(e) => void save({ wantToGo: mark.wantToGo, hasTicket: mark.hasTicket, isPublic: e.target.checked })} />在公开名单展示</label> : null}</> : <span className="min-h-10 py-3 text-xs text-[var(--foreground-muted)]">当前暂不开放场次标记</span>}</div>
    <p className="mt-2 text-xs text-[var(--foreground-muted)]">公开统计：想看 {wantCount} · 有票 {ticketCount}</p>
    {reminderEnabled ? <button type="button" disabled={busy} onClick={() => void toggleReminder()} className="mt-2 min-h-9 text-sm font-bold text-[var(--primary)] disabled:opacity-50">{reminder ? '已订阅演出前一日站内提醒' : '演出前一日提醒我'}</button> : null}
    {message ? <p role="status" aria-live="polite" className="mt-2 text-sm text-[var(--primary)]">{message}</p> : null}
  </section>
}
