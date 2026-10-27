'use client'

import Link from 'next/link'
import Image from 'next/image'
import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ConcertCountdown } from '@/components/concerts/ConcertCountdown'
import { ConcertDiscussion } from '@/components/concerts/ConcertDiscussion'
import { ConcertTutorialPopover } from '@/components/concerts/ConcertTutorialPopover'
import type { EventView } from '@/components/concerts/concert-types'
import { publicImageUrl } from '@/lib/images'
import { concertDateKey, filterConcertShows, getConcertCalendarCells, getConcertTimelineState, isConcertWeekend } from '@/lib/concert-timeline'
import { useServerClock } from '@/components/concerts/useServerClock'

type Mark = { showId: string; wantToGo: boolean; hasTicket: boolean; isPublic: boolean } | null

function dateLabel(value: Date | string, options: Intl.DateTimeFormatOptions = { month: 'long', day: 'numeric', weekday: 'short' }) {
  const date = new Date(`${concertDateKey(value)}T12:00:00.000Z`)
  return new Intl.DateTimeFormat('zh-HK', { ...options, timeZone: 'UTC' }).format(date)
}

function safeExternalUrl(value: string | null) {
  if (!value) return null
  try {
    const parsed = new URL(value)
    return parsed.protocol === 'https:' && !parsed.username && !parsed.password ? parsed.toString() : null
  } catch { return null }
}

export function ConcertEventPage({ initialEvent, isAuthenticated }: Readonly<{ initialEvent: EventView; isAuthenticated: boolean }>) {
  const router = useRouter()
  const [event, setEvent] = useState(initialEvent)
  const serverNow = useServerClock(event.serverNow, 30_000)
  const [month, setMonth] = useState(concertDateKey(initialEvent.shows[0]?.date || initialEvent.serverNow).slice(0, 7))
  const [weekendsOnly, setWeekendsOnly] = useState(false)
  const [busyKey, setBusyKey] = useState('')
  const [notice, setNotice] = useState('')
  const monthShows = useMemo(() => filterConcertShows(event.shows, month, weekendsOnly), [event.shows, month, weekendsOnly])
  const listShows = useMemo(() => weekendsOnly ? event.shows.filter((show) => isConcertWeekend(show.date)) : event.shows, [event.shows, weekendsOnly])
  const calendarCells = useMemo(() => getConcertCalendarCells(month, weekendsOnly ? event.shows.filter((show) => isConcertWeekend(show.date)) : event.shows), [event.shows, month, weekendsOnly])
  const timelineState = getConcertTimelineState(event.timeline, new Date(serverNow), event.timezone, event.status)
  const registrationUrl = safeExternalUrl(event.registrationEnabled ? event.registrationUrl : null)
  const firstShow = event.shows[0]
  const lastShow = event.shows[event.shows.length - 1]
  const backgroundImageUrl = publicImageUrl(event.backgroundImageUrl)

  async function saveMark(showId: string, previous: Mark, next: Mark) {
    if (!isAuthenticated) {
      router.push(`/login?redirect=${encodeURIComponent(`/concerts/${event.slug}`)}`)
      return
    }
    setBusyKey(`mark:${showId}`)
    setNotice('')
    try {
      const response = await fetch(`/api/concert-events/${encodeURIComponent(event.slug)}/shows/${encodeURIComponent(showId)}/mark`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ wantToGo: next?.wantToGo || false, hasTicket: next?.hasTicket || false, isPublic: next?.isPublic ?? previous?.isPublic ?? false }),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(typeof data.message === 'string' ? data.message : '保存失败，请稍后重试')
      const saved = data.mark as Mark
      setEvent((current) => ({
        ...current,
        shows: current.shows.map((show) => {
          if (show.id !== showId) return show
          const oldPublicWant = Boolean(show.viewerMark?.isPublic && show.viewerMark.wantToGo)
          const oldPublicTicket = Boolean(show.viewerMark?.isPublic && show.viewerMark.hasTicket)
          const newPublicWant = Boolean(saved?.isPublic && saved.wantToGo)
          const newPublicTicket = Boolean(saved?.isPublic && saved.hasTicket)
          return { ...show, viewerMark: saved, wantToGoCount: Math.max(0, show.wantToGoCount + Number(newPublicWant) - Number(oldPublicWant)), hasTicketCount: Math.max(0, show.hasTicketCount + Number(newPublicTicket) - Number(oldPublicTicket)) }
        }),
      }))
      try {
        const refreshed = await fetch(`/api/concert-events/${encodeURIComponent(event.slug)}`, { cache: 'no-store' })
        if (refreshed.ok) {
          const refreshedData = await refreshed.json().catch(() => null)
          if (refreshedData?.event) setEvent(refreshedData.event as EventView)
        }
      } catch { /* The mutation succeeded; the next page load refreshes public aggregate counts. */ }
      setNotice('场次状态已更新')
    } catch (error) { setNotice(error instanceof Error ? error.message : '保存失败，请稍后重试') }
    finally { setBusyKey('') }
  }

  async function toggleReminder(targetType: 'TIMELINE' | 'SHOW', targetId: string) {
    if (!isAuthenticated) {
      router.push(`/login?redirect=${encodeURIComponent(`/concerts/${event.slug}`)}`)
      return
    }
    const key = `${targetType}:${targetId}`
    const enabled = !event.viewerReminderKeys.includes(key)
    setBusyKey(`reminder:${key}`)
    setNotice('')
    try {
      const response = await fetch(`/api/concert-events/${encodeURIComponent(event.slug)}/reminders`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ targetType, targetId, enabled }) })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(typeof data.message === 'string' ? data.message : '提醒设置失败')
      setEvent((current) => ({ ...current, viewerReminderKeys: enabled ? [...current.viewerReminderKeys, key] : current.viewerReminderKeys.filter((item) => item !== key) }))
      setNotice(enabled ? '已订阅站内提醒' : '已取消站内提醒')
    } catch (error) { setNotice(error instanceof Error ? error.message : '提醒设置失败') }
    finally { setBusyKey('') }
  }

  const monthIndex = Number(month.slice(5, 7)) - 1
  function shiftMonth(amount: number) {
    const shifted = new Date(`${month}-15T12:00:00+08:00`)
    shifted.setUTCMonth(shifted.getUTCMonth() + amount)
    setMonth(`${shifted.getUTCFullYear()}-${String(shifted.getUTCMonth() + 1).padStart(2, '0')}`)
  }

  return <main className="site-page-main mx-auto max-w-7xl space-y-5 px-4 py-5 sm:px-5 sm:py-8">
    <section className="relative isolate z-20 border border-[var(--border)] bg-slate-950 px-5 py-6 text-white sm:px-9 sm:py-8">
      <div className="absolute inset-0 overflow-hidden" aria-hidden="true">{backgroundImageUrl ? <Image src={backgroundImageUrl} alt="" fill sizes="100vw" className="object-cover" unoptimized priority /> : null}</div>
      <div className="absolute inset-0 bg-slate-950/70" aria-hidden="true" />
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_80%_10%,rgba(90,105,126,.3),transparent_45%)]" aria-hidden="true" />
      <div className="absolute right-3 top-3 z-20 sm:right-6 sm:top-4"><ConcertTutorialPopover tutorials={event.tutorials} registrationUrl={registrationUrl} /></div>
      <div className="relative z-10 max-w-4xl pt-10 sm:pt-0">
        <p className="text-xs font-bold uppercase tracking-[.3em] text-white/60">限时演唱会专题 · {timelineState.phaseLabel}</p>
        <h1 className="mt-3 text-3xl font-black tracking-tight sm:text-5xl">{event.title}</h1>
        {event.subtitle ? <p className="mt-2 text-base text-white/80 sm:text-lg">{event.subtitle}</p> : null}
        <p className="mt-5 text-sm text-white/70">{firstShow ? dateLabel(firstShow.date, { year: 'numeric', month: '2-digit', day: '2-digit' }) : '日期待定'} — {lastShow ? dateLabel(lastShow.date, { year: 'numeric', month: '2-digit', day: '2-digit' }) : ''} · {event.shows.length} 场</p>
        {event.venue ? <p className="mt-1 text-sm text-white/70">{event.venue}</p> : null}
        <div className="mt-5"><ConcertCountdown target={timelineState.target} label={timelineState.countdownLabel || '最近活动节点'} serverNow={event.serverNow} /></div>
        <div className="mt-5 flex flex-wrap gap-2">
          {registrationUrl ? <a href={registrationUrl} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center border border-white/30 bg-white px-4 text-sm font-black text-slate-950 hover:bg-white/90">{event.registrationLabel} ↗</a> : <span className="inline-flex min-h-11 items-center border border-white/20 px-4 text-sm text-white/70">登记入口待管理员确认</span>}
          {event.allowDiscussion ? <a href="#discussion" className="inline-flex min-h-11 items-center border border-white/30 px-4 text-sm font-bold text-white hover:bg-white/10">进入系列讨论 ↓</a> : null}
        </div>
        <p className="mt-5 text-xs text-white/75">{event.totalWantToGo} 人想看 · {event.totalHasTicket} 人有票</p>
        {event.sourceNote ? <p className="mt-3 max-w-3xl text-xs leading-5 text-white/55">{event.sourceNote}</p> : null}
      </div>
    </section>

    <details id="timeline" className="group border border-[var(--border)] bg-[var(--surface)] p-3 sm:p-4">
      <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 text-sm font-black text-[var(--foreground)] [&::-webkit-details-marker]:hidden">
        <span>活动时间线 <span className="ml-1 font-normal text-[var(--foreground-muted)]">· {timelineState.phaseLabel} · {event.timeline.length} 个节点</span></span><span aria-hidden="true" className="text-lg text-[var(--primary)] transition-transform group-open:rotate-180">⌄</span>
      </summary>
      <div className="mt-3 border-t border-[var(--border)] pt-3">
        <p className="mb-3 text-xs text-[var(--foreground-muted)]">仅展示管理员启用的节点；未提供具体时刻的日期不会推断为官方截止时间。</p>
        <ol className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">{event.timeline.map((item) => <li id={`timeline-${item.id}`} key={item.id} className="border-l-2 border-[var(--primary)] bg-[var(--background)] px-3 py-2">
          <p className="text-[11px] text-[var(--foreground-muted)]">{dateLabel(item.date, { year: 'numeric', month: '2-digit', day: '2-digit' })}{item.startsAt ? ` · ${new Intl.DateTimeFormat('zh-HK', { timeZone: event.timezone, hour: '2-digit', minute: '2-digit' }).format(new Date(item.startsAt))}` : ''}{item.endsAt ? ` · 截止 ${new Intl.DateTimeFormat('zh-HK', { timeZone: event.timezone, hour: '2-digit', minute: '2-digit' }).format(new Date(item.endsAt))}` : ''}</p>
          <h3 className="mt-0.5 text-sm font-bold text-[var(--foreground)]">{item.title}</h3>
          {item.description ? <p className="mt-1 text-xs leading-5 text-[var(--foreground-muted)]">{item.description}</p> : null}
          {item.notificationEnabled ? <button type="button" disabled={busyKey === `reminder:TIMELINE:${item.id}`} onClick={() => void toggleReminder('TIMELINE', item.id)} className="mt-1 min-h-9 text-xs font-bold text-[var(--primary)] disabled:opacity-50">{event.viewerReminderKeys.includes(`TIMELINE:${item.id}`) ? '已订阅提醒' : '提醒我'}</button> : null}
        </li>)}</ol>
      </div>
    </details>

    <details id="calendar" className="group border border-[var(--border)] bg-[var(--surface)] p-3 sm:p-4">
      <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 text-sm font-black text-[var(--foreground)] [&::-webkit-details-marker]:hidden">
        <span>{event.shows.length} 场演出日历 <span className="ml-1 font-normal text-[var(--foreground-muted)]">· {month.slice(0, 4)}年{monthIndex + 1}月 · 当前筛选 {monthShows.length} 场</span></span><span aria-hidden="true" className="text-lg text-[var(--primary)] transition-transform group-open:rotate-180">⌄</span>
      </summary>
      <div className="mt-3 border-t border-[var(--border)] pt-3">
        <div className="flex flex-wrap items-center justify-between gap-2"><p className="text-xs text-[var(--foreground-muted)]">歌单为参考资料整理，未独立核实。</p><div className="flex items-center gap-2"><button type="button" onClick={() => shiftMonth(-1)} aria-label="上个月" className="min-h-10 min-w-10 border border-[var(--border)]">‹</button><strong className="min-w-24 text-center text-sm text-[var(--foreground)]">{month.slice(0, 4)}年{monthIndex + 1}月</strong><button type="button" onClick={() => shiftMonth(1)} aria-label="下个月" className="min-h-10 min-w-10 border border-[var(--border)]">›</button></div></div>
        <label className="mt-2 inline-flex min-h-10 cursor-pointer items-center gap-2 text-sm text-[var(--foreground)]"><input type="checkbox" checked={weekendsOnly} onChange={(e) => setWeekendsOnly(e.target.checked)} />只看周末场</label>
        <div className="mt-2 grid grid-cols-7 gap-px border border-[var(--border)] bg-[var(--border)]" aria-label={`${month.slice(0, 4)}年${monthIndex + 1}月场次日历`}>
          {['日', '一', '二', '三', '四', '五', '六'].map((day) => <div key={`weekday-${day}`} className="min-w-0 bg-[var(--surface)] py-1 text-center text-[10px] font-bold text-[var(--foreground-muted)]">{day}</div>)}
          {calendarCells.map((cell) => <div key={cell.key} className={`min-h-11 min-w-0 overflow-hidden bg-[var(--background)] p-0.5 sm:min-h-14 sm:p-1 ${cell.inMonth ? '' : 'opacity-40'}`}>
            <span className="text-[10px] font-bold text-[var(--foreground-muted)]">{cell.day}</span>
            <div className="mt-0.5 space-y-px">{cell.shows.map((show) => <Link key={show.id} aria-label={`${dateLabel(show.date)} ${show.startTime || '时间待定'} · ${show.albumTitle}`} title={`${show.startTime || '时间待定'} · ${show.albumTitle}`} href={`/concerts/${event.slug}/shows/${show.id}`} className="block min-h-7 min-w-0 overflow-hidden break-words border-l-2 border-[var(--primary)] bg-[var(--surface)] px-0.5 py-1 text-[9px] leading-3 text-[var(--foreground)] sm:min-h-8 sm:px-1 sm:text-[10px]">{show.startTime || '待定'}<span className="hidden sm:inline"> · {show.albumTitle}</span></Link>)}</div>
          </div>)}
        </div>
        {!monthShows.length ? <p className="mt-2 text-xs text-[var(--foreground-muted)]">这个月份没有符合筛选条件的场次。</p> : null}
      </div>
    </details>

    <details id="shows" className="group border border-[var(--border)] bg-[var(--surface)] p-3 sm:p-4">
      <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 text-sm font-black text-[var(--foreground)] [&::-webkit-details-marker]:hidden">
        <span>场次与歌单 <span className="ml-1 font-normal text-[var(--foreground-muted)]">· {listShows.length} 场{weekendsOnly ? '（周末筛选）' : ''}</span></span><span aria-hidden="true" className="text-lg text-[var(--primary)] transition-transform group-open:rotate-180">⌄</span>
      </summary>
      <div className="mt-3 space-y-2 border-t border-[var(--border)] pt-3">{listShows.map((show) => <details key={show.id} className="group border border-[var(--border)] bg-[var(--background)]">
        <summary className="flex min-h-12 cursor-pointer list-none flex-wrap items-center justify-between gap-x-2 gap-y-1 px-3 py-2 text-sm font-bold text-[var(--foreground)] [&::-webkit-details-marker]:hidden"><span>{dateLabel(show.date)} · {show.startTime || '时间待定'} — {show.albumTitle}</span><span className="flex items-center gap-2 text-xs font-normal text-[var(--foreground-muted)]">想看 {show.wantToGoCount} · 有票 {show.hasTicketCount}<span aria-hidden="true" className="text-[var(--primary)] transition-transform group-open:rotate-180">⌄</span></span></summary>
        <div className="border-t border-[var(--border)] px-3 py-3">
          {show.note ? <p className="mb-2 text-xs text-[var(--foreground-muted)]">{show.note}</p> : null}
          <ol className="grid gap-x-6 sm:grid-cols-2">{show.songs.map((song, index) => <li key={`${show.id}-${index}`} className="border-b border-[var(--border)] py-1.5 text-xs text-[var(--foreground)]"><span className="mr-2 text-[10px] text-[var(--foreground-muted)]">{index + 1}</span>{song}</li>)}</ol>
          <div className="mt-2 flex flex-wrap gap-2"><Link href={`/concerts/${event.slug}/shows/${show.id}#discussion`} className="inline-flex min-h-10 items-center text-xs font-bold text-[var(--primary)]">本场讨论 →</Link>
            {event.allowMarking && event.status !== 'ENDED' ? <>
              <button type="button" disabled={busyKey === `mark:${show.id}`} onClick={() => void saveMark(show.id, show.viewerMark, { showId: show.id, wantToGo: !show.viewerMark?.wantToGo, hasTicket: Boolean(show.viewerMark?.hasTicket), isPublic: show.viewerMark?.isPublic ?? false })} className="min-h-10 border border-[var(--border)] px-2 text-xs font-bold text-[var(--foreground)] disabled:opacity-50">{show.viewerMark?.wantToGo ? '想看 ✓' : '想看'}</button>
              <button type="button" disabled={busyKey === `mark:${show.id}`} onClick={() => void saveMark(show.id, show.viewerMark, { showId: show.id, wantToGo: Boolean(show.viewerMark?.wantToGo), hasTicket: !show.viewerMark?.hasTicket, isPublic: show.viewerMark?.isPublic ?? false })} className="min-h-10 border border-[var(--border)] px-2 text-xs font-bold text-[var(--foreground)] disabled:opacity-50">{show.viewerMark?.hasTicket ? '有票 ✓' : '有票'}</button>
            </> : null}
          </div>
          {event.status !== 'ENDED' ? <button type="button" disabled={busyKey === `reminder:SHOW:${show.id}`} onClick={() => void toggleReminder('SHOW', show.id)} className="mt-1 min-h-10 text-xs font-bold text-[var(--primary)] disabled:opacity-50">{event.viewerReminderKeys.includes(`SHOW:${show.id}`) ? '已订阅演出提醒' : '演出前一日提醒我'}</button> : null}
        </div>
      </details>)}</div>
      {notice ? <p role="status" aria-live="polite" className="mt-2 text-sm text-[var(--primary)]">{notice}</p> : null}
      {isAuthenticated ? <section className="mt-4 border-t border-[var(--border)] pt-3"><h3 className="font-black text-[var(--foreground)]">我的场次</h3>{event.shows.some((show) => show.viewerMark?.wantToGo || show.viewerMark?.hasTicket) ? <ul className="mt-2 flex flex-wrap gap-2">{event.shows.filter((show) => show.viewerMark?.wantToGo || show.viewerMark?.hasTicket).map((show) => <li key={show.id}><Link className="text-sm text-[var(--primary)]" href={`/concerts/${event.slug}/shows/${show.id}`}>{dateLabel(show.date)} · {show.albumTitle}（{[show.viewerMark?.wantToGo ? '想看' : '', show.viewerMark?.hasTicket ? '有票' : ''].filter(Boolean).join(' / ')}）</Link></li>)}</ul> : <p className="mt-1 text-sm text-[var(--foreground-muted)]">你还没有标记场次。</p>}</section> : <p className="mt-3 text-sm text-[var(--foreground-muted)]"><Link className="text-[var(--primary)]" href={`/login?redirect=${encodeURIComponent(`/concerts/${event.slug}`)}`}>登录</Link> 后标记想看或有票。</p>}
    </details>

    {event.allowDiscussion ? <ConcertDiscussion slug={event.slug} isAuthenticated={isAuthenticated} canComment={event.status !== 'ENDED'} /> : null}
  </main>
}
